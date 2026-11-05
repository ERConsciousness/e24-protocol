// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Demo del lanzamiento mínimo (L0): el guion del video, de punta a punta.
// Personas y comunidades FICTICIAS. Simulación educativa / testnet, sin validez jurídica.
//
//   Ensayo local:  npx hardhat node
//                  npx hardhat run scripts/desplegar.js --network localhost
//                  npx hardhat run scripts/demo-l0.js   --network localhost
//   Base Sepolia:  igual con --network baseSepolia. La recuperación social espera
//                  72 h de verdad: la primera corrida la deja iniciada, y después
//                  E24_DEMO_PASO=ejecutar-recuperacion la termina.
//
// Ninguna persona ficticia tiene ni recibe fondos: todo lo envía el relayer
// (en L0, la misma cuenta que desplegó).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const hre = require("hardhat");
const { ethers, network } = hre;
const cs = require("../sdk/cryptosuite");
const { resolver, didDeDireccion, SIG_AUTH, VERI_KEY } = require("../sdk/resolver");
const { verificarPresentacion, resumen } = require("../sdk/verificador");

const RAIZ = path.join(__dirname, "..");
const LOCALES = ["hardhat", "localhost"];
const CTX_VC = "https://www.w3.org/ns/credentials/v2";
const CTX_E24 = "https://estado24.com/ns/e24/v1";
const TIMELOCK = 72 * 3600;
const DOMINIO_VERIFICADOR = "verificador-demo.example";
const URL_LISTA = "https://instancia-ficticia.example/.well-known/e24-lista-confianza.json";
const NOMBRES = {}; // DID → nombre legible, para los mensajes

const TIPOS_RECUPERACION = {
  Setup: [
    { name: "identity", type: "address" }, { name: "activeKey", type: "address" },
    { name: "guardians", type: "address[]" }, { name: "threshold", type: "uint8" }, { name: "nonce", type: "uint256" },
  ],
  StartRecovery: [{ name: "identity", type: "address" }, { name: "newKey", type: "address" }, { name: "nonce", type: "uint256" }],
};
const TIPOS_ANCLAS = {
  Anchor: [{ name: "issuer", type: "address" }, { name: "hash", type: "bytes32" }, { name: "nonce", type: "uint256" }],
  Revoke: [{ name: "hash", type: "bytes32" }, { name: "nonce", type: "uint256" }],
};

const iso = (t) => new Date(Number(t) * 1000).toISOString().replace(".000Z", "Z");
const titulo = (n, texto) => console.log(`\n── ${n} · ${texto} ${"─".repeat(Math.max(0, 66 - texto.length))}`);
const transacciones = [];

function enlace(hash) {
  return network.name === "baseSepolia" ? `https://sepolia.basescan.org/tx/${hash}` : hash;
}

async function enviar(descripcion, promesa) {
  const tx = await promesa;
  const recibo = await tx.wait(LOCALES.includes(network.name) ? 1 : 2);
  transacciones.push({ descripcion, hash: tx.hash, gas: recibo.gasUsed, precio: recibo.gasPrice });
  console.log(`   tx ${descripcion}: ${enlace(tx.hash)}`);
  return recibo;
}

async function ahora() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

