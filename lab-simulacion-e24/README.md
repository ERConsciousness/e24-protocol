# lab-simulacion-e24 · simulación de referencia de E24-V1

> ⚠ **Simulación educativa · red `sim` · claves de prueba · personas y comunidades ficticias · sin validez jurídica.**

Implementación de referencia de E24-RFC-0001 en una cadena simulada en memoria. Imita tres contratos:

- **ERC-1056** (`EthereumDIDRegistry`): dueños, delegados con vigencia, atributos y operaciones firmadas que envía un relayer.
- **E24AnchorRegistry:** anclas de credenciales, sin administrador y sin el titular en cadena.
- **E24Recovery:** recuperación social k-de-n con timelock de 72 h y veto.

## Cómo correrla

Requiere Python 3 con `ecdsa` y `pycryptodome`. Desde esta carpeta:

```bash
python e24_sim.py
```

Termina con código 0 si todas las expectativas se cumplen y con código 1 si alguna falla. En Windows, si la consola muestra mal los acentos, define `PYTHONIOENCODING=utf-8`.

## Qué demuestra

| Paso | Qué |
|---|---|
| 0 | Conformidad: reproduce el test vector #1, que generó otro programa (`../rfc/gen_test_vector.py`). |
| 1 | El DID del titular existe sin registro, sin gas y sin permiso. |
| 2 | Una comunidad opera con una cuenta multifirma 2-de-3 que autoriza un delegado de firma. |
| 3 | Listas de confianza: A reconoce a su emisor; B reconoce la lista de A. |
| 4–5 | Emisión y anclaje pagados por un relayer; un emisor cualquiera también puede emitir. |
| 6 | Verificación con distintas listas: validez y reconocimiento se informan por separado. |
| 7 | Un relayer no puede alterar operaciones firmadas, y nadie ancla en nombre de otro. |
| 8 | Rotación de custodia: las credenciales firmadas por el delegado anterior siguen valiendo. |
| 9 | Tampering: un carácter alterado y una firma high-S se rechazan. |
| 10 | Un emisor revoca su credencial; nadie más puede hacerlo. |
| 11 | Suspensión reversible, solo por el titular. |
| 12 | Recuperación social: robo de clave, timelock, veto con guardián y colusión de guardianes. |
| 13 | Privacidad: ningún dato personal ni el titular en las anclas. |
| 14 | El titular no pagó ninguna operación. |

## Artefactos

`artifacts/` contiene los documentos DID, las credenciales, las listas de confianza, los resultados de verificación y el estado de la cadena simulada. Todo es determinístico: dos ejecuciones producen archivos idénticos byte a byte.

## Licencia

Apache License 2.0 · © 2026 Ethereal Realms Consciousness LLC y contribuidores. Ver `../LICENSE` y `../NOTICE`.
