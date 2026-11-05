// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Despliega ERC-1056 (ethr-did-registry@1.3.0, sin modificar), E24AnchorRegistry
// y E24Recovery, y deja constancia en despliegues/.
//
//   Ensayo local:  npx hardhat node           (en otra terminal)
//                  npx hardhat run scripts/desplegar.js --network localhost
//   Base Sepolia:  E24_CONFIRMAR_DESPLIEGUE=baseSepolia en .env, y
//                  npx hardhat run scripts/desplegar.js --network baseSepolia
//
// En una red pública el script se niega a correr si falta la confirmación,
// si el árbol de git tiene cambios sin commit o si ya hay un despliegue registrado.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const hre = require("hardhat");
const { ethers, network } = hre;

const RAIZ = path.join(__dirname, "..");
const LOCALES = ["hardhat", "localhost"];
const FUENTE_ERC1056 = "node_modules/ethr-did-registry/contracts/EthereumDIDRegistry.sol";
const FQN_ERC1056 = "ethr-did-registry/contracts/EthereumDIDRegistry.sol:EthereumDIDRegistry";

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: RAIZ, encoding: "utf8" }).trim();
}

function archivoRegistro(chainId) {
  return LOCALES.includes(network.name)
    ? path.join(RAIZ, "despliegues", `local-${chainId}.json`)
    : path.join(RAIZ, "despliegues", `${chainId}.json`);
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  const publica = !LOCALES.includes(network.name);
  const registro = archivoRegistro(chainId);

  if (publica) {
    if (process.env.E24_CONFIRMAR_DESPLIEGUE !== network.name) {
      throw new Error(`Red pública "${network.name}": falta E24_CONFIRMAR_DESPLIEGUE=${network.name} en .env.`);
    }
    if (network.name === "baseSepolia" && chainId !== 84532n) throw new Error(`chain ID inesperado: ${chainId}`);
    if (git("status --porcelain")) throw new Error("Hay cambios sin commit: el despliegue debe salir de un commit exacto.");
    if (fs.existsSync(registro)) throw new Error(`Ya hay un despliegue registrado en ${path.relative(RAIZ, registro)}.`);
  }

  const [cuenta] = await ethers.getSigners();
  if (!cuenta) throw new Error("No hay cuenta de despliegue: define E24_CLAVE_DESPLIEGUE en .env.");
  const saldo = await ethers.provider.getBalance(cuenta.address);
  console.log(`red ${network.name} (chain ${chainId}) · cuenta ${cuenta.address} · saldo ${ethers.formatEther(saldo)} ETH`);
  if (saldo === 0n) throw new Error("La cuenta de despliegue no tiene fondos (faucet de Base Sepolia).");

  const confirmaciones = publica ? 2 : 1;
  const desplegar = async (nombre, args = []) => {
    const fabrica = await ethers.getContractFactory(nombre);
    const contrato = await fabrica.deploy(...args);
    const tx = contrato.deploymentTransaction();
    const recibo = await tx.wait(confirmaciones);
    const direccion = await contrato.getAddress();
    const codigo = await ethers.provider.getCode(direccion);
    console.log(`  ${nombre.padEnd(20)} ${direccion}  tx ${tx.hash}  bloque ${recibo.blockNumber}`);
    return {
      contrato,
      datos: {
        direccion, tx: tx.hash, bloque: recibo.blockNumber, gas: recibo.gasUsed.toString(),
        argumentos: args.map(String), keccakBytecodeDesplegado: ethers.keccak256(codigo),
      },
    };
  };

  console.log("desplegando…");
  const erc1056 = await desplegar("EthereumDIDRegistry");
  const anclas = await desplegar("E24AnchorRegistry", [erc1056.datos.direccion]);
  const recuperacion = await desplegar("E24Recovery", [erc1056.datos.direccion]);

  // Comprobaciones mínimas tras desplegar.
  if ((await anclas.contrato.registry()) !== erc1056.datos.direccion) throw new Error("E24AnchorRegistry apunta a otro ERC-1056");
  if ((await recuperacion.contrato.registry()) !== erc1056.datos.direccion) throw new Error("E24Recovery apunta a otro ERC-1056");
  if ((await anclas.contrato.RESOLVER_VERSION()) !== 1n) throw new Error("RESOLVER_VERSION inesperado");

  const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(RAIZ, f))).digest("hex");
  const datos = {
    protocolo: "E24-V1",
    rfc: "E24-RFC-0001",
    red: network.name,
    chainId: Number(chainId),
    fecha: new Date().toISOString(),
    commit: git("rev-parse HEAD"),
    arbolLimpio: git("status --porcelain") === "",
    cuentaDespliegue: cuenta.address,
    compilador: hre.config.solidity.compilers[0],
    contratos: {
      ERC1056: { ...erc1056.datos, fuente: `ethr-did-registry@1.3.0 ${FQN_ERC1056}`, sha256Fuente: sha256(FUENTE_ERC1056) },
      E24AnchorRegistry: { ...anclas.datos, fuente: "contracts/E24AnchorRegistry.sol", sha256Fuente: sha256("contracts/E24AnchorRegistry.sol") },
      E24Recovery: { ...recuperacion.datos, fuente: "contracts/E24Recovery.sol", sha256Fuente: sha256("contracts/E24Recovery.sol") },
    },
  };
  fs.mkdirSync(path.dirname(registro), { recursive: true });
  fs.writeFileSync(registro, JSON.stringify(datos, null, 2) + "\n");
  console.log(`registro: ${path.relative(RAIZ, registro)}`);

  if (publica) {
    if (!process.env.E24_ETHERSCAN_API_KEY) {
      console.log("Sin E24_ETHERSCAN_API_KEY: verifica después con  npx hardhat run scripts/verificar.js --network " + network.name);
    } else {
      await require("./verificar").verificarTodo(hre, datos);
    }
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