function personas() {
  const semilla = process.env.E24_SEMILLA_DEMO || (LOCALES.includes(network.name) ? "E24-DEMO-LOCAL" : null);
  if (!semilla) throw new Error("Define E24_SEMILLA_DEMO en .env para la demo en una red pública.");
  const p = (rol) => new ethers.Wallet(ethers.id(`${semilla}/${rol}`), ethers.provider);
  return {
    titular: p("titular"),
    titularNueva: p("titular-clave-nueva"),
    emisor: p("emisor-comunidad-ficticia"),
    instancia: p("instancia-ficticia"),
    guardianes: [p("guardian-1"), p("guardian-2"), p("guardian-3")],
  };
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  const local = LOCALES.includes(network.name);
  const registroDespliegue = path.join(RAIZ, "despliegues", local ? `local-${chainId}.json` : `${chainId}.json`);
  if (!fs.existsSync(registroDespliegue)) throw new Error(`Primero despliega: falta ${path.relative(RAIZ, registroDespliegue)}`);
  const despliegue = JSON.parse(fs.readFileSync(registroDespliegue, "utf8"));
  const archivoEstado = path.join(RAIZ, "demo", `estado-${chainId}.json`);

  const [relayer] = await ethers.getSigners();
  const registry = await ethers.getContractAt("EthereumDIDRegistry", despliegue.contratos.ERC1056.direccion, relayer);
  const anchors = await ethers.getContractAt("E24AnchorRegistry", despliegue.contratos.E24AnchorRegistry.direccion, relayer);
  const recovery = await ethers.getContractAt("E24Recovery", despliegue.contratos.E24Recovery.direccion, relayer);
  const dominioDe = (c, nombre) => ({ name: nombre, version: "1", chainId, verifyingContract: c.target });
  const desdeBloque = despliegue.contratos.E24AnchorRegistry.bloque;

  const P = personas();
  const did = (w) => didDeDireccion(w.address);
  NOMBRES[did(P.instancia)] = "Instancia Ficticia";
  const saldoInicialRelayer = await ethers.provider.getBalance(relayer.address);

  const verificar = async (credencial, firmante, metodo) => {
    const nonce = crypto.randomBytes(16).toString("hex");
    const t = await ahora();
    const reto = cs.agregarPrueba(
      { "@context": [CTX_VC, CTX_E24], type: "RetoE24", titular: did(P.titular), nonce, dominio: DOMINIO_VERIFICADOR, creadoEn: iso(t) },
      firmante.signingKey, metodo, "authentication", iso(t));
    const estado = JSON.parse(fs.readFileSync(archivoEstado, "utf8"));
    const r = await verificarPresentacion({ credencial, reto }, {
      registry, anchors, nonce, dominio: DOMINIO_VERIFICADOR, desdeBloque,
      listas: { [URL_LISTA]: estado.lista }, raices: [URL_LISTA],
    });
    const marca = (b) => (b ? "✔" : "✘");
    console.log(`   chequeos: 1 reto ${marca(r.validez[1])} · 2 firma emisor ${marca(r.validez[2])} · 3 ancla ${marca(r.validez[3])} · 4 sujeto ${marca(r.validez[4])}`);
    for (const m of r.motivos) console.log(`   motivo: ${m}`);
    console.log(`   → ${resumen(r, NOMBRES)}`);
    return r;
  };

  if (process.env.E24_DEMO_PASO === "ejecutar-recuperacion") {
    await pasoEjecutarRecuperacion();
  } else {
    await pasosPrincipales();
    if (local) {
      console.log("\n   (red local: se adelanta el reloj 72 h)");
      await network.provider.send("evm_increaseTime", [TIMELOCK + 1]);
      await network.provider.send("evm_mine");
      await pasoEjecutarRecuperacion();
    } else {
      const { executableAt } = await recovery.getRecovery(P.titular.address);
      console.log(`\nLa recuperación se puede ejecutar desde ${iso(executableAt)}. Entonces:`);
      console.log(`   E24_DEMO_PASO=ejecutar-recuperacion npx hardhat run scripts/demo-l0.js --network ${network.name}`);
    }
  }
  await cierre();

  async function pasosPrincipales() {
    // Las personas ficticias salen de la semilla: una segunda corrida con la misma
    // semilla fallaría a mitad de camino (la recuperación ya está configurada).
    if ((await registry.identityOwner(P.titular.address)) !== P.titular.address) {
      throw new Error("Estas personas ficticias ya se usaron en esta red. Para repetir la demo desde cero, "
        + "cambia E24_SEMILLA_DEMO en .env (y no la cambies entre el día 1 y el día 4).");
    }
    titulo(1, "Génesis: crear una identidad no cuesta nada ni pide permiso");
    for (const [nombre, w] of [["titular", P.titular], ["emisor", P.emisor], ["instancia", P.instancia]]) {
      const saldo = await ethers.provider.getBalance(w.address);
      const nonce = await ethers.provider.getTransactionCount(w.address);
      console.log(`   ${nombre.padEnd(10)} ${did(w)}  saldo ${ethers.formatEther(saldo)} ETH · transacciones ${nonce}`);
    }

    titulo(2, "Recuperación social: tres guardianes, mayoría de 2, espera de 72 h");
    const id = P.titular.address;
    const guardianes = P.guardianes.map((g) => g.address);
    const firmaSetup = await P.titular.signTypedData(dominioDe(recovery, "E24Recovery"), { Setup: TIPOS_RECUPERACION.Setup },
      { identity: id, activeKey: id, guardians: guardianes, threshold: 2, nonce: await recovery.opNonces(id) });
    await enviar("setup", recovery.setup(id, id, guardianes, 2, firmaSetup));
    const nonce1056 = await registry.nonce(await registry.identityOwner(id));
    const h = ethers.solidityPackedKeccak256(["bytes1", "bytes1", "address", "uint256", "address", "string", "address"],
      ["0x19", "0x00", registry.target, nonce1056, id, "changeOwner", recovery.target]);
    const s = P.titular.signingKey.sign(h);
    await enviar("changeOwnerSigned", registry.changeOwnerSigned(id, s.v, s.r, s.s, recovery.target));
    await enviar("activate", recovery.activate(id));
    const { documento } = await resolver(did(P.titular), { registry });
    console.log(`   dueño en ERC-1056 (#raiz): E24Recovery ${recovery.target}`);
    console.log(`   métodos del documento DID: ${documento.verificationMethod.map((m) => "#" + m.id.split("#")[1]).join(", ")} (la clave activa firma como delegado)`);

    titulo(3, "Emisión: la Comunidad Ficticia emite dos cédulas y las ancla");
    const t = await ahora();
    const cedula = (numero) => cs.agregarPrueba({
      "@context": [CTX_VC, CTX_E24], type: ["VerifiableCredential", "CedulaE24"],
      issuer: did(P.emisor), validFrom: iso(t), perfilEmisor: "https://comunidad-ficticia.example/e24/perfil.json",
      credentialSubject: { id: did(P.titular), numero, categoria: "Diaspora" },
    }, P.emisor.signingKey, `${did(P.emisor)}#raiz`, "assertionMethod", iso(t));
    const cedulaA = cedula("FICTICIA-0001");
    const cedulaB = cedula("FICTICIA-0002");
    for (const [nombre, vc] of [["A", cedulaA], ["B", cedulaB]]) {
      const hash = cs.hashDeAncla(vc);
      const firma = await P.emisor.signTypedData(dominioDe(anchors, "E24AnchorRegistry"), { Anchor: TIPOS_ANCLAS.Anchor },
        { issuer: P.emisor.address, hash, nonce: await anchors.nonces(P.emisor.address) });
      const recibo = await enviar(`ancla cédula ${nombre}`, anchors.anchorCredentialSigned(P.emisor.address, hash, P.emisor.address, firma));
      const ev = recibo.logs.map((l) => { try { return anchors.interface.parseLog(l); } catch { return null; } }).find(Boolean);
      console.log(`   lo que queda en cadena: hash ${ev.args.hash} · emisor ${ev.args.issuer} · firmante ${ev.args.sender} (ni rastro del titular)`);
    }

    titulo(4, "Lista de confianza: la Instancia Ficticia reconoce a la Comunidad Ficticia");
    const lista = cs.agregarPrueba({
      "@context": [CTX_VC, CTX_E24], type: ["VerifiableCredential", "ListaConfianzaE24"],
      issuer: did(P.instancia), validFrom: iso(t), validUntil: iso(t + 180 * 86400),
      credentialSubject: {
        version: 1,
        emisores: [{ id: did(P.emisor), tipos: ["CedulaE24"], prefijoAlias: "FICTICIA", perfil: "https://comunidad-ficticia.example/e24/perfil.json", desde: iso(t) }],
        reconoceListas: [],
      },
    }, P.instancia.signingKey, `${did(P.instancia)}#raiz`, "assertionMethod", iso(t));
    console.log(`   firmada fuera de cadena; se publicaría en ${URL_LISTA}`);
    fs.mkdirSync(path.dirname(archivoEstado), { recursive: true });
    fs.writeFileSync(archivoEstado, JSON.stringify({ titular: did(P.titular), cedulaA, cedulaB, lista }, null, 2) + "\n");

    const metodoActivo = `${did(P.titular)}#delegado-${P.titular.address.toLowerCase()}`;
    titulo(5, "Verificación: el titular presenta la cédula A ante un verificador");
    await verificar(cedulaA, P.titular, metodoActivo);

    titulo(6, "Un solo carácter alterado");
    const alterada = structuredClone(cedulaA);
    alterada.credentialSubject.numero = "FICTICIA-0009";
    await verificar(alterada, P.titular, metodoActivo);

    titulo(7, "Revocación: el emisor revoca la cédula B");
    const hashB = cs.hashDeAncla(cedulaB);
    const firmaRev = await P.emisor.signTypedData(dominioDe(anchors, "E24AnchorRegistry"), { Revoke: TIPOS_ANCLAS.Revoke },
      { hash: hashB, nonce: await anchors.nonces(P.emisor.address) });
    await enviar("revocar cédula B", anchors.revokeCredentialSigned(hashB, P.emisor.address, firmaRev));
    await verificar(cedulaB, P.titular, metodoActivo);

    titulo("7b", "El titular pierde su clave: dos guardianes inician la recuperación");
    const valor = { identity: id, newKey: P.titularNueva.address, nonce: await recovery.guardianNonces(id) };
    const quienes = P.guardianes.slice(0, 2);
    const firmas = [];
    for (const g of quienes) firmas.push(await g.signTypedData(dominioDe(recovery, "E24Recovery"), { StartRecovery: TIPOS_RECUPERACION.StartRecovery }, valor));
    await enviar("startRecovery", recovery.startRecovery(id, P.titularNueva.address, quienes.map((g) => g.address), firmas));
    const { executableAt } = await recovery.getRecovery(id);
    console.log(`   ejecutable desde ${iso(executableAt)} · durante la espera, la clave activa con un guardián que no aprobó puede vetarla`);
  }

  async function pasoEjecutarRecuperacion() {
    if (!fs.existsSync(archivoEstado)) throw new Error(`Falta ${path.relative(RAIZ, archivoEstado)}: primero corre la demo sin E24_DEMO_PASO.`);
    const { titular, cedulaA } = JSON.parse(fs.readFileSync(archivoEstado, "utf8"));
    if (titular !== did(P.titular)) throw new Error("E24_SEMILLA_DEMO no es la del día 1: restáurala para terminar la recuperación.");
    const { executableAt } = await recovery.getRecovery(P.titular.address);
    if (BigInt(await ahora()) < executableAt) throw new Error(`Todavía no: la recuperación se puede ejecutar desde ${iso(executableAt)}.`);
    titulo(8, "Han pasado las 72 h: cualquiera puede ejecutar la recuperación");
    await enviar("executeRecovery", recovery.executeRecovery(P.titular.address));
    const id = P.titular.address;
    console.log(`   clave vieja vigente: ${await registry.validDelegate(id, SIG_AUTH, id)} · clave nueva vigente: ${await registry.validDelegate(id, SIG_AUTH, P.titularNueva.address)} / ${await registry.validDelegate(id, VERI_KEY, P.titularNueva.address)}`);

    titulo(9, "La clave vieja ya no sirve; la nueva presenta la MISMA cédula A");
    await verificar(cedulaA, P.titular, `${did(P.titular)}#delegado-${id.toLowerCase()}`);
    await verificar(cedulaA, P.titularNueva, `${did(P.titular)}#delegado-${P.titularNueva.address.toLowerCase()}`);
  }

  async function cierre() {
    titulo("✓", "Nadie más que el relayer pagó gas");
    for (const [nombre, w] of [["titular", P.titular], ["titular (clave nueva)", P.titularNueva], ["emisor", P.emisor], ["instancia", P.instancia],
      ...P.guardianes.map((g, i) => [`guardián ${i + 1}`, g])]) {
      console.log(`   ${nombre.padEnd(22)} saldo ${ethers.formatEther(await ethers.provider.getBalance(w.address))} ETH · transacciones enviadas ${await ethers.provider.getTransactionCount(w.address)}`);
    }
    const gastado = saldoInicialRelayer - (await ethers.provider.getBalance(relayer.address));
    console.log(`   relayer ${relayer.address}: ${transacciones.length} transacciones, ${ethers.formatEther(gastado)} ETH en esta corrida`);
    console.log("\nSimulación educativa / testnet · personas ficticias · sin validez jurídica.");
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
