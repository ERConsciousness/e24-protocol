// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
const path = require("path");
const { ethers } = require("hardhat");

const VERI_KEY = ethers.encodeBytes32String("veriKey");
const SIG_AUTH = ethers.encodeBytes32String("sigAuth");
const TIMELOCK = 72 * 3600;
const UN_ANIO = 365 * 86400;

/** Test vector #1 de E24-RFC-0001: usamos sus claves para que las anclas coincidan. */
const VECTOR = require(path.join(__dirname, "..", "rfc", "E24-RFC-0001-test-vector-1.json"));

/** Cuenta de clave determinística y SIN fondos: todo lo envía un relayer. */
function cuenta(nombre) {
  return new ethers.Wallet(ethers.id(`E24-TEST-${nombre}`), ethers.provider);
}

function cuentaDesdeHex(privateKeyHex) {
  return new ethers.Wallet("0x" + privateKeyHex, ethers.provider);
}

async function desplegar() {
  const [relayer, otro] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("EthereumDIDRegistry")).deploy();
  const anchors = await (await ethers.getContractFactory("E24AnchorRegistry")).deploy(registry.target);
  const recovery = await (await ethers.getContractFactory("E24Recovery")).deploy(registry.target);
  return { relayer, otro, registry, anchors, recovery };
}

async function dominio(contrato, nombre) {
  const { chainId } = await ethers.provider.getNetwork();
  return { name: nombre, version: "1", chainId, verifyingContract: contrato.target };
}

/** Firma "cruda" de las funciones …Signed de ERC-1056 (formato propio, anterior a EIP-712). */
async function firmaErc1056(registry, firmante, identity, fn, tipos, valores) {
  const nonce = await registry.nonce(await registry.identityOwner(identity));
  const hash = ethers.solidityPackedKeccak256(
    ["bytes1", "bytes1", "address", "uint256", "address", "string", ...tipos],
    ["0x19", "0x00", registry.target, nonce, identity, fn, ...valores]
  );
  return firmante.signingKey.sign(hash);
}

async function cambiarDuenoFirmado(registry, relayer, firmante, identity, nuevo) {
  const s = await firmaErc1056(registry, firmante, identity, "changeOwner", ["address"], [nuevo]);
  return registry.connect(relayer).changeOwnerSigned(identity, s.v, s.r, s.s, nuevo);
}

async function agregarDelegadoFirmado(registry, relayer, firmante, identity, tipo, delegado, vigencia) {
  const s = await firmaErc1056(registry, firmante, identity, "addDelegate",
    ["bytes32", "address", "uint256"], [tipo, delegado, vigencia]);
  return registry.connect(relayer).addDelegateSigned(identity, s.v, s.r, s.s, tipo, delegado, vigencia);
}

async function revocarDelegadoFirmado(registry, relayer, firmante, identity, tipo, delegado) {
  const s = await firmaErc1056(registry, firmante, identity, "revokeDelegate",
    ["bytes32", "address"], [tipo, delegado]);
  return registry.connect(relayer).revokeDelegateSigned(identity, s.v, s.r, s.s, tipo, delegado);
}

function hashDe(texto) {
  return ethers.sha256(ethers.toUtf8Bytes(texto));
}

module.exports = {
  VERI_KEY, SIG_AUTH, TIMELOCK, UN_ANIO, VECTOR,
  cuenta, cuentaDesdeHex, desplegar, dominio, hashDe,
  cambiarDuenoFirmado, agregarDelegadoFirmado, revocarDelegadoFirmado,
};
