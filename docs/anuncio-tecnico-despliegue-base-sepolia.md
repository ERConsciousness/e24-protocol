# Anuncio técnico: despliegue de E24-V1 en Base Sepolia

```
Publicado:       5 de noviembre de 2026
Hechos al:       5 de noviembre de 2026 (RFC v0.5.4)
```

> Simulación educativa / testnet · sin auditar · sin validez jurídica.

## Qué ocurrió

El 3 de noviembre de 2026, a las 17:08:41 UTC (11:08:41 hora central), se desplegaron en Base Sepolia los contratos de referencia de E24-V1: el registro de identidad ERC-1056, `E24AnchorRegistry` y `E24Recovery`.

## Red

| Dato | Valor |
|---|---|
| Red | Base Sepolia (testnet) |
| Chain ID | 84532 |
| Cuenta que desplegó | `0xc5F9F9cFc40c7E3e1e2838302Ab0c16D2dd493f7` |

## Contratos y transacciones

| Contrato | Dirección | Bloque | Transacción de despliegue |
|---|---|---|---|
| ERC-1056 `EthereumDIDRegistry` (`ethr-did-registry@1.3.0`, sin modificar) | `0xdE8565d7E170F88CF21735B023d3C67eb491ecdB` | 54019265 | `0xbb6f3b42d980a39087021b823e721420b463ecd33bfbff52a8b1aefc1db1467b` |
| `E24AnchorRegistry` | `0x9c70A6c7DA22C9beb03C828F64fCae073608C3B2` | 54019270 | `0x9477058f3143353533f7c82364a5453fa9ecf89aad73b0b0672233897de09f3d` |
| `E24Recovery` | `0xF076d4aD5Ad7d26545BF900d91CCAEf0321548D1` | 54019275 | `0xe1b37576bda08cabb143c35473dc12d615400f07f42e8f4ad5fff53443602c93` |

## Versión

| Dato | Valor |
|---|---|
| Especificación | E24-RFC-0001 |
| Reglas que implementan los contratos | v0.5 (§6.7 y §7.5), sin cambios en los contratos desde entonces |
| RFC en el commit desplegado | v0.5.1, SHA-256 `07d899c06652e2ed7a883ee44a34d8e147946a691ad6054a84f60fe4254d5ea5` |
| RFC con las direcciones fijadas (§11.1) | v0.5.2, SHA-256 `f5ef8ecc308f2371f61d5847dc7a858a96f0fd872927c073a3c064adfdebc5f4` |
| RFC vigente | v0.5.4: `proofValue` en multibase y seguridad y privacidad completas, sin cambiar los contratos · SHA-256 `a3e2480911bc1dcd5c82bff213cf32c654e78313dbd723e2dc1b2e5ea0b41e31` |
| Compilador | solc 0.8.24, optimizador con 200 runs, EVM `cancun` |

## Repositorio

| Dato | Valor |
|---|---|
| Repositorio público | <https://github.com/ERConsciousness/e24-protocol> |
| Etiqueta pública | `e24-v0.5.4`, commit `37a22a1624025d23cea0d94bac51bdd1c3fc1ed8` |
| Árbol git de `contracts/` | `81168573f187dcf5b33e434367c8ea6659db91c5`, igual en la etiqueta pública y en el commit desplegado |
| Commit desplegado | `c02602512e6c525a91fa7ef30a2b5c1d92e904ac` (etiqueta `e24-v0.5.1-base-sepolia`), en el repositorio **privado** del autor, que también conserva la proveniencia |

El repositorio público empezó el 5 de noviembre de 2026, después del despliegue: su historial no prueba por sí solo la fecha del despliegue. Esa fecha la da la cadena.

## Cómo comprobarlo

- **Código y bytecode:** Sourcify da `exact_match` en los tres contratos, en creación y en runtime. Blockscout los muestra como verificados: [ERC-1056](https://base-sepolia.blockscout.com/address/0xdE8565d7E170F88CF21735B023d3C67eb491ecdB?tab=contract), [`E24AnchorRegistry`](https://base-sepolia.blockscout.com/address/0x9c70A6c7DA22C9beb03C828F64fCae073608C3B2?tab=contract) y [`E24Recovery`](https://base-sepolia.blockscout.com/address/0xF076d4aD5Ad7d26545BF900d91CCAEf0321548D1?tab=contract).
- **El mismo código, desde el repositorio público:** `git rev-parse e24-v0.5.4:contracts` debe dar el árbol de arriba, y al compilar con los ajustes indicados se obtiene el bytecode desplegado. En `E24AnchorRegistry` y `E24Recovery`, la comparación descuenta la dirección de ERC-1056 que se fija al desplegar.
- **Basescan:** a la fecha de estos hechos, solo ERC-1056 aparece verificado. La verificación de los otros dos sigue pendiente.
- **Fecha:** la dan el bloque y la transacción, no este texto.

## Alcance y límites

La coincidencia exacta prueba que el bytecode corresponde al código fuente publicado. No prueba que ese código cumpla todo el RFC ni que sea seguro: para eso hay pruebas propias (42 en verde) y un análisis con Slither, pero **ninguna auditoría externa**. La suite de firma es propia y no tiene revisión externa.

| A la fecha de estos hechos | Estado |
|---|---|
| Contratos desplegados | Sí |
| Operaciones sobre los contratos (identidades, anclas, recuperaciones) | **Ninguna** en la cadena; el flujo completo solo se ha ensayado en red local |
| Billetera, relayer como servicio y verificador web | No existen |
| Contexto JSON-LD publicado en `estado24.com` | No |
| Cortafuego de privacidad (v0.6) | Diseñado, no implementado |
| Usuarios o emisores reales | Ninguno |

**Formulación correcta:** "Los contratos de E24-V1 están desplegados en Base Sepolia desde el 3 de noviembre de 2026."

**Formulación que todavía no corresponde:** "El protocolo está operando en testnet desde el 3 de noviembre." Para eso, primero tiene que haber operaciones en la cadena.

## Actualización del 5 de noviembre de 2026

Se registró un defecto conocido en `E24AnchorRegistry`: un tercero que conozca el hash de una credencial puede ocuparlo antes que su emisor. No permite falsificarla, y no hay anclas afectadas. Una corrección implicaría desplegar ese contrato de nuevo, y su dirección cambiaría. Ver RFC v0.5.5 §14 y la [solicitud de comentarios](solicitud-comentarios-01-anclas-y-alcance.md).

---

© 2026 Ethereal Realms Consciousness LLC y contribuidores · Código: Apache 2.0 · Especificación: CC BY 4.0.
