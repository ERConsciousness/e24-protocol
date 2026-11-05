// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Resolver mínimo de `did:e24:eth` (E24-RFC-0001 §6.4) sobre ERC-1056.
// Solo consulta el contrato de ERC-1056: nunca saldos ni tokens (plan v0.6 §4.1).

"use strict";

const { ethers } = require("ethers");

const CTX_DID = "https://www.w3.org/ns/did/v1";
const CTX_SECP_REC = "https://w3id.org/security/suites/secp256k1recovery-2020/v2";
const CTX_E24 = "https://estado24.com/ns/e24/v1";
const SIG_AUTH = ethers.encodeBytes32String("sigAuth");
const VERI_KEY = ethers.encodeBytes32String("veriKey");
const ESTADO = ethers.encodeBytes32String("e24/estado");
const PATRON = /^did:e24:eth:(0x[0-9a-f]{40})$/;
// Límite contra agotamiento de recursos: un dueño puede inflar su propio historial (§8.1).
const MAX_EVENTOS = 4096;

function direccionDeDid(did) {
  const m = PATRON.exec(did);
  if (!m) throw new Error(`no es un did:e24:eth válido (hex en minúsculas): ${did}`);
  return m[1];
}

function didDeDireccion(direccion) {
  return `did:e24:eth:${direccion.toLowerCase()}`;
}

/** Eventos de ERC-1056 de una identidad, en orden cronológico, siguiendo `previousChange`. */
async function historial(registry, identidad, maxEventos = MAX_EVENTOS) {
  const provider = registry.runner.provider ?? registry.runner;
  const tema = ethers.zeroPadValue(identidad, 32);
  const eventos = [];
  let bloque = Number(await registry.changed(identidad));
  while (bloque > 0) {
    const logs = await provider.getLogs({
      address: await registry.getAddress(), fromBlock: bloque, toBlock: bloque, topics: [null, tema],
    });
    let anterior = 0;
    for (const log of logs) {
      const ev = registry.interface.parseLog(log);
      if (!ev) continue;
      eventos.push({ ev, bloque: log.blockNumber, indice: log.index });
      if (eventos.length > maxEventos) throw new Error(`historial de la identidad demasiado largo (más de ${maxEventos} eventos)`);
      const prev = Number(ev.args.previousChange);
      if (prev < bloque) anterior = Math.max(anterior, prev);
    }
    bloque = anterior;
  }
  return eventos.sort((a, b) => a.bloque - b.bloque || a.indice - b.indice);
}

/**
 * Resuelve un `did:e24:eth`. Devuelve { documento, metadatos }.
 * `ahora` (Unix, segundos) decide la vigencia de atributos; por defecto, el último bloque.
 */
async function resolver(did, { registry, ahora, maxEventos } = {}) {
  const identidad = direccionDeDid(did);
  const provider = registry.runner.provider ?? registry.runner;
  const { chainId } = await provider.getNetwork();
  const ultimo = await provider.getBlock("latest");
  const t = BigInt(ahora ?? ultimo.timestamp);

  const dueno = (await registry.identityOwner(identidad)).toLowerCase();
  const eventos = await historial(registry, identidad, maxEventos);

  const candidatos = new Map(); // dirección → Set(tipos)
  let estado = "activo";
  for (const { ev } of eventos) {
    if (ev.name === "DIDDelegateChanged") {
      const d = ev.args.delegate.toLowerCase();
      if (!candidatos.has(d)) candidatos.set(d, new Set());
    } else if (ev.name === "DIDAttributeChanged" && ev.args.name === ESTADO) {
      // El último cambio vigente decide; una revocación (validTo = 0) lo anula.
      if (ev.args.validTo > t) estado = ethers.toUtf8String(ev.args.value);
      else if (ethers.toUtf8String(ev.args.value) === estado) estado = "activo";
    }
  }
  // La vigencia de los delegados la decide el contrato.
  for (const [d, tipos] of candidatos) {
    if (await registry.validDelegate(identidad, SIG_AUTH, d)) tipos.add("sigAuth");
    if (await registry.validDelegate(identidad, VERI_KEY, d)) tipos.add("veriKey");
    if (tipos.size === 0) candidatos.delete(d);
  }

  const raiz = `${did}#raiz`;
  const metodo = (id, cuenta) => ({
    id, type: "EcdsaSecp256k1RecoveryMethod2020", controller: did, blockchainAccountId: `eip155:${chainId}:${cuenta}`,
  });
  const documento = {
    "@context": [CTX_DID, CTX_SECP_REC, CTX_E24],
    id: did,
    controller: did,
    verificationMethod: [metodo(raiz, dueno)],
    authentication: [raiz],
    assertionMethod: [raiz],
  };
  for (const [d, tipos] of [...candidatos].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const id = `${did}#delegado-${d}`;
    documento.verificationMethod.push(metodo(id, d));
    documento.assertionMethod.push(id);
    if (tipos.has("sigAuth")) documento.authentication.push(id);
  }
  const e24 = { protocol: "E24-V1", network: "eth", resolverVersion: 1, estado };
  const cambio = Number(await registry.changed(identidad));
  if (cambio > 0) e24.updatedAt = (await provider.getBlock(cambio)).timestamp;
  documento.e24 = e24;

  return { documento, metadatos: { desactivado: dueno === ethers.ZeroAddress, dueno } };
}

module.exports = { resolver, MAX_EVENTOS, historial, direccionDeDid, didDeDireccion, SIG_AUTH, VERI_KEY, ESTADO };
