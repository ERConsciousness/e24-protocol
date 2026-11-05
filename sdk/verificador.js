// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Verificador de presentaciones E24 (E24-RFC-0001 §7.6): los cinco chequeos,
// con validez y reconocimiento reportados por separado. Solo lee ERC-1056 y
// E24AnchorRegistry.
//
// Limitaciones de esta versión (lanzamiento mínimo L0), por resolver en F3:
// - Chequeo 2: el método del emisor "vigente en anchoredAt" se toma del
//   evento CredentialAnchored, cuyo `sender` es la clave que el contrato
//   autorizó al anclar. Se exige que esa misma clave haya firmado la credencial.
// - Chequeo 5: listas de confianza solo a profundidad 1.

"use strict";

const { ethers } = require("ethers");
const cs = require("./cryptosuite");
const { resolver, direccionDeDid } = require("./resolver");

const VENTANA_RETO = 5 * 60; // §7.6: DEBERÍA rechazar retos a más de 5 minutos

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function direccionesFirmantes(doc) {
  return cs.firmantesPosibles(doc).map(cs.direccionDeClavePublica);
}

/**
 * @param {{credencial: object, reto: object}} presentacion
 * @param {object} o  registry, anchors (ethers.Contract), nonce, dominio,
 *   listas (url → ListaConfianzaE24), raices (urls), tipo, ahora (Unix; por defecto, el último bloque),
 *   desdeBloque (bloque de despliegue de E24AnchorRegistry)
 */
async function verificarPresentacion(presentacion, o) {
  const { credencial: vc, reto } = presentacion;
  if (!cs.dentroDeLimites(vc) || !cs.dentroDeLimites(reto)) {
    return {
      hash: null, valida: false, validez: { 1: false, 2: false, 3: false, 4: false },
      reconocimiento: { reconocido: false, lista: null, instancia: null },
      motivos: ["documento fuera de los límites de tamaño o anidamiento (§7.2.3)"],
    };
  }
  const provider = o.registry.runner.provider ?? o.registry.runner;
  const ahora = o.ahora ?? (await provider.getBlock("latest")).timestamp;
  const tipo = o.tipo ?? "CedulaE24";
  const motivos = [];
  const falla = (n, texto) => {
    motivos.push(`${n}: ${texto}`);
    return false;
  };

  // 1 · Reto firmado por el titular, que no está suspendido ni desactivado.
  let c1 = true;
  if (reto?.type !== "RetoE24") c1 = falla(1, "no es un RetoE24");
  else if (reto.nonce !== o.nonce || reto.dominio !== o.dominio) c1 = falla(1, "nonce o dominio no son los del verificador");
  else if (Math.abs(ahora - unix(reto.creadoEn)) > VENTANA_RETO) c1 = falla(1, "reto fuera de la ventana de 5 minutos");
  else {
    const { documento, metadatos } = await resolver(reto.titular, { registry: o.registry, ahora });
    if (metadatos.desactivado) c1 = falla(1, "DID del titular desactivado");
    else if (documento.e24.estado !== "activo") c1 = falla(1, `DID del titular ${documento.e24.estado}`);
    else if (!cs.pruebaValida(reto, documento, "authentication")) c1 = falla(1, "firma del reto no válida para el DID del titular");
  }

  // 3 · Ancla vigente, con el mismo emisor (se calcula antes porque el 2 usa su evento).
  const hash = cs.hashDeAncla(vc);
  const emisor = direccionDeDid(vc.issuer);
  const ancla = await o.anchors.anchors(hash);
  let c3 = true;
  if (ancla.anchoredAt === 0n) c3 = falla(3, "hash no anclado");
  else if (ancla.issuer.toLowerCase() !== emisor) c3 = falla(3, "el emisor del ancla no coincide");
  else if (ancla.revoked) c3 = falla(3, "credencial revocada por el emisor");

  // 2 · Firma del emisor con un método vigente al anclar.
  let c2 = true;
  const prueba = vc.proof ?? {};
  if (prueba.cryptosuite !== cs.CRYPTOSUITE || prueba.proofPurpose !== "assertionMethod") {
    c2 = falla(2, "prueba del emisor con suite o propósito incorrectos");
  } else if (ancla.anchoredAt > 0n) {
    // `desdeBloque` (el bloque de despliegue) evita pedir logs desde el génesis a un RPC público.
    const [ev] = await o.anchors.queryFilter(o.anchors.filters.CredentialAnchored(hash), o.desdeBloque ?? 0);
    const clave = ev.args.sender.toLowerCase();
    const metodosAceptados = [`${vc.issuer}#delegado-${clave}`];
    if (clave === emisor) metodosAceptados.push(`${vc.issuer}#raiz`);
    if (!metodosAceptados.includes(prueba.verificationMethod)) c2 = falla(2, "el método de la prueba no es la clave que ancló");
    else if (!direccionesFirmantes(vc).includes(clave)) c2 = falla(2, "firma del emisor no válida");
  } else {
    // Sin ancla no hay anchoredAt: se evalúa contra el documento DID actual.
    const { documento } = await resolver(vc.issuer, { registry: o.registry, ahora });
    if (!cs.pruebaValida(vc, documento, "assertionMethod")) c2 = falla(2, "firma del emisor no válida");
  }
  if (vc.validFrom && unix(vc.validFrom) > ahora) c2 = falla(2, "credencial todavía no vigente");
  if (vc.validUntil && unix(vc.validUntil) <= ahora) c2 = falla(2, "credencial vencida");

  // 4 · El sujeto es quien firmó el reto.
  const c4 = vc.credentialSubject?.id === reto?.titular || falla(4, "el sujeto de la credencial no es el titular del reto");

  // 5 · Reconocimiento: alguna lista raíz del verificador incluye al emisor para este tipo.
  let reconocimiento = { reconocido: false, lista: null, instancia: null };
  if (!(vc.type ?? []).includes(tipo)) falla(5, `la credencial no es ${tipo}`);
  else {
    for (const url of o.raices ?? []) {
      const lista = o.listas?.[url];
      if (!lista || !(lista.type ?? []).includes("ListaConfianzaE24")) continue;
      if (unix(lista.validFrom) > ahora || (lista.validUntil && unix(lista.validUntil) <= ahora)) continue;
      const { documento } = await resolver(lista.issuer, { registry: o.registry, ahora });
      if (!cs.pruebaValida(lista, documento, "assertionMethod")) continue;
      const entrada = lista.credentialSubject.emisores.find((e) => e.id === vc.issuer && e.tipos.includes(tipo));
      if (entrada && unix(entrada.desde) <= ahora) {
        reconocimiento = { reconocido: true, lista: url, instancia: lista.issuer };
        break;
      }
    }
    if (!reconocimiento.reconocido) falla(5, "el emisor no está en ninguna de las listas del verificador");
  }

  const validez = { 1: c1, 2: c2, 3: c3, 4: c4 };
  return {
    hash,
    valida: Object.values(validez).every(Boolean),
    validez,
    reconocimiento,
    motivos,
  };
}

/** Texto para el usuario, como en §7.6. */
function resumen(r, nombres = {}) {
  const v = r.valida ? "Credencial válida" : "Credencial NO válida";
  const rec = r.reconocimiento.reconocido
    ? `emisor reconocido por ${nombres[r.reconocimiento.instancia] ?? r.reconocimiento.instancia}`
    : "emisor no reconocido por ninguna de tus listas";
  return `${v} · ${rec}`;
}

module.exports = { verificarPresentacion, resumen, unix, VENTANA_RETO };
