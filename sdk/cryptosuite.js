// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Cryptosuite `ecdsa-secp256k1-jcs-e24-2026` (E24-RFC-0001 §7.2.2), en JS.
// Tercera implementación, tras `rfc/gen_test_vector.py` y la simulación; debe
// reproducir el test vector #1 byte a byte.
//
//   datos   = SHA-256(JCS(config de la prueba, con @context)) ‖ SHA-256(JCS(documento sin proof))
//   firma   = ECDSA secp256k1 RFC 6979 sobre SHA-256(datos), low-S obligatorio
//   proofValue = multibase base58btc (prefijo z) de r ‖ s, en su única forma canónica

"use strict";

const { ethers } = require("ethers");

const CRYPTOSUITE = "ecdsa-secp256k1-jcs-e24-2026";
const N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
// Límites contra agotamiento de recursos (§7.2.3).
const MAX_BYTES_DOCUMENTO = 64 * 1024;
const MAX_PROFUNDIDAD = 32;

/** JCS (RFC 8785) para el subconjunto de E24-V1: sin números de punto flotante. */
function jcs(valor) {
  const ser = (o, nivel = 0) => {
    if (nivel > MAX_PROFUNDIDAD) throw new RangeError("documento demasiado anidado");
    if (o === null) return "null";
    if (o === true) return "true";
    if (o === false) return "false";
    if (typeof o === "number") {
      if (!Number.isSafeInteger(o)) throw new TypeError("E24-V1 no usa números de punto flotante");
      return String(o);
    }
    if (typeof o === "string") return JSON.stringify(o);
    if (Array.isArray(o)) return "[" + o.map((x) => ser(x, nivel + 1)).join(",") + "]";
    if (typeof o === "object") {
      // El orden por defecto de JS compara unidades UTF-16, como exige RFC 8785.
      return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + ser(o[k], nivel + 1)).join(",") + "}";
    }
    throw new TypeError(`tipo no soportado: ${typeof o}`);
  };
  return ethers.toUtf8Bytes(ser(valor));
}

/** ¿El documento se puede procesar dentro de los límites de §7.2.3? */
function dentroDeLimites(doc) {
  try {
    return jcs(doc).length <= MAX_BYTES_DOCUMENTO;
  } catch {
    return false;
  }
}

function codificarPrueba(r, s) {
  return "z" + ethers.encodeBase58(ethers.concat([r, s]));
}

/** r y s (0x…) de un proofValue, o null si no es la codificación canónica de 64 bytes. */
function decodificarPrueba(valor) {
  if (typeof valor !== "string" || !/^z[1-9A-HJ-NP-Za-km-z]{1,90}$/.test(valor)) return null;
  const n = ethers.decodeBase58(valor.slice(1));
  if (n >= 1n << 512n) return null;
  const bytes = ethers.toBeHex(n, 64);
  if (codificarPrueba(ethers.dataSlice(bytes, 0, 32), ethers.dataSlice(bytes, 32)) !== valor) return null;
  return { r: ethers.dataSlice(bytes, 0, 32), s: ethers.dataSlice(bytes, 32) };
}

function sinPrueba(doc) {
  const { proof: _, ...resto } = doc;
  return resto;
}

function configDePrueba(docSinPrueba, prueba) {
  const { proofValue: _, ...config } = prueba;
  return { ...config, "@context": docSinPrueba["@context"] };
}

/** Los 64 bytes que se firman. */
function datosAFirmar(docSinPrueba, config) {
  return ethers.concat([ethers.sha256(jcs(config)), ethers.sha256(jcs(docSinPrueba))]);
}

/** Agrega una prueba firmada con `clave` (ethers.SigningKey). ethers ya normaliza a low-S. */
function agregarPrueba(doc, clave, metodo, proposito, creado) {
  const prueba = {
    type: "DataIntegrityProof",
    cryptosuite: CRYPTOSUITE,
    verificationMethod: metodo,
    proofPurpose: proposito,
    created: creado,
  };
  const firma = clave.sign(ethers.sha256(datosAFirmar(doc, configDePrueba(doc, prueba))));
  return { ...doc, proof: { ...prueba, proofValue: codificarPrueba(firma.r, firma.s) } };
}

