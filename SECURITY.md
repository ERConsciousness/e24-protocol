# Seguridad

Este proyecto es una simulación educativa en testnet. **No tiene auditoría externa y no protege nada de valor.** La cryptosuite `ecdsa-secp256k1-jcs-e24-2026` es propia y tampoco tiene revisión externa.

## Cómo reportar un problema

Usa el reporte privado de vulnerabilidades de GitHub: pestaña **Security**, botón **Report a vulnerability**. Si el problema es solo de la especificación y no expone a nadie, también puedes abrir un issue.

Indica la versión del RFC o el commit, y cómo reproducirlo. Es un proyecto pequeño: no hay plazos de respuesta garantizados ni programa de recompensas.

## Qué entra en el alcance

- Los contratos `E24AnchorRegistry` y `E24Recovery`.
- La cryptosuite y su especificación (RFC §7.2).
- El SDK en JS.
- Errores en los análisis de seguridad y privacidad del RFC (§8.1 y §9.1).

## Limitaciones conocidas

- Los contratos desplegados no se pueden actualizar: no tienen administrador. Una corrección implica un despliegue nuevo y una versión nueva del RFC.
- Un tercero que conozca el hash de una credencial puede ocuparlo antes que su emisor (RFC §14), y una mayoría de guardianes puede cancelar la salida del titular.
- La identidad es seudónima, no anónima (RFC §9.1).
- El cortafuego entre identidad y fondos todavía no existe.

Las claves y semillas de `rfc/`, `test/` y `lab-simulacion-e24/` son públicas y de prueba: encontrarlas aquí no es una vulnerabilidad.
