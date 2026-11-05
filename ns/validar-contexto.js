// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Valida el contexto JSON-LD `https://estado24.com/ns/e24/v1` con un
// procesador real (jsonld.js) contra los documentos del test vector #1.
// Sin red: todos los contextos se cargan de copias locales fijadas por hash.
//
// Uso: node ns/validar-contexto.js   (termina con código 1 si algo falla)

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jsonld = require("jsonld");

const RAIZ = path.join(__dirname, "..");
const E24 = "https://estado24.com/ns/e24/v1";
const E24NS = "https://estado24.com/ns/e24#";

// URL → [archivo local, SHA-256 esperado]
const CONTEXTOS = {
  [E24]: [
    "ns/e24/v1/context.jsonld",
    "fd39317a85a985e32e193bf80a742e1232daaebf0a22070c12ccabcf5d29f4ed",
  ],
  "https://www.w3.org/ns/credentials/v2": [
    "ns/externos/credentials-v2.jsonld",
    "59955ced6697d61e03f2b2556febe5308ab16842846f5b586d7f1f7adec92734",
  ],
  "https://www.w3.org/ns/did/v1": [
    "ns/externos/did-v1.jsonld",
    "4f3eae5568c9c5f036a082088f9e192019ee06faa78973c87ff91d5421b88dad",
  ],
  "https://w3id.org/security/suites/secp256k1-2019/v1": [
    "ns/externos/secp256k1-2019-v1.jsonld",
    "8452efdde151151539b78d240f55cee7d9cc985bf078123ce310aa7ae04763b4",
  ],
  "https://w3id.org/security/suites/secp256k1recovery-2020/v2": [
    "ns/externos/secp256k1recovery-2020-v2.jsonld",
    "442e5eb94f2a5108373120fc01f86bdd1c6fbb71ad11ec44546d1eabe603562f",
  ],
};

let fallos = 0;
function check(ok, texto, detalle) {
  console.log(`${ok ? "  ok " : "  FALLA"}  ${texto}`);
  if (!ok) {
    fallos++;
    if (detalle) console.log(`         ${detalle}`);
  }
}

const cargados = {};
for (const [url, [archivo, hash]] of Object.entries(CONTEXTOS)) {
  const bytes = fs.readFileSync(path.join(RAIZ, archivo));
  const real = crypto.createHash("sha256").update(bytes).digest("hex");
  check(real === hash, `hash de ${archivo}`, `esperado ${hash}, obtenido ${real}`);
  cargados[url] = JSON.parse(bytes.toString("utf8"));
}

const documentLoader = async (url) => {
  if (!(url in cargados)) throw new Error(`contexto no permitido (sin red): ${url}`);
  return { contextUrl: null, documentUrl: url, document: cargados[url] };
};
const opciones = { documentLoader, safe: true };

const vector = JSON.parse(
  fs.readFileSync(path.join(RAIZ, "rfc/E24-RFC-0001-test-vector-1.json"), "utf8")
);
const omitidos = [];
const documentos = {
  ...Object.fromEntries(
    Object.entries(vector.documentosDid).map(([k, d]) => [`documento DID ${k}`, d])
  ),
  "cédula": vector.cedula.credencial,
  ...Object.fromEntries(
    Object.entries(vector.listasConfianza).map(([k, d]) => [`lista ${new URL(k).host}`, d])
  ),
  reto: vector.reto,
};

// Artefactos de la simulación (red `sim`): todo objeto con @context cuyos
// contextos estén fijados aquí. Los perfiles de instancia de ejemplo
// (comunidad-a.example) no se publican, así que esos documentos se omiten.
const DIR_SIM = path.join(RAIZ, "lab-simulacion-e24/artifacts");
for (const archivo of fs.readdirSync(DIR_SIM).sort()) {
  const datos = JSON.parse(fs.readFileSync(path.join(DIR_SIM, archivo), "utf8"));
  const buscar = (o, ruta) => {
    if (Array.isArray(o)) return o.forEach((x, i) => buscar(x, `${ruta}[${i}]`));
    if (!o || typeof o !== "object") return;
    if ("@context" in o) {
      const ctx = [].concat(o["@context"]);
      if (ctx.every((c) => typeof c === "string" && c in CONTEXTOS)) {
        documentos[`sim ${archivo}${ruta}`] = o;
      } else {
        omitidos.push(`sim ${archivo}${ruta}`);
      }
      return;
    }
    for (const [k, v] of Object.entries(o)) buscar(v, `${ruta}/${k}`);
  };
  buscar(datos, "");
}

// Lista plana de todos los IRI que aparecen en la forma expandida.
function iris(nodo, acc = new Set()) {
  if (Array.isArray(nodo)) nodo.forEach((x) => iris(x, acc));
  else if (nodo && typeof nodo === "object") {
    for (const [k, v] of Object.entries(nodo)) {
      if (!k.startsWith("@")) acc.add(k);
      if (k === "@type") [].concat(v).forEach((t) => acc.add(t));
      if (k === "@json") continue;
      iris(v, acc);
    }
  }
  return acc;
}

