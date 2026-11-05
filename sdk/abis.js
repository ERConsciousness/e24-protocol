// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Fragmentos de ABI que usan el resolver y el verificador. Solo lectura:
// el verificador no necesita más que esto (plan v0.6 §4.2).

"use strict";

const ERC1056 = [
  "function identityOwner(address identity) view returns (address)",
  "function validDelegate(address identity, bytes32 delegateType, address delegate) view returns (bool)",
  "function changed(address identity) view returns (uint256)",
  "event DIDOwnerChanged(address indexed identity, address owner, uint256 previousChange)",
  "event DIDDelegateChanged(address indexed identity, bytes32 delegateType, address delegate, uint256 validTo, uint256 previousChange)",
  "event DIDAttributeChanged(address indexed identity, bytes32 name, bytes value, uint256 validTo, uint256 previousChange)",
];

const E24_ANCHOR_REGISTRY = [
  "function anchors(bytes32 hash) view returns (address issuer, uint64 anchoredAt, bool revoked)",
  "event CredentialAnchored(bytes32 indexed hash, address indexed issuer, address indexed sender)",
  "event CredentialRevoked(bytes32 indexed hash, address indexed issuer, address indexed sender)",
];

module.exports = { ERC1056, E24_ANCHOR_REGISTRY };
