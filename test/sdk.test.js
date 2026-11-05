// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { SIG_AUTH, UN_ANIO, VECTOR, cuentaDesdeHex, desplegar, dominio, agregarDelegadoFirmado } = require("./helpers");
const cs = require("../sdk/cryptosuite");
const { resolver, didDeDireccion, ESTADO } = require("../sdk/resolver");
const { verificarPresentacion, resumen, unix } = require("../sdk/verificador");

const URL_A = "https://instancia-a.example/.well-known/e24-lista-confianza.json";
const URL_B = "https://instancia-b.example/.well-known/e24-lista-confianza.json";
const CEDULA = VECTOR.cedula.credencial;
const AHORA = unix(VECTOR.verificacion.momento);
const clave = (rol) => new ethers.SigningKey("0x" + VECTOR.claves[rol].privateKeyHex);

describe("SDK JS (tercera implementación de la cryptosuite)", function () {
  describe("test vector #1", function () {
    it("reproduce byte a byte las pruebas de la cédula, el reto y las listas", function () {
      const casos = [
        [CEDULA, "emisor", "assertionMethod"],
        [VECTOR.reto, "titular", "authentication"],
        [VECTOR.listasConfianza[URL_A], "instanciaA", "assertionMethod"],
        [VECTOR.listasConfianza[URL_B], "instanciaB", "assertionMethod"],
      ];
      for (const [doc, rol, proposito] of casos) {
        const firmado = cs.agregarPrueba(cs.sinPrueba(doc), clave(rol), doc.proof.verificationMethod, proposito, doc.proof.created);
        expect(firmado.proof.proofValue).to.equal(doc.proof.proofValue);
        expect(cs.pruebaValida(doc, VECTOR.documentosDid[rol], proposito)).to.equal(true);
      }
      expect(cs.hashDeAncla(CEDULA)).to.equal(VECTOR.anclaEsperada.hash);
    });

    it("rechaza los cinco tests negativos", function () {
      const doc = VECTOR.documentosDid.emisor;
      const [alterado, highS, sinMultibase, otroMetodo, otraFecha] = VECTOR.testsNegativos;
      const c1 = structuredClone(CEDULA);
      c1.credentialSubject.numero = alterado.alteracion.a;
      expect(cs.pruebaValida(c1, doc, "assertionMethod")).to.equal(false);
      expect(cs.hashDeAncla(c1)).to.equal("0x" + alterado.hashAlterado);
      expect(cs.pruebaValida({ ...CEDULA, proof: { ...CEDULA.proof, proofValue: highS.proofValueAlterado } }, doc, "assertionMethod")).to.equal(false);
      expect(cs.pruebaValida({ ...CEDULA, proof: { ...CEDULA.proof, proofValue: sinMultibase.proofValueAlterado } }, doc, "assertionMethod")).to.equal(false);
      expect(cs.pruebaValida({ ...CEDULA, proof: { ...CEDULA.proof, verificationMethod: otroMetodo.verificationMethodAlterado } }, doc, "assertionMethod")).to.equal(false);
      expect(cs.pruebaValida({ ...CEDULA, proof: { ...CEDULA.proof, created: otraFecha.alteracion.a } }, doc, "assertionMethod")).to.equal(false);
    });
  });

  describe("conformidad con Data Integrity", function () {
    it("proofValue es multibase base58btc canónico, también con ceros a la izquierda", function () {
      expect(CEDULA.proof.proofValue).to.match(/^z[1-9A-HJ-NP-Za-km-z]+$/);
      const cero = ethers.ZeroHash;
      const uno = ethers.toBeHex(1n, 32);
      const valor = cs.codificarPrueba(cero, uno);
      expect(cs.decodificarPrueba(valor)).to.deep.equal({ r: cero, s: uno });
      expect(cs.decodificarPrueba(valor.replace("z", "z1"))).to.equal(null);
      expect(cs.decodificarPrueba("f" + valor.slice(1))).to.equal(null);
    });

    it("la instancia de la suite expone createProof y verifyProof", function () {
      expect(cs.instanciar({ cryptosuite: "otra" })).to.equal(null);
      const suite = cs.instanciar({ cryptosuite: cs.CRYPTOSUITE, clave: clave("emisor") });
      const { proof: original } = CEDULA;
      const proof = suite.createProof(cs.sinPrueba(CEDULA), original);
      expect(proof).to.deep.equal(original);
      const ok = suite.verifyProof(CEDULA, { docDid: VECTOR.documentosDid.emisor, expectedProofPurpose: "assertionMethod" });
      expect(ok).to.deep.equal({ verified: true, verifiedDocument: cs.sinPrueba(CEDULA) });
      const mal = suite.verifyProof({ ...CEDULA, validFrom: "2030-01-01T00:00:00Z" }, { docDid: VECTOR.documentosDid.emisor, expectedProofPurpose: "assertionMethod" });
      expect(mal).to.deep.equal({ verified: false, verifiedDocument: null });
    });

    it("rechaza documentos fuera de los límites de tamaño y anidamiento", function () {
      expect(cs.dentroDeLimites({ a: "x".repeat(cs.MAX_BYTES_DOCUMENTO) })).to.equal(false);
      let hondo = {};
      for (let i = 0; i <= cs.MAX_PROFUNDIDAD; i++) hondo = { a: hondo };
      expect(cs.dentroDeLimites(hondo)).to.equal(false);
      expect(cs.pruebaValida({ ...CEDULA, relleno: "x".repeat(cs.MAX_BYTES_DOCUMENTO) }, VECTOR.documentosDid.emisor, "assertionMethod")).to.equal(false);
    });
  });

  describe("resolver y verificador contra la cadena", function () {
    async function base() {
      const ctx = await desplegar();
      const emisor = cuentaDesdeHex(VECTOR.claves.emisor.privateKeyHex);
      const titular = cuentaDesdeHex(VECTOR.claves.titular.privateKeyHex);
      const valor = { issuer: emisor.address, hash: VECTOR.anclaEsperada.hash, nonce: 0n };
      const firma = await emisor.signTypedData(await dominio(ctx.anchors, "E24AnchorRegistry"),
        { Anchor: [{ name: "issuer", type: "address" }, { name: "hash", type: "bytes32" }, { name: "nonce", type: "uint256" }] }, valor);
      await ctx.anchors.connect(ctx.relayer).anchorCredentialSigned(emisor.address, valor.hash, emisor.address, firma);
      const opciones = {
        registry: ctx.registry, anchors: ctx.anchors, ahora: AHORA,
        nonce: VECTOR.reto.nonce, dominio: VECTOR.reto.dominio,
        listas: VECTOR.listasConfianza, raices: [URL_A],
      };
      return { ...ctx, emisor, titular, opciones };
    }

    it("resuelve un DID sin historial como documento con solo #raiz", async function () {
      const { registry, titular } = await loadFixture(base);
      const { documento, metadatos } = await resolver(didDeDireccion(titular.address), { registry });
      expect(documento.verificationMethod).to.have.length(1);
      expect(documento.verificationMethod[0].blockchainAccountId).to.equal(`eip155:31337:${titular.address.toLowerCase()}`);
      expect(documento.e24).to.deep.equal({ protocol: "E24-V1", network: "eth", resolverVersion: 1, estado: "activo" });
      expect(metadatos.desactivado).to.equal(false);
    });

    it("el resolver corta un historial que supera el límite", async function () {
      const { registry, relayer, titular } = await loadFixture(base);
      const nueva = new ethers.Wallet(ethers.id("E24-TEST-sdk-limite"));
      await agregarDelegadoFirmado(registry, relayer, titular, titular.address, SIG_AUTH, nueva.address, UN_ANIO);
      await agregarDelegadoFirmado(registry, relayer, titular, titular.address, SIG_AUTH, relayer.address, UN_ANIO);
      const did = didDeDireccion(titular.address);
      await resolver(did, { registry, maxEventos: 2 });
      let error = null;
      await resolver(did, { registry, maxEventos: 1 }).catch((e) => { error = e; });
      expect(error?.message).to.match(/demasiado largo/);
    });

    it("rechaza una presentación fuera de los límites sin consultar la cadena", async function () {
      const { opciones } = await loadFixture(base);
      const r = await verificarPresentacion({ credencial: { ...CEDULA, relleno: "x".repeat(cs.MAX_BYTES_DOCUMENTO) }, reto: VECTOR.reto }, opciones);
      expect(r.valida).to.equal(false);
      expect(r.motivos[0]).to.match(/límites/);
    });

    it("verifica la presentación del test vector: válida y reconocida por la instancia A", async function () {
      const { opciones } = await loadFixture(base);
      const r = await verificarPresentacion({ credencial: CEDULA, reto: VECTOR.reto }, opciones);
      expect(r.motivos).to.deep.equal([]);
      expect(r.validez).to.deep.equal({ 1: true, 2: true, 3: true, 4: true });
      expect(r.reconocimiento.instancia).to.equal(VECTOR.documentosDid.instanciaA.id);
      expect(resumen(r, { [VECTOR.documentosDid.instanciaA.id]: "Instancia A" }))
        .to.equal("Credencial válida · emisor reconocido por Instancia A");
    });

    it("con la lista B como raíz a profundidad 1, válida pero no reconocida", async function () {
      const { opciones } = await loadFixture(base);
      const r = await verificarPresentacion({ credencial: CEDULA, reto: VECTOR.reto }, { ...opciones, raices: [URL_B] });
      expect(r.valida).to.equal(true);
      expect(r.reconocimiento.reconocido).to.equal(false);
    });

    it("un carácter alterado rompe los chequeos 2 y 3", async function () {
      const { opciones } = await loadFixture(base);
      const vc = structuredClone(CEDULA);
      vc.credentialSubject.numero = "PRUEBA-0002";
      const r = await verificarPresentacion({ credencial: vc, reto: VECTOR.reto }, opciones);
      expect(r.validez).to.deep.equal({ 1: true, 2: false, 3: false, 4: true });
    });

    it("rechaza otro nonce, un reto vencido y una credencial revocada", async function () {
      const { opciones, anchors, relayer, emisor } = await loadFixture(base);
      const p = { credencial: CEDULA, reto: VECTOR.reto };
      expect((await verificarPresentacion(p, { ...opciones, nonce: "otro" })).validez[1]).to.equal(false);
      expect((await verificarPresentacion(p, { ...opciones, ahora: AHORA + 301 })).validez[1]).to.equal(false);
      const valor = { hash: VECTOR.anclaEsperada.hash, nonce: 1n };
      const firma = await emisor.signTypedData(await dominio(anchors, "E24AnchorRegistry"),
        { Revoke: [{ name: "hash", type: "bytes32" }, { name: "nonce", type: "uint256" }] }, valor);
      await anchors.connect(relayer).revokeCredentialSigned(valor.hash, emisor.address, firma);
      const r = await verificarPresentacion(p, opciones);
      expect(r.validez[3]).to.equal(false);
      expect(r.motivos).to.include("3: credencial revocada por el emisor");
    });

    it("un titular suspendido no pasa el chequeo 1; un delegado sigAuth sí firma el reto", async function () {
      const { opciones, registry, relayer, titular } = await loadFixture(base);
      const id = titular.address;
      const nueva = new ethers.Wallet(ethers.id("E24-TEST-sdk-delegado"));
      await agregarDelegadoFirmado(registry, relayer, titular, id, SIG_AUTH, nueva.address, UN_ANIO);
      const did = didDeDireccion(id);
      const { documento } = await resolver(did, { registry });
      expect(documento.authentication).to.include(`${did}#delegado-${nueva.address.toLowerCase()}`);

      const reto = cs.agregarPrueba(cs.sinPrueba(VECTOR.reto), nueva.signingKey,
        `${did}#delegado-${nueva.address.toLowerCase()}`, "authentication", VECTOR.reto.proof.created);
      expect((await verificarPresentacion({ credencial: CEDULA, reto }, opciones)).valida).to.equal(true);

      const nonce = await registry.nonce(id);
      const valor = ethers.toUtf8Bytes("suspendido");
      const h = ethers.solidityPackedKeccak256(
        ["bytes1", "bytes1", "address", "uint256", "address", "string", "bytes32", "bytes", "uint256"],
        ["0x19", "0x00", registry.target, nonce, id, "setAttribute", ESTADO, valor, UN_ANIO]);
      const s = titular.signingKey.sign(h);
      await registry.connect(relayer).setAttributeSigned(id, s.v, s.r, s.s, ESTADO, valor, UN_ANIO);
      const r = await verificarPresentacion({ credencial: CEDULA, reto }, opciones);
      expect(r.motivos.some((m) => m.startsWith("1: DID del titular suspendido"))).to.equal(true);
    });
  });
});
