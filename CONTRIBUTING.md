# Cómo contribuir

La especificación está en borrador y se aceptan comentarios, en especial sobre seguridad, privacidad y conformidad con los estándares de W3C.

- **Comentarios sobre el RFC:** abre un issue que cite la sección. Las resoluciones se registran en §15.
- **Cambios de código:** corre las pruebas antes de proponerlos:

  ```bash
  npx hardhat test
  ```

  ```bash
  npm run validar:contexto
  ```

- **Archivos fijados por hash:** `ns/e24/v1/context.jsonld`, `ns/externos/` y `rfc/E24-RFC-0001-test-vector-1.json`. Si cambias el contexto o el vector, actualiza sus hashes y explica por qué. Una vez publicado, el contexto `v1` es inmutable y los cambios van a una `v2`.
- **Datos:** no incluyas datos personales ni claves reales. Las demos usan solo personas ficticias.

## Licencia de los aportes

Los aportes de código quedan bajo Apache License 2.0 (sección 5 de la licencia), y los de la especificación, bajo CC BY 4.0. Cada contribuidor conserva el copyright de lo que aporta.
