# Estado 24 · protocolo E24-V1

> ⚠ **Simulación educativa / testnet · sin auditar · sin validez jurídica.** No lo uses con personas reales ni con datos reales.

Especificación e implementaciones de referencia del método DID `did:e24` y del protocolo E24-V1: identidad autocontrolada sobre ERC-1056, con emisión abierta de credenciales, listas de confianza por comunidad y recuperación social, sin administrador en los contratos.

La especificación es [E24-RFC-0001](rfc/E24-RFC-0001-did-e24.md), en estado de **borrador**. Se aceptan comentarios.

## Estado actual

| Pieza | Estado |
|---|---|
| Especificación | Borrador v0.5.5 |
| Contratos | Desplegados en Base Sepolia, sin auditoría externa |
| Defecto conocido | Ocupación del hash de un ancla, sin corregir. [Comentarios abiertos](docs/solicitud-comentarios-01-anclas-y-alcance.md) |
| Operaciones en la cadena | Ninguna todavía. El flujo completo solo se ha ensayado en red local |
| SDK en JS (cryptosuite, resolver y verificador) | Implementación de referencia; solo lee ERC-1056 y `E24AnchorRegistry` |
| Contexto JSON-LD `v1` | En este repositorio; aún no publicado en `estado24.com` |
| Billetera, relayer como servicio y verificador web | No existen |
| Privacidad | **Seudónimo, no anónimo.** Ver RFC §9.1 |
| Registro del método y de la cryptosuite | Sin solicitar |

## Despliegue en Base Sepolia (testnet, chain ID 84532)

Desplegado el 3 de noviembre de 2026, a las 17:08:41 UTC. Datos completos en [despliegues/84532.json](despliegues/84532.json) y en el RFC §11.1.

| Contrato | Dirección | Transacción |
|---|---|---|
| ERC-1056 (`ethr-did-registry@1.3.0`, sin modificar) | [`0xdE8565d7E170F88CF21735B023d3C67eb491ecdB`](https://base-sepolia.blockscout.com/address/0xdE8565d7E170F88CF21735B023d3C67eb491ecdB?tab=contract) | `0xbb6f3b42d980a39087021b823e721420b463ecd33bfbff52a8b1aefc1db1467b` |
| `E24AnchorRegistry` | [`0x9c70A6c7DA22C9beb03C828F64fCae073608C3B2`](https://base-sepolia.blockscout.com/address/0x9c70A6c7DA22C9beb03C828F64fCae073608C3B2?tab=contract) | `0x9477058f3143353533f7c82364a5453fa9ecf89aad73b0b0672233897de09f3d` |
| `E24Recovery` | [`0xF076d4aD5Ad7d26545BF900d91CCAEf0321548D1`](https://base-sepolia.blockscout.com/address/0xF076d4aD5Ad7d26545BF900d91CCAEf0321548D1?tab=contract) | `0xe1b37576bda08cabb143c35473dc12d615400f07f42e8f4ad5fff53443602c93` |

Compilador: solc 0.8.24, optimizador con 200 runs, EVM `cancun`. Ver el [anuncio técnico](docs/anuncio-tecnico-despliegue-base-sepolia.md).

### Cómo comprobar el código desplegado

- Sourcify da `exact_match` en los tres contratos, en creación y en runtime.
- El historial de este repositorio empieza después del despliegue, y el commit desplegado está en el repositorio privado del autor. El árbol git de [contracts/](contracts/) es el mismo que se desplegó. Debe dar `81168573f187dcf5b33e434367c8ea6659db91c5`:

  ```bash
  git rev-parse HEAD:contracts
  ```

La coincidencia exacta prueba que el bytecode corresponde al código fuente, no que ese código cumpla todo el RFC ni que sea seguro.

## Qué hay aquí

| Carpeta | Qué contiene |
|---|---|
| `rfc/` | La especificación, el test vector #1 y su generador |
| `ns/e24/v1/` | El contexto JSON-LD `v1`, fijado por hash |
| `ns/externos/` | Copias fijadas por hash de los contextos de terceros, para validar sin red |
| `contracts/`, `test/` | Contratos en Solidity y sus pruebas en Hardhat |
| `sdk/` | Cryptosuite, resolver y verificador en JS |
| `scripts/` | Despliegue, verificación y demo |
| `lab-simulacion-e24/` | Simulación en Python del ciclo de vida, en red `sim` |
| `despliegues/` | Registro del despliegue |
| `docs/` | Anuncio técnico del despliegue y solicitudes de comentarios |

**Las claves y semillas del test vector, las pruebas y la simulación son públicas y solo sirven para pruebas.** Nunca las uses para nada de valor.

## Cómo probarlo

Requiere Node.js 20.12 o posterior:

```bash
npm ci
```

```bash
npx hardhat test
```

```bash
npm run validar:contexto
```

La simulación y el test vector requieren Python 3 con `ecdsa` y `pycryptodome`:

```bash
python rfc/gen_test_vector.py
```

```bash
python lab-simulacion-e24/e24_sim.py
```

Para ensayar la demo completa en local, con personas ficticias, deja corriendo `npx hardhat node` y ejecuta:

```bash
npx hardhat run scripts/desplegar.js --network localhost
```

```bash
npx hardhat run scripts/demo-l0.js --network localhost
```

## Procedencia

E24-RFC-0001 deriva de MV-RFC-0001 (`did:mv`), un prototipo de laboratorio que nunca se desplegó. Ese material queda fuera de este repositorio porque incluye datos personales y claves de prueba antiguas. El RFC §13 fija el hash de su manifiesto.

## Licencia

Código: Apache License 2.0. Especificaciones: CC BY 4.0. © 2026 Ethereal Realms Consciousness LLC y contribuidores. Ver [LICENSE](LICENSE) y [NOTICE](NOTICE). Los archivos de `ns/externos/` conservan las licencias de sus autores.

Ver también [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) y [CHANGELOG.md](CHANGELOG.md).
