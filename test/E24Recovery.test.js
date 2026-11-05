// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const {
  VERI_KEY, SIG_AUTH, TIMELOCK, UN_ANIO, VECTOR,
  cuenta, cuentaDesdeHex, desplegar, dominio, cambiarDuenoFirmado,
} = require("./helpers");

const TIPOS = {
  Setup: [
    { name: "identity", type: "address" },
    { name: "activeKey", type: "address" },
    { name: "guardians", type: "address[]" },
    { name: "threshold", type: "uint8" },
    { name: "nonce", type: "uint256" },
  ],
  Operate: [
    { name: "identity", type: "address" },
    { name: "data", type: "bytes" },
    { name: "nonce", type: "uint256" },
  ],
  RequestChange: [
    { name: "identity", type: "address" },
    { name: "newOwner", type: "address" },
    { name: "guardians", type: "address[]" },
    { name: "threshold", type: "uint8" },
    { name: "nonce", type: "uint256" },
  ],
  CancelChange: [
    { name: "identity", type: "address" },
    { name: "changeId", type: "uint256" },
  ],
  StartRecovery: [
    { name: "identity", type: "address" },
    { name: "newKey", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
  Veto: [
    { name: "identity", type: "address" },
    { name: "recoveryId", type: "uint256" },
  ],
};

const ESTADO = ethers.encodeBytes32String("e24/estado");
const SUSPENDIDO = ethers.toUtf8Bytes("suspendido");
const PUB_KEY_ATTR = ethers.encodeBytes32String("did/pub/Secp256k1/sigAuth/hex");

describe("E24Recovery (E24-RFC-0001 §6.7)", function () {
  async function base() {
    const ctx = await desplegar();
    const titular = cuentaDesdeHex(VECTOR.claves.titular.privateKeyHex);
    const g = [1, 2, 3, 4, 5].map((i) => cuenta(`guardian-${i}`));
    const nueva = cuenta("titular-nueva-clave");
    const ladron2 = cuenta("ladron-segunda-clave");
    return { ...ctx, titular, g, nueva, ladron2, id: titular.address };
  }

  async function firmar(ctx, firmante, tipo, valor) {
    return firmante.signTypedData(await dominio(ctx.recovery, "E24Recovery"), { [tipo]: TIPOS[tipo] }, valor);
  }

  async function configurar(ctx, guardianes = ctx.g, k = 3) {
    const { recovery, registry, relayer, titular, id } = ctx;
    const direcciones = guardianes.map((x) => x.address ?? x);
    const firma = await firmar(ctx, titular, "Setup", {
      identity: id, activeKey: id, guardians: direcciones, threshold: k, nonce: await recovery.opNonces(id),
    });
    await recovery.connect(relayer).setup(id, id, direcciones, k, firma);
    await cambiarDuenoFirmado(registry, relayer, titular, id, recovery.target);
    await recovery.connect(relayer).activate(id);
  }

  async function activa() {
    const ctx = await base();
    await configurar(ctx);
    return ctx;
  }

  async function operar(ctx, firmante, fn, args) {
    const data = ctx.registry.interface.encodeFunctionData(fn, args);
    const firma = await firmar(ctx, firmante, "Operate", { identity: ctx.id, data, nonce: await ctx.recovery.opNonces(ctx.id) });
    return ctx.recovery.connect(ctx.relayer).operate(ctx.id, data, firma);
  }

  async function pedirCambio(ctx, firmante, newOwner, guardians = [], threshold = 0) {
    const firma = await firmar(ctx, firmante, "RequestChange", {
      identity: ctx.id, newOwner, guardians, threshold, nonce: await ctx.recovery.opNonces(ctx.id),
    });
    return ctx.recovery.connect(ctx.relayer).requestChange(ctx.id, newOwner, guardians, threshold, firma);
  }

  async function firmasGuardianes(ctx, guardianes, tipo, valor) {
    const firmas = [];
    for (const x of guardianes) firmas.push(await firmar(ctx, x, tipo, valor));
    return [guardianes.map((x) => x.address), firmas];
  }

  async function iniciarRecuperacion(ctx, guardianes, newKey) {
    const valor = { identity: ctx.id, newKey, nonce: await ctx.recovery.guardianNonces(ctx.id) };
    const [quienes, firmas] = await firmasGuardianes(ctx, guardianes, "StartRecovery", valor);
    return ctx.recovery.connect(ctx.relayer).startRecovery(ctx.id, newKey, quienes, firmas);
  }

  async function cancelarCambio(ctx, guardianes) {
    const { id: changeId } = await ctx.recovery.getChange(ctx.id);
    const [quienes, firmas] = await firmasGuardianes(ctx, guardianes, "CancelChange", { identity: ctx.id, changeId });
    return ctx.recovery.connect(ctx.relayer).cancelChange(ctx.id, quienes, firmas);
  }

  async function vetar(ctx, clave, guardian) {
    const { id: recoveryId } = await ctx.recovery.getRecovery(ctx.id);
    const valor = { identity: ctx.id, recoveryId };
    return ctx.recovery.connect(ctx.relayer).veto(
      ctx.id, await firmar(ctx, clave, "Veto", valor), guardian.address, await firmar(ctx, guardian, "Veto", valor));
  }

  describe("configuración", function () {
    it("exige 3 a 5 guardianes distintos, k de mayoría estricta y que ninguno sea la clave activa", async function () {
      const ctx = await loadFixture(base);
      const { recovery, relayer, titular, id, g } = ctx;
      const casos = [
        [g.slice(0, 2), 2, "InvalidGuardians"],
        [[...g, cuenta("sexto")], 4, "InvalidGuardians"],
        [g.slice(0, 4), 2, "InvalidThreshold"],
        [g.slice(0, 3), 4, "InvalidThreshold"],
        [[g[0], g[1], g[0]], 2, "InvalidGuardians"],
        [[g[0], g[1], titular], 2, "InvalidGuardians"],
      ];
      for (const [guardianes, k, error] of casos) {
        const direcciones = guardianes.map((x) => x.address);
        const firma = await firmar(ctx, titular, "Setup", {
          identity: id, activeKey: id, guardians: direcciones, threshold: k, nonce: await recovery.opNonces(id),
        });
        await expect(recovery.connect(relayer).setup(id, id, direcciones, k, firma)).to.be.revertedWithCustomError(recovery, error);
      }
    });

    it("exige la firma del dueño vigente y no admite repetirla", async function () {
      const ctx = await loadFixture(base);
      const { recovery, relayer, id, g } = ctx;
      const direcciones = g.map((x) => x.address);
      const valor = { identity: id, activeKey: id, guardians: direcciones, threshold: 3, nonce: 0n };
      const ajena = await firmar(ctx, cuenta("extrano"), "Setup", valor);
      await expect(recovery.connect(relayer).setup(id, id, direcciones, 3, ajena)).to.be.revertedWithCustomError(recovery, "BadSignature");
      const propia = await firmar(ctx, ctx.titular, "Setup", valor);
      await recovery.connect(relayer).setup(id, id, direcciones, 3, propia);
      await expect(recovery.connect(relayer).setup(id, id, direcciones, 3, propia)).to.be.revertedWithCustomError(recovery, "BadSignature");
    });

    it("solo se activa cuando E24Recovery es el dueño en ERC-1056", async function () {
      const ctx = await loadFixture(base);
      const { recovery, relayer, id, g } = ctx;
      const direcciones = g.map((x) => x.address);
      const firma = await firmar(ctx, ctx.titular, "Setup", { identity: id, activeKey: id, guardians: direcciones, threshold: 3, nonce: 0n });
      await recovery.connect(relayer).setup(id, id, direcciones, 3, firma);
      await expect(recovery.activate(id)).to.be.revertedWithCustomError(recovery, "NotOwner");
    });

    it("al activarse, la clave activa queda como delegado sigAuth y veriKey, y el titular no pagó gas", async function () {
      const ctx = await loadFixture(activa);
      const { registry, recovery, id } = ctx;
      expect(await registry.identityOwner(id)).to.equal(recovery.target);
      expect(await registry.validDelegate(id, SIG_AUTH, id)).to.equal(true);
      expect(await registry.validDelegate(id, VERI_KEY, id)).to.equal(true);
      const [activeKey, guardians, threshold, active] = await recovery.getConfig(id);
      expect([activeKey, guardians.length, threshold, active]).to.deep.equal([id, 5, 3n, true]);
      expect(await ethers.provider.getBalance(id)).to.equal(0n);
    });

    it("acepta guardianes que son cuentas de contrato (ERC-1271)", async function () {
      const ctx = await loadFixture(base);
      const wallet = await (await ethers.getContractFactory("MockERC1271Wallet")).deploy(ctx.otro.address);
      await configurar(ctx, [wallet.target, ctx.g[1].address, ctx.g[2].address], 2);
      const valor = { identity: ctx.id, newKey: ctx.nueva.address, nonce: 0n };
      const firmas = [await firmar(ctx, ctx.otro, "StartRecovery", valor), await firmar(ctx, ctx.g[1], "StartRecovery", valor)];
      await expect(ctx.recovery.connect(ctx.relayer).startRecovery(ctx.id, ctx.nueva.address, [wallet.target, ctx.g[1].address], firmas))
        .to.emit(ctx.recovery, "RecoveryInitiated");
    });
  });

  describe("operación normal", function () {
    it("reenvía de inmediato lo que firma la clave activa", async function () {
      const ctx = await loadFixture(activa);
      await expect(operar(ctx, ctx.titular, "setAttribute", [ctx.id, ESTADO, SUSPENDIDO, UN_ANIO]))
        .to.emit(ctx.registry, "DIDAttributeChanged");
      expect((await ctx.recovery.getEntries(ctx.id)).length).to.equal(1);
      await operar(ctx, ctx.titular, "revokeAttribute", [ctx.id, ESTADO, SUSPENDIDO]);
      expect((await ctx.recovery.getEntries(ctx.id)).length).to.equal(0);
    });

    it("rechaza otras firmas, otras identidades, otras funciones y repeticiones", async function () {
      const ctx = await loadFixture(activa);
      const { recovery, registry, relayer, id } = ctx;
      await expect(operar(ctx, ctx.nueva, "setAttribute", [id, ESTADO, SUSPENDIDO, UN_ANIO])).to.be.revertedWithCustomError(recovery, "BadSignature");
      await expect(operar(ctx, ctx.titular, "setAttribute", [ctx.g[0].address, ESTADO, SUSPENDIDO, UN_ANIO])).to.be.revertedWithCustomError(recovery, "BadCall");
      await expect(operar(ctx, ctx.titular, "changeOwner(address,address)", [id, ctx.nueva.address])).to.be.revertedWithCustomError(recovery, "BadCall");

      const data = registry.interface.encodeFunctionData("setAttribute", [id, ESTADO, SUSPENDIDO, UN_ANIO]);
      const firma = await firmar(ctx, ctx.titular, "Operate", { identity: id, data, nonce: await recovery.opNonces(id) });
      await recovery.connect(relayer).operate(id, data, firma);
      await expect(recovery.connect(relayer).operate(id, data, firma)).to.be.revertedWithCustomError(recovery, "BadSignature");
    });

    it("limita los registros a 16 y los valores a 256 bytes", async function () {
      const ctx = await loadFixture(activa);
      await expect(operar(ctx, ctx.titular, "setAttribute", [ctx.id, ESTADO, new Uint8Array(257), UN_ANIO]))
        .to.be.revertedWithCustomError(ctx.recovery, "ValueTooLong");
      for (let i = 0; i < 16; i++) {
        await operar(ctx, ctx.titular, "addDelegate(address,bytes32,address,uint256)", [ctx.id, SIG_AUTH, cuenta(`d${i}`).address, UN_ANIO]);
      }
      await expect(operar(ctx, ctx.titular, "addDelegate(address,bytes32,address,uint256)", [ctx.id, SIG_AUTH, cuenta("d16").address, UN_ANIO]))
        .to.be.revertedWithCustomError(ctx.recovery, "TooManyEntries");
      await operar(ctx, ctx.titular, "revokeDelegate(address,bytes32,address)", [ctx.id, SIG_AUTH, cuenta("d0").address]);
      await operar(ctx, ctx.titular, "addDelegate(address,bytes32,address,uint256)", [ctx.id, SIG_AUTH, cuenta("d16").address, UN_ANIO]);
    });
  });

  describe("robo de clave", function () {
    it("el ladrón no puede retirar la recuperación de inmediato y k guardianes cancelan el retiro", async function () {
      const ctx = await loadFixture(activa);
      const { recovery, id, g } = ctx;
      await expect(pedirCambio(ctx, ctx.titular, ctx.ladron2.address)).to.emit(recovery, "ChangeRequested");
      await expect(recovery.executeChange(id)).to.be.revertedWithCustomError(recovery, "TimelockActive");
      await expect(cancelarCambio(ctx, g.slice(0, 2))).to.be.revertedWithCustomError(recovery, "NotEnoughGuardians");
      await expect(cancelarCambio(ctx, g.slice(0, 3))).to.emit(recovery, "ChangeCancelled");
      expect((await recovery.getChange(id)).kind).to.equal(0n);
    });

    it("los guardianes recuperan tras 72 h y se revoca todo lo que agregó la clave anterior", async function () {
      const ctx = await loadFixture(activa);
      const { recovery, registry, id, g, nueva, ladron2 } = ctx;
      await operar(ctx, ctx.titular, "addDelegate(address,bytes32,address,uint256)", [id, SIG_AUTH, ladron2.address, UN_ANIO]);
      await operar(ctx, ctx.titular, "setAttribute", [id, PUB_KEY_ATTR, ethers.getBytes(ladron2.signingKey.publicKey), UN_ANIO]);
      expect(await registry.validDelegate(id, SIG_AUTH, ladron2.address)).to.equal(true);

      await expect(iniciarRecuperacion(ctx, g.slice(1, 3), nueva.address)).to.be.revertedWithCustomError(recovery, "NotEnoughGuardians");
      await expect(iniciarRecuperacion(ctx, g.slice(1, 4), nueva.address)).to.emit(recovery, "RecoveryInitiated");
      await expect(vetar(ctx, ctx.titular, g[1])).to.be.revertedWithCustomError(recovery, "GuardianApprovedRecovery");
      await expect(recovery.executeRecovery(id)).to.be.revertedWithCustomError(recovery, "TimelockActive");

      await time.increase(TIMELOCK);
      const tx = recovery.executeRecovery(id);
      await expect(tx).to.emit(recovery, "RecoveryExecuted").withArgs(id, (await recovery.getRecovery(id)).id, id, nueva.address);
      await expect(tx).to.emit(registry, "DIDAttributeChanged").withArgs(id, PUB_KEY_ATTR, ethers.hexlify(ladron2.signingKey.publicKey), 0n, anyValue);

      expect(await registry.validDelegate(id, SIG_AUTH, id)).to.equal(false);
      expect(await registry.validDelegate(id, VERI_KEY, id)).to.equal(false);
      expect(await registry.validDelegate(id, SIG_AUTH, ladron2.address)).to.equal(false);
      expect(await registry.validDelegate(id, SIG_AUTH, nueva.address)).to.equal(true);
      expect(await registry.validDelegate(id, VERI_KEY, nueva.address)).to.equal(true);
      expect((await recovery.getEntries(id)).length).to.equal(0);
      expect(await registry.identityOwner(id)).to.equal(recovery.target);

      await expect(operar(ctx, ctx.titular, "setAttribute", [id, ESTADO, SUSPENDIDO, UN_ANIO])).to.be.revertedWithCustomError(recovery, "BadSignature");
      await expect(operar(ctx, nueva, "setAttribute", [id, ESTADO, SUSPENDIDO, UN_ANIO])).to.emit(recovery, "Operated");
    });

    it("una recuperación ejecutada anula el cambio pendiente del ladrón", async function () {
      const ctx = await loadFixture(activa);
      await pedirCambio(ctx, ctx.titular, ctx.ladron2.address);
      await iniciarRecuperacion(ctx, ctx.g.slice(0, 3), ctx.nueva.address);
      await time.increase(TIMELOCK);
      await ctx.recovery.executeRecovery(ctx.id);
      expect((await ctx.recovery.getChange(ctx.id)).kind).to.equal(0n);
      await expect(ctx.recovery.executeChange(ctx.id)).to.be.revertedWithCustomError(ctx.recovery, "NoChangePending");
    });

    it("el ladrón no puede invalidar las firmas que juntan los guardianes (nonces separados)", async function () {
      const ctx = await loadFixture(activa);
      const valor = { identity: ctx.id, newKey: ctx.nueva.address, nonce: await ctx.recovery.guardianNonces(ctx.id) };
      const [quienes, firmas] = await firmasGuardianes(ctx, ctx.g.slice(0, 3), "StartRecovery", valor);
      for (let i = 0; i < 3; i++) await operar(ctx, ctx.titular, "setAttribute", [ctx.id, ESTADO, SUSPENDIDO, UN_ANIO + i]);
      await expect(ctx.recovery.connect(ctx.relayer).startRecovery(ctx.id, ctx.nueva.address, quienes, firmas))
        .to.emit(ctx.recovery, "RecoveryInitiated");
    });
  });

  describe("colusión de guardianes", function () {
    it("la clave activa más un guardián que no aprobó vetan la recuperación", async function () {
      const ctx = await loadFixture(activa);
      const atacante = cuenta("atacante");
      await iniciarRecuperacion(ctx, [ctx.g[0], ctx.g[3], ctx.g[4]], atacante.address);
      await expect(vetar(ctx, ctx.titular, ctx.g[1]))
        .to.emit(ctx.recovery, "RecoveryCancelled");
      expect((await ctx.recovery.getRecovery(ctx.id)).newKey).to.equal(ethers.ZeroAddress);
      await time.increase(TIMELOCK);
      await expect(ctx.recovery.executeRecovery(ctx.id)).to.be.revertedWithCustomError(ctx.recovery, "NoRecoveryPending");
    });

    it("el veto exige firmas válidas de ambos", async function () {
      const ctx = await loadFixture(activa);
      await iniciarRecuperacion(ctx, ctx.g.slice(0, 3), ctx.nueva.address);
      const { id: recoveryId } = await ctx.recovery.getRecovery(ctx.id);
      const valor = { identity: ctx.id, recoveryId };
      const delTitular = await firmar(ctx, ctx.titular, "Veto", valor);
      const falsaDelGuardian = await firmar(ctx, ctx.titular, "Veto", valor);
      await expect(ctx.recovery.veto(ctx.id, delTitular, ctx.g[4].address, falsaDelGuardian))
        .to.be.revertedWithCustomError(ctx.recovery, "BadSignature");
      await expect(ctx.recovery.veto(ctx.id, delTitular, cuenta("no-guardian").address, delTitular))
        .to.be.revertedWithCustomError(ctx.recovery, "NotGuardian");
    });
  });

  describe("cambios con timelock", function () {
    it("cambiar guardianes espera 72 h", async function () {
      const ctx = await loadFixture(activa);
      const nuevos = [ctx.g[0], ctx.g[1], cuenta("guardian-6")].map((x) => x.address);
      await pedirCambio(ctx, ctx.titular, ethers.ZeroAddress, nuevos, 2);
      await expect(ctx.recovery.executeChange(ctx.id)).to.be.revertedWithCustomError(ctx.recovery, "TimelockActive");
      await time.increase(TIMELOCK);
      await ctx.recovery.executeChange(ctx.id);
      const [, guardians, threshold] = await ctx.recovery.getConfig(ctx.id);
      expect([...guardians]).to.deep.equal(nuevos);
      expect(threshold).to.equal(2n);
    });

    it("retiro legítimo: tras 72 h el titular vuelve a ser dueño directo de su identidad", async function () {
      const ctx = await loadFixture(activa);
      await pedirCambio(ctx, ctx.titular, ctx.id);
      await time.increase(TIMELOCK);
      await expect(ctx.recovery.executeChange(ctx.id)).to.emit(ctx.registry, "DIDOwnerChanged");
      expect(await ctx.registry.identityOwner(ctx.id)).to.equal(ctx.id);
      expect(await ctx.registry.validDelegate(ctx.id, SIG_AUTH, ctx.id)).to.equal(false);
      expect((await ctx.recovery.getConfig(ctx.id))[3]).to.equal(false);
      await expect(operar(ctx, ctx.titular, "setAttribute", [ctx.id, ESTADO, SUSPENDIDO, UN_ANIO]))
        .to.be.revertedWithCustomError(ctx.recovery, "NotActive");
      expect(await ethers.provider.getBalance(ctx.id)).to.equal(0n);
    });
  });
});
