// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC1056} from "./IERC1056.sol";

/// @title E24AnchorRegistry
/// @notice Anclas de credenciales E24 (E24-RFC-0001 §7.5).
///   - Sin administrador: nadie, incluidos sus autores, tiene poder sobre anclas ajenas.
///   - No registra al titular: solo hash, emisor, momento y estado.
///   - Ancla o revoca el dueño vigente del emisor en ERC-1056 o un delegado `veriKey` vigente.
///   - Toda operación tiene una variante firmada (EIP-712) que cualquier relayer puede enviar.
/// @dev SIMULACIÓN EDUCATIVA / testnet · sin validez jurídica.
contract E24AnchorRegistry is EIP712 {
    uint16 public constant RESOLVER_VERSION = 1;
    bytes32 public constant VERI_KEY = "veriKey";

    bytes32 private constant ANCHOR_TYPEHASH = keccak256("Anchor(address issuer,bytes32 hash,uint256 nonce)");
    bytes32 private constant REVOKE_TYPEHASH = keccak256("Revoke(bytes32 hash,uint256 nonce)");

    struct Anchor {
        address issuer; // dirección del DID emisor (no la del delegado)
        uint64 anchoredAt; // Unix
        bool revoked; // solo el emisor puede marcarlo
    }

    /// @notice El registro ERC-1056 de esta red. Fijo para siempre.
    IERC1056 public immutable registry;
    /// @notice hash de la credencial (o raíz Merkle de un lote) → ancla
    mapping(bytes32 => Anchor) public anchors;
    /// @notice Nonce por firmante para las operaciones firmadas
    mapping(address => uint256) public nonces;

    /// @param sender Quien ejecutó la operación (dueño o delegado), para poder rastrear
    ///   y revocar lo anclado por un delegado comprometido.
    event CredentialAnchored(bytes32 indexed hash, address indexed issuer, address indexed sender);
    event CredentialRevoked(bytes32 indexed hash, address indexed issuer, address indexed sender);

    error ZeroRegistry();
    error NotAuthorized(address sender, address issuer);
    error AlreadyAnchored(bytes32 hash);
    error NotAnchored(bytes32 hash);
    error AlreadyRevoked(bytes32 hash);
    error BadSignature();

    constructor(IERC1056 registry_) EIP712("E24AnchorRegistry", "1") {
        if (address(registry_) == address(0)) revert ZeroRegistry();
        registry = registry_;
    }

    /// @notice ¿Puede `sender` anclar o revocar en nombre de `issuer`?
    function isAuthorized(address issuer, address sender) public view returns (bool) {
        return sender == registry.identityOwner(issuer) || registry.validDelegate(issuer, VERI_KEY, sender);
    }

    function anchorCredential(address issuer, bytes32 hash) external {
        _anchor(issuer, hash, msg.sender);
    }

    /// @notice Variante para relayers: `signer` firmó Anchor(issuer, hash, nonce) con EIP-712.
    ///   Acepta firmas de cuentas de clave y de contratos (ERC-1271).
    function anchorCredentialSigned(address issuer, bytes32 hash, address signer, bytes calldata signature) external {
        _useSignature(signer, keccak256(abi.encode(ANCHOR_TYPEHASH, issuer, hash, nonces[signer])), signature);
        _anchor(issuer, hash, signer);
    }

    function revokeCredential(bytes32 hash) external {
        _revoke(hash, msg.sender);
    }

    function revokeCredentialSigned(bytes32 hash, address signer, bytes calldata signature) external {
        _useSignature(signer, keccak256(abi.encode(REVOKE_TYPEHASH, hash, nonces[signer])), signature);
        _revoke(hash, signer);
    }

    /// @notice Separador de dominio EIP-712, para que las billeteras armen las firmas.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _useSignature(address signer, bytes32 structHash, bytes calldata signature) private {
        if (!SignatureChecker.isValidSignatureNow(signer, _hashTypedDataV4(structHash), signature)) {
            revert BadSignature();
        }
        unchecked {
            ++nonces[signer];
        }
    }

    function _anchor(address issuer, bytes32 hash, address sender) private {
        if (!isAuthorized(issuer, sender)) revert NotAuthorized(sender, issuer);
        if (anchors[hash].issuer != address(0)) revert AlreadyAnchored(hash);
        anchors[hash] = Anchor({issuer: issuer, anchoredAt: uint64(block.timestamp), revoked: false});
        emit CredentialAnchored(hash, issuer, sender);
    }

    function _revoke(bytes32 hash, address sender) private {
        Anchor storage ancla = anchors[hash];
        if (ancla.issuer == address(0)) revert NotAnchored(hash);
        if (ancla.revoked) revert AlreadyRevoked(hash);
        if (!isAuthorized(ancla.issuer, sender)) revert NotAuthorized(sender, ancla.issuer);
        ancla.revoked = true;
        emit CredentialRevoked(hash, ancla.issuer, sender);
    }
}