/**
 * Dirección que firmó la prueba, o null si la firma no es válida para E24-V1
 * (longitud, low-S, s o r fuera de rango). Prueba los dos valores de recuperación.
 */
function firmantesPosibles(doc) {
  const prueba = doc.proof;
  if (!prueba || prueba.cryptosuite !== CRYPTOSUITE) return [];
  if (!dentroDeLimites(doc)) return [];
  const firma = decodificarPrueba(prueba.proofValue);
  if (!firma) return [];
  const r = BigInt(firma.r);
  const s = BigInt(firma.s);
  if (r === 0n || r >= N || s === 0n || s > N / 2n) return [];
  const base = sinPrueba(doc);
  const digest = ethers.sha256(datosAFirmar(base, configDePrueba(base, prueba)));
  const candidatas = [];
  for (const v of [27, 28]) {
    try {
      const sig = ethers.Signature.from({ r: firma.r, s: firma.s, v });
      candidatas.push(ethers.SigningKey.recoverPublicKey(digest, sig));
    } catch {
      // ese valor de recuperación no da un punto de la curva
    }
  }
  return candidatas;
}

function direccionDeClavePublica(pub) {
  return ethers.computeAddress(pub).toLowerCase();
}

/** ¿La firma corresponde al método (publicKeyHex o blockchainAccountId)? */
function firmaCoincideConMetodo(doc, metodo) {
  const claves = firmantesPosibles(doc);
  if (metodo.publicKeyHex) {
    const esperada = "0x" + metodo.publicKeyHex.toLowerCase().replace(/^0x/, "");
    return claves.some((c) => c.toLowerCase() === esperada);
  }
  if (metodo.blockchainAccountId?.startsWith("eip155:")) {
    const cuenta = metodo.blockchainAccountId.split(":").pop().toLowerCase();
    return claves.some((c) => direccionDeClavePublica(c) === cuenta);
  }
  // `e24sim:local` usa SHA-256(X‖Y): no es una dirección Ethereum.
  if (metodo.blockchainAccountId?.startsWith("e24sim:")) {
    const cuenta = metodo.blockchainAccountId.split(":").pop().toLowerCase();
    return claves.some((c) => "0x" + ethers.sha256("0x" + c.slice(4)).slice(2, 42) === cuenta);
  }
  return false;
}

/** Verificación completa de la prueba contra el documento DID del firmante (§7.2.2). */
function pruebaValida(doc, docDid, proposito) {
  const prueba = doc.proof;
  if (!prueba || prueba.cryptosuite !== CRYPTOSUITE || prueba.proofPurpose !== proposito) return false;
  const vm = prueba.verificationMethod;
  if (!vm?.startsWith(docDid.id + "#")) return false;
  if (!(docDid[proposito] ?? []).includes(vm)) return false;
  const metodo = (docDid.verificationMethod ?? []).find((m) => m.id === vm);
  return Boolean(metodo) && firmaCoincideConMetodo(doc, metodo);
}

/** Valor del ancla: SHA-256(JCS(VC con proof)). */
function hashDeAncla(vc) {
  return ethers.sha256(jcs(vc));
}

/**
 * Instanciación de la suite (Data Integrity §3; RFC §7.2.3).
 * @param {{cryptosuite: string, clave?: ethers.SigningKey}} opciones
 * @returns instancia con createProof y verifyProof, o null si la suite no es esta.
 */
function instanciar({ cryptosuite, clave } = {}) {
  if (cryptosuite !== CRYPTOSUITE) return null;
  return {
    createProof: (doc, { verificationMethod, proofPurpose, created }) =>
      agregarPrueba(doc, clave, verificationMethod, proofPurpose, created).proof,
    verifyProof: (doc, { docDid, expectedProofPurpose }) => {
      const verified = pruebaValida(doc, docDid, expectedProofPurpose);
      return { verified, verifiedDocument: verified ? sinPrueba(doc) : null };
    },
  };
}

module.exports = {
  CRYPTOSUITE, MAX_BYTES_DOCUMENTO, MAX_PROFUNDIDAD, instanciar, dentroDeLimites, codificarPrueba, decodificarPrueba, jcs, sinPrueba, configDePrueba, datosAFirmar, agregarPrueba,
  firmantesPosibles, firmaCoincideConMetodo, pruebaValida, hashDeAncla, direccionDeClavePublica,
};
