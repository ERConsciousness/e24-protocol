// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
//
// Verifica en Basescan el código fuente de un despliegue registrado en despliegues/.
//   npx hardhat run scripts/verificar.js --network baseSepolia

const fs = require("fs");
const path = require("path");

const FQN = {
  ERC1056: "ethr-did-registry/contracts/EthereumDIDRegistry.sol:EthereumDIDRegistry",
  E24AnchorRegistry: "contracts/E24AnchorRegistry.sol:E24AnchorRegistry",
  E24Recovery: "contracts/E24Recovery.sol:E24Recovery",
};

async function verificarTodo(hre, datos) {
  for (const [nombre, c] of Object.entries(datos.contratos)) {
    console.log(`verificando ${nombre} (${c.direccion})…`);
    try {
      await hre.run("verify:verify", { address: c.direccion, constructorArguments: c.argumentos, contract: FQN[nombre] });
    } catch (e) {
      if (/already verified/i.test(e.message)) console.log("  ya estaba verificado");
      else throw e;
    }
  }
}

if (require.main === module) {
  const hre = require("hardhat");
  (async () => {
    const { chainId } = await hre.ethers.provider.getNetwork();
    const registro = path.join(__dirname, "..", "despliegues", `${chainId}.json`);
    if (!fs.existsSync(registro)) throw new Error(`No hay despliegue registrado para chain ${chainId}`);
    await verificarTodo(hre, JSON.parse(fs.readFileSync(registro, "utf8")));
  })().catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  });
}

module.exports = { verificarTodo };