(async () => {
  for (const [nombre, doc] of Object.entries(documentos)) {
    console.log(`\n${nombre}`);
    let expandido;
    try {
      // safe: true hace que jsonld.js falle ante cualquier término que se
      // descartaría en silencio (términos sin definir, valores inválidos).
      expandido = await jsonld.expand(doc, opciones);
      check(true, "expande en modo seguro (ningún término descartado)");
    } catch (e) {
      check(false, "expande en modo seguro (ningún término descartado)", describir(e));
      continue;
    }

    if (doc.proof) {
      // Data Integrity §2.1: proofValue es multibase. La expansión JSON-LD no lo comprueba.
      check(/^z[1-9A-HJ-NP-Za-km-z]+$/.test(doc.proof.proofValue ?? ""), "proofValue en multibase base58btc", doc.proof.proofValue);
    }

    const usados = [...iris(expandido)].filter((i) => i.startsWith(E24NS));
    console.log(`         términos e24: ${usados.map((i) => i.slice(E24NS.length)).join(", ") || "(ninguno)"}`);

    try {
      const nquads = await jsonld.canonize(doc, {
        ...opciones,
        algorithm: "RDFC-1.0",
        format: "application/n-quads",
      });
      check(nquads.length > 0, `canoniza con RDFC-1.0 (${nquads.trim().split("\n").length} quads)`);
    } catch (e) {
      check(false, "canoniza con RDFC-1.0", describir(e));
    }

    try {
      const compactado = await jsonld.compact(expandido, doc["@context"], opciones);
      const sinCtx = (o) => {
        const { "@context": _, ...resto } = o;
        return resto;
      };
      const ida = await jsonld.expand(compactado, opciones);
      check(
        JSON.stringify(ida) === JSON.stringify(expandido),
        "ida y vuelta expandir → compactar → expandir estable"
      );
      check(
        Object.keys(sinCtx(compactado)).sort().join() === Object.keys(sinCtx(doc)).sort().join(),
        "compactar recupera las mismas claves de primer nivel"
      );
    } catch (e) {
      check(false, "ida y vuelta compactar", describir(e));
    }
  }

  if (omitidos.length) console.log(`
omitidos (contexto de perfil de ejemplo): ${omitidos.join(", ")}`);

  // Puntos de riesgo señalados en la bitácora del 22-10-2026.
  console.log("\nverificaciones dirigidas");

  // 1. `tipos` usa "@type": "@vocab": "CedulaE24" debe expandir al IRI del tipo.
  const lista = Object.values(vector.listasConfianza)[0];
  const exp = await jsonld.expand(lista, opciones).catch(() => [{}]);
  const tipos = exp[0]["https://www.w3.org/2018/credentials#credentialSubject"]
    ?.[0]?.[`${E24NS}emisores`]?.[0]?.[`${E24NS}tipos`] ?? [];
  check(
    tipos.length === 1 && tipos[0]["@id"] === `${E24NS}CedulaE24`,
    "tipos: \"CedulaE24\" expande a e24ns:CedulaE24 (@vocab)",
    JSON.stringify(tipos)
  );

  // 2. @protected: el orden normativo [VC v2, e24] y [DID v1, suite, e24] ya
  //    se probó arriba. Aquí se prueba que e24 NO puede redefinir un término
  //    protegido de VC v2 (si el contexto lo intentara, la expansión fallaría).
  try {
    await jsonld.expand(
      { "@context": ["https://www.w3.org/ns/credentials/v2", E24, { description: "https://example.org/x" }],
        description: "x" },
      opciones
    );
    check(false, "VC v2 sigue protegiendo sus términos después de e24");
  } catch (e) {
    check(e.details?.code === "protected term redefinition", "VC v2 sigue protegiendo sus términos después de e24", describir(e));
  }

  // 3. Los términos de e24 también están protegidos.
  try {
    await jsonld.expand(
      { "@context": [E24, { numero: "https://example.org/otro" }], numero: "1" },
      opciones
    );
    check(false, "e24 protege sus términos (numero no se puede redefinir)");
  } catch (e) {
    check(e.details?.code === "protected term redefinition", "e24 protege sus términos (numero no se puede redefinir)", describir(e));
  }

  // 4. El bloque e24 del documento DID es @json: se conserva literal.
  const ddoc = await jsonld.expand(vector.documentosDid.emisor, opciones).catch(() => [{}]);
  const bloque = ddoc[0][`${E24NS}metadatos`]?.[0];
  check(
    bloque?.["@type"] === "@json" &&
      JSON.stringify(bloque["@value"]) === JSON.stringify(vector.documentosDid.emisor.e24),
    "bloque e24 del documento DID se conserva como literal JSON"
  );

  console.log(fallos === 0 ? "\nTodo en orden." : `\n${fallos} verificación(es) fallaron.`);
  process.exit(fallos === 0 ? 0 : 1);
})();

function describir(e) {
  const d = e.details ? ` ${JSON.stringify(e.details.event?.details ?? e.details).slice(0, 300)}` : "";
  return `${e.name}: ${e.message}${d}`;
}
