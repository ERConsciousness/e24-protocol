// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  VERI_KEY, SIG_AUTH, UN_ANIO, VECTOR,
  cuenta, cuentaDesdeHex, desplegar, dominio, hashDe,
  cambiarDuenoFirmado, agregarDelegadoFirmado, revocarDelegadoFirmado,
} = require("./helpers");

const TIPOS_ANCHOR = {
  Anchor: [
    { name: "issuer", type: "address" },
    { name: "hash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
};
const TIPOS_REVOKE = {
  Revoke: [
    { name: "hash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
};

describe("E24AnchorRegistry (E24-RFC-0001 §7.5)", function () {
  async function base() {
    const ctx = await desplegar();
    const emisor = cuentaDesdeHex(VECTOR.claves.emisor.privateKeyHex);
    const d1 = cuenta("delegado-1");
    const d2 = cuenta("delegado-2");
    const extrano = cuenta("extrano");
    return { ...ctx, emisor, d1, d2, extrano };
  }

  async function firmarAncla(ctx, firmante, issuer, hash) {
    const nonce = await ctx.anchors.nonces(firmante.address);
    return firmante.signTypedData(await dominio(ctx.anchors, "E24AnchorRegistry"), TIPOS_ANCHOR, { issuer, hash, nonce });
  }

  async function anclarFirmado(ctx, firmante, issuer, hash) {
    const firma = await firmarAncla(ctx, firmante, issuer, hash);
    return ctx.anchors.connect(ctx.relayer).anchorCredentialSigned(issuer, hash, firmante.address, firma);
  }

  async function revocarFirmado(ctx, firmante, hash) {
    const nonce = await ctx.anchors.nonces(firmante.address);
    const firma = await firmante.signTypedData(await dominio(ctx.anchors, "E24AnchorRegistry"), TIPOS_REVOKE, { hash, nonce });
    return ctx.anchors.connect(ctx.relayer).revokeCredentialSigned(hash, firmante.address, firma);
  }

  it("no tiene administrador y declara RESOLVER_VERSION = 1", async function () {
    const { anchors, registry } = await loadFixture(base);
    const funciones = anchors.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const admin of ["owner", "transferOwnership", "renounceOwnership", "pause", "upgradeTo", "setRegistry"]) {
      expect(funciones).to.not.include(admin);
    }
    expect(await anchors.RESOLVER_VERSION()).to.equal(1n);
    expect(await anchors.registry()).to.equal(registry.target);
  });

  it("ancla la cédula del test vector #1 tal como la espera el RFC", async function () {
    const ctx = await loadFixture(base);
    const esperada = VECTOR.anclaEsperada;
    expect(ctx.emisor.address.toLowerCase()).to.equal(esperada.issuer);
    await expect(anclarFirmado(ctx, ctx.emisor, ctx.emisor.address, esperada.hash))
      .to.emit(ctx.anchors, "CredentialAnchored")
      .withArgs(esperada.hash, ctx.emisor.address, ctx.emisor.address);
    const ancla = await ctx.anchors.anchors(esperada.hash);
    expect(ancla.issuer).to.equal(ctx.emisor.address);
    expect(ancla.anchoredAt).to.equal(BigInt(await time.latest()));
    expect(ancla.revoked).to.equal(false);
  });

  it("el ancla no guarda al titular: solo emisor, momento y estado", async function () {
    const { anchors } = await loadFixture(base);
    const campos = anchors.interface.getFunction("anchors").outputs.map((o) => o.name);
    expect(campos).to.deep.equal(["issuer", "anchoredAt", "revoked"]);
    const evento = anchors.interface.getEvent("CredentialAnchored").inputs.map((i) => i.name);
    expect(evento).to.deep.equal(["hash", "issuer", "sender"]);
  });

  it("el relayer no puede alterar ni repetir una operación firmada", async function () {
    const ctx = await loadFixture(base);
    const firma = await firmarAncla(ctx, ctx.emisor, ctx.emisor.address, hashDe("cedula-1"));
    await expect(ctx.anchors.connect(ctx.relayer).anchorCredentialSigned(ctx.emisor.address, hashDe("otra"), ctx.emisor.address, firma))
      .to.be.revertedWithCustomError(ctx.anchors, "BadSignature");
    await ctx.anchors.connect(ctx.relayer).anchorCredentialSigned(ctx.emisor.address, hashDe("cedula-1"), ctx.emisor.address, firma);
    await expect(ctx.anchors.connect(ctx.relayer).anchorCredentialSigned(ctx.emisor.address, hashDe("cedula-1"), ctx.emisor.address, firma))
      .to.be.revertedWithCustomError(ctx.anchors, "BadSignature");
  });

  it("nadie ancla en nombre de otro emisor (emisión abierta, pero cada uno en su nombre)", async function () {
    const ctx = await loadFixture(base);
    await expect(anclarFirmado(ctx, ctx.extrano, ctx.emisor.address, hashDe("x")))
      .to.be.revertedWithCustomError(ctx.anchors, "NotAuthorized")
      .withArgs(ctx.extrano.address, ctx.emisor.address);
    await expect(anclarFirmado(ctx, ctx.extrano, ctx.extrano.address, hashDe("x")))
      .to.emit(ctx.anchors, "CredentialAnchored");
  });

  it("un mismo hash no se ancla dos veces", async function () {
    const ctx = await loadFixture(base);
    await anclarFirmado(ctx, ctx.emisor, ctx.emisor.address, hashDe("dup"));
    await expect(anclarFirmado(ctx, ctx.extrano, ctx.extrano.address, hashDe("dup")))
      .to.be.revertedWithCustomError(ctx.anchors, "AlreadyAnchored");
  });

  it("ancla un delegado veriKey vigente; uno sigAuth no", async function () {
    const ctx = await loadFixture(base);
    const { registry, relayer, emisor, d1, d2 } = ctx;
    await agregarDelegadoFirmado(registry, relayer, emisor, emisor.address, VERI_KEY, d1.address, UN_ANIO);
    await agregarDelegadoFirmado(registry, relayer, emisor, emisor.address, SIG_AUTH, d2.address, UN_ANIO);
    await expect(anclarFirmado(ctx, d1, emisor.address, hashDe("por-d1")))
      .to.emit(ctx.anchors, "CredentialAnchored")
      .withArgs(hashDe("por-d1"), emisor.address, d1.address);
    expect((await ctx.anchors.anchors(hashDe("por-d1"))).issuer).to.equal(emisor.address);
    await expect(anclarFirmado(ctx, d2, emisor.address, hashDe("por-d2")))
      .to.be.revertedWithCustomError(ctx.anchors, "NotAuthorized");
  });

  it("un delegado vencido ya no ancla", async function () {
    const ctx = await loadFixture(base);
    await agregarDelegadoFirmado(ctx.registry, ctx.relayer, ctx.emisor, ctx.emisor.address, VERI_KEY, ctx.d1.address, 3600);
    await time.increase(3601);
    await expect(anclarFirmado(ctx, ctx.d1, ctx.emisor.address, hashDe("tarde")))
      .to.be.revertedWithCustomError(ctx.anchors, "NotAuthorized");
  });

  it("revocar un delegado no anula sus anclas; el emisor las encuentra por sender y las revoca", async function () {
    const ctx = await loadFixture(base);
    const { registry, relayer, emisor, d1, anchors } = ctx;
    await agregarDelegadoFirmado(registry, relayer, emisor, emisor.address, VERI_KEY, d1.address, UN_ANIO);
    await anclarFirmado(ctx, d1, emisor.address, hashDe("a"));
    await anclarFirmado(ctx, d1, emisor.address, hashDe("b"));
    await revocarDelegadoFirmado(registry, relayer, emisor, emisor.address, VERI_KEY, d1.address);
    await expect(anclarFirmado(ctx, d1, emisor.address, hashDe("c"))).to.be.revertedWithCustomError(anchors, "NotAuthorized");
    expect((await anchors.anchors(hashDe("a"))).revoked).to.equal(false);

    const porD1 = await anchors.queryFilter(anchors.filters.CredentialAnchored(null, null, d1.address));
    expect(porD1.map((e) => e.args.hash)).to.deep.equal([hashDe("a"), hashDe("b")]);
    for (const e of porD1) {
      await expect(revocarFirmado(ctx, emisor, e.args.hash))
        .to.emit(anchors, "CredentialRevoked")
        .withArgs(e.args.hash, emisor.address, emisor.address);
    }
    expect((await anchors.anchors(hashDe("b"))).revoked).to.equal(true);
  });

  it("rotar el dueño en ERC-1056 cambia quién ancla, sin cambiar el emisor", async function () {
    const ctx = await loadFixture(base);
    const nueva = cuenta("emisor-nueva-clave");
    await cambiarDuenoFirmado(ctx.registry, ctx.relayer, ctx.emisor, ctx.emisor.address, nueva.address);
    await expect(anclarFirmado(ctx, ctx.emisor, ctx.emisor.address, hashDe("vieja")))
      .to.be.revertedWithCustomError(ctx.anchors, "NotAuthorized");
    await expect(anclarFirmado(ctx, nueva, ctx.emisor.address, hashDe("nueva")))
      .to.emit(ctx.anchors, "CredentialAnchored")
      .withArgs(hashDe("nueva"), ctx.emisor.address, nueva.address);
  });

  it("revocar: solo el emisor, una sola vez y solo lo anclado", async function () {
    const ctx = await loadFixture(base);
    await anclarFirmado(ctx, ctx.emisor, ctx.emisor.address, hashDe("r"));
    await expect(revocarFirmado(ctx, ctx.extrano, hashDe("r"))).to.be.revertedWithCustomError(ctx.anchors, "NotAuthorized");
    await expect(revocarFirmado(ctx, ctx.emisor, hashDe("nunca"))).to.be.revertedWithCustomError(ctx.anchors, "NotAnchored");
    await revocarFirmado(ctx, ctx.emisor, hashDe("r"));
    await expect(revocarFirmado(ctx, ctx.emisor, hashDe("r"))).to.be.revertedWithCustomError(ctx.anchors, "AlreadyRevoked");
  });

  it("una organización con cuenta de contrato emite por delegado y firma con ERC-1271", async function () {
    const ctx = await loadFixture(base);
    const { registry, anchors, otro, d1 } = ctx;
    const wallet = await (await ethers.getContractFactory("MockERC1271Wallet")).deploy(otro.address);
    const org = wallet.target;
    const datos = registry.interface.encodeFunctionData("addDelegate(address,bytes32,address,uint256)", [org, VERI_KEY, d1.address, UN_ANIO]);
    await wallet.connect(otro).exec(registry.target, datos);
    await expect(anclarFirmado(ctx, d1, org, hashDe("org-1")))
      .to.emit(anchors, "CredentialAnchored").withArgs(hashDe("org-1"), org, d1.address);

    const nonce = await anchors.nonces(org);
    const firma = await otro.signTypedData(await dominio(anchors, "E24AnchorRegistry"), TIPOS_ANCHOR, { issuer: org, hash: hashDe("org-2"), nonce });
    await expect(anchors.connect(ctx.relayer).anchorCredentialSigned(org, hashDe("org-2"), org, firma))
      .to.emit(anchors, "CredentialAnchored").withArgs(hashDe("org-2"), org, org);
  });

  it("el emisor y sus delegados no gastaron gas: todo lo pagó el relayer", async function () {
    const ctx = await loadFixture(base);
    await agregarDelegadoFirmado(ctx.registry, ctx.relayer, ctx.emisor, ctx.emisor.address, VERI_KEY, ctx.d1.address, UN_ANIO);
    await anclarFirmado(ctx, ctx.d1, ctx.emisor.address, hashDe("gratis"));
    expect(await ethers.provider.getBalance(ctx.emisor.address)).to.equal(0n);
    expect(await ethers.provider.getBalance(ctx.d1.address)).to.equal(0n);
  });
});
