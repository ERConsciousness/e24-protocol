// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC1056} from "./IERC1056.sol";

/// @title E24Recovery
/// @notice Recuperación social opt-in para identidades E24 (E24-RFC-0001 §6.7).
///
///   El titular pone este contrato como dueño de su identidad en ERC-1056. A partir de ahí:
///   - La **clave activa** opera la identidad de inmediato (delegados y atributos) y queda
///     registrada como delegado `sigAuth` y `veriKey`, para firmar fuera de cadena.
///   - Los **guardianes** (3 a 5, umbral k de mayoría estricta) pueden reemplazar la clave
///     activa tras un **timelock de 72 h**.
///   - Un **veto** exige la clave activa más un guardián que no aprobó la recuperación.
///   - Lo que **debilita** la recuperación (retirarla o cambiar guardianes) también espera
///     72 h y k guardianes pueden cancelarlo.
///   - Al ejecutarse una recuperación se revoca todo lo que la clave anterior registró a
///     través de este contrato, incluido lo que pudo agregar un ladrón.
///
///   Todas las acciones se autorizan con firmas EIP-712 (cuentas de clave o ERC-1271), así
///   que cualquier relayer puede enviarlas y el titular nunca paga gas.
/// @dev Un solo contrato sirve a todas las identidades. Sin administrador.
///   SIMULACIÓN EDUCATIVA / testnet · sin validez jurídica.
contract E24Recovery is EIP712 {
    uint256 public constant TIMELOCK = 72 hours;
    uint256 public constant MIN_GUARDIANS = 3;
    uint256 public constant MAX_GUARDIANS = 5;
    uint256 public constant MAX_ENTRIES = 16;
    uint256 public constant MAX_VALUE_LENGTH = 256;
    uint256 public constant ACTIVE_KEY_VALIDITY = 3650 days;
    bytes32 public constant SIG_AUTH = "sigAuth";
    bytes32 public constant VERI_KEY = "veriKey";

    bytes32 private constant SETUP_TYPEHASH =
        keccak256("Setup(address identity,address activeKey,address[] guardians,uint8 threshold,uint256 nonce)");
    bytes32 private constant OPERATE_TYPEHASH = keccak256("Operate(address identity,bytes data,uint256 nonce)");
    bytes32 private constant REQUEST_CHANGE_TYPEHASH = keccak256(
        "RequestChange(address identity,address newOwner,address[] guardians,uint8 threshold,uint256 nonce)"
    );
    bytes32 private constant CANCEL_CHANGE_TYPEHASH = keccak256("CancelChange(address identity,uint256 changeId)");
    bytes32 private constant START_RECOVERY_TYPEHASH =
        keccak256("StartRecovery(address identity,address newKey,uint256 nonce)");
    bytes32 private constant VETO_TYPEHASH = keccak256("Veto(address identity,uint256 recoveryId)");

    enum ChangeKind {
        None,
        Withdraw,
        Guardians
    }

    struct Change {
        ChangeKind kind;
        address newOwner;
        uint8 newThreshold;
        uint64 executableAt;
        uint256 id;
        address[] newGuardians;
    }

    struct Recovery {
        address newKey;
        uint64 executableAt;
        uint256 approvals; // bitmap por índice de guardián
        uint256 id;
    }

    /// @notice Delegado o atributo registrado por la clave activa a través de operate().
    struct Entry {
        bool isDelegate;
        bytes32 key; // tipo de delegado o nombre de atributo
        address delegate;
        bytes value;
    }

    struct Config {
        address activeKey;
        uint8 threshold;
        bool active;
        address[] guardians;
        Change change;
        Recovery recovery;
        Entry[] entries;
    }

    IERC1056 public immutable registry;
    mapping(address => Config) private _configs;
    /// @notice Nonces separados: un ladrón con la clave activa no puede invalidar las
    ///   firmas que están juntando los guardianes.
    mapping(address => uint256) public opNonces;
    mapping(address => uint256) public guardianNonces;
    uint256 private _lastId;

    event RecoverySetUp(address indexed identity, address activeKey, address[] guardians, uint8 threshold);
    event RecoveryActivated(address indexed identity, address activeKey);
    event Operated(address indexed identity, bytes4 selector);
    event ChangeRequested(
        address indexed identity, uint256 indexed id, ChangeKind kind, address newOwner, uint64 executableAt
    );
    event ChangeCancelled(address indexed identity, uint256 indexed id);
    event ChangeExecuted(address indexed identity, uint256 indexed id, ChangeKind kind);
    event RecoveryInitiated(address indexed identity, uint256 indexed id, address newKey, uint64 executableAt);
    event RecoveryCancelled(address indexed identity, uint256 indexed id, address guardian);
    event RecoveryExecuted(address indexed identity, uint256 indexed id, address oldKey, address newKey);

    error ZeroRegistry();
    error AlreadyActive(address identity);
    error NotSetUp(address identity);
    error NotActive(address identity);
    error NotOwner(address identity);
    error InvalidGuardians();
    error InvalidThreshold();
    error InvalidKey();
    error BadSignature();
    error BadCall();
    error ValueTooLong();
    error TooManyEntries();
    error ChangePending(address identity);
    error NoChangePending(address identity);
    error RecoveryPending(address identity);
    error NoRecoveryPending(address identity);
    error TimelockActive(uint64 executableAt);
    error NotGuardian(address account);
    error DuplicateGuardian(address guardian);
    error GuardianApprovedRecovery(address guardian);
    error NotEnoughGuardians(uint256 count, uint256 threshold);
    error LengthMismatch();

    constructor(IERC1056 registry_) EIP712("E24Recovery", "1") {
        if (address(registry_) == address(0)) revert ZeroRegistry();
        registry = registry_;
    }

    // ------------------------------------------------------------------
    // Configuración
    // ------------------------------------------------------------------

    /// @notice Paso 1: el dueño vigente de la identidad en ERC-1056 firma la configuración.
    ///   Paso 2: ese dueño hace changeOwner(identity, este contrato). Paso 3: activate().
    function setup(
        address identity,
        address activeKey,
        address[] calldata guardians,
        uint8 threshold,
        bytes calldata ownerSignature
    ) external {
        Config storage c = _configs[identity];
        if (c.active) revert AlreadyActive(identity);
        bytes32 structHash = keccak256(
            abi.encode(SETUP_TYPEHASH, identity, activeKey, _hashAddresses(guardians), threshold, opNonces[identity])
        );
        _requireSignature(registry.identityOwner(identity), structHash, ownerSignature);
        ++opNonces[identity];
        _validate(identity, activeKey, guardians, threshold);
        c.activeKey = activeKey;
        c.threshold = threshold;
        c.guardians = guardians;
        emit RecoverySetUp(identity, activeKey, guardians, threshold);
    }

    /// @notice Cualquiera puede activarla una vez que este contrato es el dueño en ERC-1056.
    function activate(address identity) external {
        Config storage c = _configs[identity];
        if (c.activeKey == address(0)) revert NotSetUp(identity);
        if (c.active) revert AlreadyActive(identity);
        if (registry.identityOwner(identity) != address(this)) revert NotOwner(identity);
        c.active = true;
        _delegate(identity, c.activeKey);
        emit RecoveryActivated(identity, c.activeKey);
    }

    /// @notice Renueva la vigencia de los delegados de la clave activa.
    function refreshActiveKey(address identity) external {
        _delegate(identity, _activeConfig(identity).activeKey);
    }

    // ------------------------------------------------------------------
    // Operación normal (inmediata)
    // ------------------------------------------------------------------

    /// @notice Reenvía a ERC-1056 una llamada firmada por la clave activa. Solo se permiten
    ///   addDelegate, revokeDelegate, setAttribute y revokeAttribute sobre esta identidad.
    function operate(address identity, bytes calldata data, bytes calldata activeKeySignature) external {
        Config storage c = _activeConfig(identity);
        _requireSignature(
            c.activeKey,
            keccak256(abi.encode(OPERATE_TYPEHASH, identity, keccak256(data), opNonces[identity])),
            activeKeySignature
        );
        ++opNonces[identity];
        _track(c, identity, data);
        (bool ok, bytes memory ret) = address(registry).call(data);
        if (!ok) _bubble(ret);
        emit Operated(identity, bytes4(data[:4]));
    }

    // ------------------------------------------------------------------
    // Cambios que debilitan la recuperación (timelock + cancelables)
    // ------------------------------------------------------------------

    /// @notice Retirar la recuperación (newOwner != 0, guardians vacío) o cambiar
    ///   guardianes y umbral (newOwner == 0). Firmado por la clave activa.
    function requestChange(
        address identity,
        address newOwner,
        address[] calldata guardians,
        uint8 threshold,
        bytes calldata activeKeySignature
    ) external {
        Config storage c = _activeConfig(identity);
        if (c.change.kind != ChangeKind.None) revert ChangePending(identity);
        _requireSignature(
            c.activeKey, _requestChangeHash(identity, newOwner, guardians, threshold), activeKeySignature
        );
        ++opNonces[identity];
        ChangeKind kind;
        if (newOwner != address(0)) {
            if (guardians.length != 0 || threshold != 0) revert InvalidGuardians();
            kind = ChangeKind.Withdraw;
        } else {
            _validate(identity, c.activeKey, guardians, threshold);
            kind = ChangeKind.Guardians;
        }
        Change storage ch = c.change;
        ch.kind = kind;
        ch.newOwner = newOwner;
        ch.newGuardians = guardians;
        ch.newThreshold = threshold;
        ch.executableAt = uint64(block.timestamp + TIMELOCK);
        ch.id = ++_lastId;
        emit ChangeRequested(identity, ch.id, kind, newOwner, ch.executableAt);
    }

    /// @notice k guardianes cancelan un cambio pendiente.
    function cancelChange(address identity, address[] calldata signers, bytes[] calldata signatures) external {
        Config storage c = _activeConfig(identity);
        if (c.change.kind == ChangeKind.None) revert NoChangePending(identity);
        uint256 id = c.change.id;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_CHANGE_TYPEHASH, identity, id)));
        (uint256 count,) = _guardianApprovals(c, digest, signers, signatures);
        if (count < c.threshold) revert NotEnoughGuardians(count, c.threshold);
        delete c.change;
        emit ChangeCancelled(identity, id);
    }

    /// @notice Cualquiera ejecuta un cambio cuando venció el timelock.
    function executeChange(address identity) external {
        Config storage c = _activeConfig(identity);
        Change storage ch = c.change;
        if (ch.kind == ChangeKind.None) revert NoChangePending(identity);
        if (block.timestamp < ch.executableAt) revert TimelockActive(ch.executableAt);
        uint256 id = ch.id;
        ChangeKind kind = ch.kind;
        if (kind == ChangeKind.Guardians) {
            c.guardians = ch.newGuardians;
            c.threshold = ch.newThreshold;
            delete c.change;
        } else {
            address newOwner = ch.newOwner;
            address key = c.activeKey;
            delete _configs[identity];
            _undelegate(identity, key);
            registry.changeOwner(identity, newOwner);
        }
        emit ChangeExecuted(identity, id, kind);
    }

    // ------------------------------------------------------------------
    // Recuperación
    // ------------------------------------------------------------------

    /// @notice k guardianes proponen una clave activa nueva. Empieza el timelock de 72 h.
    function startRecovery(
        address identity,
        address newKey,
        address[] calldata signers,
        bytes[] calldata signatures
    ) external {
        Config storage c = _activeConfig(identity);
        if (c.recovery.newKey != address(0)) revert RecoveryPending(identity);
        if (newKey == address(0) || newKey == c.activeKey || _isGuardian(c, newKey)) {
            revert InvalidKey();
        }
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(START_RECOVERY_TYPEHASH, identity, newKey, guardianNonces[identity]))
        );
        (uint256 count, uint256 approvals) = _guardianApprovals(c, digest, signers, signatures);
        if (count < c.threshold) revert NotEnoughGuardians(count, c.threshold);
        ++guardianNonces[identity];
        uint64 executableAt = uint64(block.timestamp + TIMELOCK);
        uint256 id = ++_lastId;
        c.recovery = Recovery({newKey: newKey, executableAt: executableAt, approvals: approvals, id: id});
        emit RecoveryInitiated(identity, id, newKey, executableAt);
    }

    /// @notice Veto: la clave activa más un guardián que no aprobó la recuperación firman
    ///   Veto(identity, recoveryId). La clave activa sola no basta (podría estar robada).
    function veto(
        address identity,
        bytes calldata activeKeySignature,
        address guardian,
        bytes calldata guardianSignature
    ) external {
        Config storage c = _activeConfig(identity);
        Recovery storage r = c.recovery;
        if (r.newKey == address(0)) revert NoRecoveryPending(identity);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(VETO_TYPEHASH, identity, r.id)));
        if (!SignatureChecker.isValidSignatureNow(c.activeKey, digest, activeKeySignature)) revert BadSignature();
        uint256 bit = 1 << _guardianIndex(c, guardian);
        if (r.approvals & bit != 0) revert GuardianApprovedRecovery(guardian);
        if (!SignatureChecker.isValidSignatureNow(guardian, digest, guardianSignature)) revert BadSignature();
        uint256 id = r.id;
        delete c.recovery;
        emit RecoveryCancelled(identity, id, guardian);
    }

    /// @notice Cualquiera ejecuta la recuperación cuando venció el timelock.
    function executeRecovery(address identity) external {
        Config storage c = _activeConfig(identity);
        Recovery memory r = c.recovery;
        if (r.newKey == address(0)) revert NoRecoveryPending(identity);
        if (block.timestamp < r.executableAt) revert TimelockActive(r.executableAt);
        address oldKey = c.activeKey;
        _undelegate(identity, oldKey);
        for (uint256 i = 0; i < c.entries.length; ++i) {
            Entry storage e = c.entries[i];
            if (e.isDelegate) {
                registry.revokeDelegate(identity, e.key, e.delegate);
            } else {
                registry.revokeAttribute(identity, e.key, e.value);
            }
        }
        delete c.entries;
        delete c.change;
        delete c.recovery;
        c.activeKey = r.newKey;
        _delegate(identity, r.newKey);
        emit RecoveryExecuted(identity, r.id, oldKey, r.newKey);
    }

    // ------------------------------------------------------------------
    // Lectura
    // ------------------------------------------------------------------

    function getConfig(address identity)
        external
        view
        returns (address activeKey, address[] memory guardians, uint8 threshold, bool active)
    {
        Config storage c = _configs[identity];
        return (c.activeKey, c.guardians, c.threshold, c.active);
    }

    function getRecovery(address identity) external view returns (Recovery memory) {
        return _configs[identity].recovery;
    }

    function getChange(address identity) external view returns (Change memory) {
        return _configs[identity].change;
    }

    function getEntries(address identity) external view returns (Entry[] memory) {
        return _configs[identity].entries;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------
    // Internas
    // ------------------------------------------------------------------

    function _activeConfig(address identity) private view returns (Config storage c) {
        c = _configs[identity];
        if (!c.active) revert NotActive(identity);
    }

    function _validate(address identity, address activeKey, address[] calldata guardians, uint8 threshold)
        private
        pure
    {
        uint256 n = guardians.length;
        if (n < MIN_GUARDIANS || n > MAX_GUARDIANS) revert InvalidGuardians();
        if (uint256(threshold) * 2 <= n || threshold > n) revert InvalidThreshold();
        if (activeKey == address(0)) revert InvalidKey();
        for (uint256 i = 0; i < n; ++i) {
            address g = guardians[i];
            if (g == address(0) || g == identity || g == activeKey) revert InvalidGuardians();
            for (uint256 j = 0; j < i; ++j) {
                if (guardians[j] == g) revert InvalidGuardians();
            }
        }
    }

    function _guardianIndex(Config storage c, address account) private view returns (uint256) {
        for (uint256 i = 0; i < c.guardians.length; ++i) {
            if (c.guardians[i] == account) return i;
        }
        revert NotGuardian(account);
    }

    function _isGuardian(Config storage c, address account) private view returns (bool) {
        for (uint256 i = 0; i < c.guardians.length; ++i) {
            if (c.guardians[i] == account) return true;
        }
        return false;
    }

    function _guardianApprovals(
        Config storage c,
        bytes32 digest,
        address[] calldata signers,
        bytes[] calldata signatures
    ) private view returns (uint256 count, uint256 bitmap) {
        if (signers.length != signatures.length) revert LengthMismatch();
        for (uint256 i = 0; i < signers.length; ++i) {
            uint256 bit = 1 << _guardianIndex(c, signers[i]);
            if (bitmap & bit != 0) revert DuplicateGuardian(signers[i]);
            if (!SignatureChecker.isValidSignatureNow(signers[i], digest, signatures[i])) revert BadSignature();
            bitmap |= bit;
            ++count;
        }
    }

    function _track(Config storage c, address identity, bytes calldata data) private {
        if (data.length < 36 || abi.decode(data[4:36], (address)) != identity) revert BadCall();
        bytes4 selector = bytes4(data[:4]);
        if (selector == IERC1056.addDelegate.selector) {
            (, bytes32 delegateType, address delegate,) = abi.decode(data[4:], (address, bytes32, address, uint256));
            _addEntry(c, Entry(true, delegateType, delegate, ""));
        } else if (selector == IERC1056.revokeDelegate.selector) {
            (, bytes32 delegateType, address delegate) = abi.decode(data[4:], (address, bytes32, address));
            _removeEntry(c, Entry(true, delegateType, delegate, ""));
        } else if (selector == IERC1056.setAttribute.selector) {
            (, bytes32 name, bytes memory value,) = abi.decode(data[4:], (address, bytes32, bytes, uint256));
            if (value.length > MAX_VALUE_LENGTH) revert ValueTooLong();
            _addEntry(c, Entry(false, name, address(0), value));
        } else if (selector == IERC1056.revokeAttribute.selector) {
            (, bytes32 name, bytes memory value) = abi.decode(data[4:], (address, bytes32, bytes));
            _removeEntry(c, Entry(false, name, address(0), value));
        } else {
            revert BadCall();
        }
    }

    function _findEntry(Config storage c, Entry memory e) private view returns (bool found, uint256 index) {
        bytes32 valueHash = keccak256(e.value);
        for (uint256 i = 0; i < c.entries.length; ++i) {
            Entry storage x = c.entries[i];
            if (
                x.isDelegate == e.isDelegate && x.key == e.key && x.delegate == e.delegate
                    && keccak256(x.value) == valueHash
            ) return (true, i);
        }
        return (false, 0);
    }

    function _addEntry(Config storage c, Entry memory e) private {
        (bool found,) = _findEntry(c, e);
        if (found) return;
        if (c.entries.length >= MAX_ENTRIES) revert TooManyEntries();
        c.entries.push(e);
    }

    function _removeEntry(Config storage c, Entry memory e) private {
        (bool found, uint256 index) = _findEntry(c, e);
        if (!found) return;
        uint256 last = c.entries.length - 1;
        if (index != last) c.entries[index] = c.entries[last];
        c.entries.pop();
    }

    function _delegate(address identity, address key) private {
        registry.addDelegate(identity, SIG_AUTH, key, ACTIVE_KEY_VALIDITY);
        registry.addDelegate(identity, VERI_KEY, key, ACTIVE_KEY_VALIDITY);
    }

    function _undelegate(address identity, address key) private {
        registry.revokeDelegate(identity, SIG_AUTH, key);
        registry.revokeDelegate(identity, VERI_KEY, key);
    }

    function _requireSignature(address signer, bytes32 structHash, bytes calldata signature) private view {
        if (!SignatureChecker.isValidSignatureNow(signer, _hashTypedDataV4(structHash), signature)) {
            revert BadSignature();
        }
    }

    function _requestChangeHash(address identity, address newOwner, address[] calldata guardians, uint8 threshold)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                REQUEST_CHANGE_TYPEHASH, identity, newOwner, _hashAddresses(guardians), threshold, opNonces[identity]
            )
        );
    }

    function _hashAddresses(address[] calldata addresses) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(addresses));
    }

    function _bubble(bytes memory ret) private pure {
        if (ret.length == 0) revert BadCall();
        assembly {
            revert(add(ret, 32), mload(ret))
        }
    }
}
