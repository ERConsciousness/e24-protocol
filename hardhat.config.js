// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
require("@nomicfoundation/hardhat-toolbox");
const fs = require("fs");

/**
 * Contratos de referencia de E24-V1 (E24-RFC-0001 §6.7, §7.5).
 *
 * Redes:
 * - hardhat / localhost: pruebas y ensayo (`npx hardhat node`).
 * - baseSepolia (testnet, chain ID 84532): solo con las claves de `.env`
 *   (ver `.env.ejemplo`). El script de despliegue exige además una confirmación
 *   explícita (`E24_CONFIRMAR_DESPLIEGUE`).
 */
if (fs.existsSync(`${__dirname}/.env`)) process.loadEnvFile(`${__dirname}/.env`);

const clave = process.env.E24_CLAVE_DESPLIEGUE;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    baseSepolia: {
      url: process.env.E24_RPC_BASE_SEPOLIA || "https://sepolia.base.org",
      chainId: 84532,
      accounts: clave ? [clave] : [],
    },
  },
  // Etherscan API v2: una sola clave sirve para Basescan.
  etherscan: { apiKey: process.env.E24_ETHERSCAN_API_KEY || "" },
  sourcify: { enabled: false },
};
