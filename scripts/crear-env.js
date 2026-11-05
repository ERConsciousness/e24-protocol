// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Crea `.env` a partir de `.env.ejemplo` con una clave de despliegue NUEVA y una
// semilla de demo aleatorias. Solo muestra la dirección pública: la clave
// privada queda únicamente en `.env`, que git ignora.
//
//   node scripts/crear-env.js
//
// SOLO TESTNET. No mandes fondos reales a esta dirección.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Wallet } = require("ethers");

const RAIZ = path.join(__dirname, "..");
const destino = path.join(RAIZ, ".env");
if (fs.existsSync(destino)) {
  console.error(".env ya existe: no lo sobrescribo. Bórralo a mano si de verdad quieres empezar de cero.");
  process.exit(1);
}

const cuenta = Wallet.createRandom();
const contenido = fs
  .readFileSync(path.join(RAIZ, ".env.ejemplo"), "utf8")
  .replace(/^E24_CLAVE_DESPLIEGUE=.*$/m, `E24_CLAVE_DESPLIEGUE=${cuenta.privateKey}`)
  .replace(/^E24_SEMILLA_DEMO=.*$/m, `E24_SEMILLA_DEMO=${crypto.randomBytes(32).toString("hex")}`);
fs.writeFileSync(destino, contenido, { mode: 0o600 });

console.log("Creado .env (ignorado por git).");
console.log(`Dirección de despliegue y relayer (testnet): ${cuenta.address}`);
console.log(`Pide ETH de Base Sepolia para ella y revisa el saldo en https://sepolia.basescan.org/address/${cuenta.address}`);
