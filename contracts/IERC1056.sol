// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
pragma solidity 0.8.24;

/// @title IERC1056
/// @notice Las funciones de EthereumDIDRegistry (ERC-1056) que usan los contratos de E24.
///   E24 no modifica ERC-1056: usa una instancia desplegada del contrato de referencia.
interface IERC1056 {
    function identityOwner(address identity) external view returns (address);

    function validDelegate(address identity, bytes32 delegateType, address delegate) external view returns (bool);

    function changeOwner(address identity, address newOwner) external;

    function addDelegate(address identity, bytes32 delegateType, address delegate, uint256 validity) external;

    function revokeDelegate(address identity, bytes32 delegateType, address delegate) external;

    function setAttribute(address identity, bytes32 name, bytes calldata value, uint256 validity) external;

    function revokeAttribute(address identity, bytes32 name, bytes calldata value) external;
}
