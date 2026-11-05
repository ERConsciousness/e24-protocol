// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Solo para pruebas: una cuenta de contrato mínima (como un Safe de un firmante)
///   que ejecuta llamadas en su propio nombre y valida firmas con ERC-1271.
contract MockERC1271Wallet {
    address public immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return err == ECDSA.RecoverError.NoError && recovered == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function exec(address target, bytes calldata data) external {
        require(msg.sender == signer, "solo el firmante");
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
