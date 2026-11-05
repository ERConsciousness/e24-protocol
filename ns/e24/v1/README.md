# Contexto JSON-LD `https://estado24.com/ns/e24/v1`

Archivo: `context.jsonld`
SHA-256: `fd39317a85a985e32e193bf80a742e1232daaebf0a22070c12ccabcf5d29f4ed`

Este contexto es **inmutable** (E24-RFC-0001 §6.6). Cualquier cambio, por mínimo que sea, cambia el hash y rompe la conformidad: un cambio de vocabulario se publica como `v2` con un RFC nuevo.

Las implementaciones **DEBEN** llevar una copia local de este archivo, verificada contra el hash, y **NO DEBEN** descargarlo en tiempo de verificación.

Para comprobarlo desde esta carpeta:

```bash
sha256sum context.jsonld
```

Términos que define:

- **Globales:** los tipos `CedulaE24`, `ListaConfianzaE24`, `RetoE24` y `E24ListaConfianza`; el bloque `e24` de los documentos DID; las propiedades de la cédula (`numero`, `categoria`, `perfilEmisor`) y de la lista (`version`, `emisores`, `reconoceListas`).
- **Con alcance**, para no ocupar nombres globales protegidos:
  - dentro de un objeto de tipo `RetoE24`: `proof`, `titular`, `nonce`, `dominio` y `creadoEn`;
  - dentro de `emisores`: `tipos`, `prefijoAlias`, `perfil` y `desde`;
  - dentro de `reconoceListas`: `url` e `issuer`, este último es el emisor de la lista reconocida (`cred:issuer`).

Orden de contextos: credenciales y listas usan `[VC v2, e24]`; el reto también, porque VC v2 aporta `id`, `type` y `DataIntegrityProof`; los documentos DID usan `[DID v1, suite(s) secp256k1, e24]`.

Validación con un procesador JSON-LD real, sin red, desde la raíz del repositorio:

```bash
npm run validar:contexto
``` Los tipos de método de verificación (`EcdsaSecp256k1RecoveryMethod2020`, `EcdsaSecp256k1VerificationKey2019`) vienen de los contextos de sus suites, no de este.
