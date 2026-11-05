# Contextos JSON-LD externos fijados

Copias locales de los contextos que usan los documentos E24, para validar sin red (`ns/validar-contexto.js`) y para que ninguna implementación los descargue en tiempo de verificación (E24-RFC-0001 §6.6). Se descargaron el 3 de noviembre de 2026 con `Accept: application/ld+json`.

| Archivo | URL | SHA-256 | Comprobación cruzada |
|---|---|---|---|
| `credentials-v2.jsonld` | `https://www.w3.org/ns/credentials/v2` | `59955ced6697d61e03f2b2556febe5308ab16842846f5b586d7f1f7adec92734` | Coincide con el hash que publica la Recomendación W3C *VC Data Model v2.0*. |
| `did-v1.jsonld` | `https://www.w3.org/ns/did/v1` | `4f3eae5568c9c5f036a082088f9e192019ee06faa78973c87ff91d5421b88dad` | Igual en contenido (no en bytes, por formato) a `did-context@3.1.1` de npm. |
| `secp256k1recovery-2020-v2.jsonld` | `https://w3id.org/security/suites/secp256k1recovery-2020/v2` | `442e5eb94f2a5108373120fc01f86bdd1c6fbb71ad11ec44546d1eabe603562f` | Servido por `identity.foundation` tras la redirección de w3id.org. |
| `secp256k1-2019-v1.jsonld` | `https://w3id.org/security/suites/secp256k1-2019/v1` | `8452efdde151151539b78d240f55cee7d9cc985bf078123ce310aa7ae04763b4` | Servido por `jsld.org` tras la redirección de w3id.org. |

Estos archivos son de sus autores (W3C y DIF), no de este repositorio, y se incluyen sin modificar. Si alguno cambia en su origen, no se reemplaza aquí sin revisar la diferencia.
