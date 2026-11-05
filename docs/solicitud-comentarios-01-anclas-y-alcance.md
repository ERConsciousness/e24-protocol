# Solicitud de comentarios 01: ocupación de anclas y alcance de las afirmaciones

```
Fecha:        5 de noviembre de 2026
Base:         E24-RFC-0001 v0.5.5 · repositorio e24-protocol
Comentarios:  dos semanas desde su publicación
Estado:       abierta; ninguna opción está decidida
```

> Simulación educativa / testnet · sin auditar · sin validez jurídica.

**Summary in English.** E24-V1 is a draft DID method and credential protocol deployed on Base Sepolia. We found a griefing flaw in our anchor registry: it keeps a single entry per hash, so anyone who learns a credential's hash before it is anchored can anchor it first under their own identity, which blocks the legitimate issuer. It does not forge credentials, and no anchors exist on-chain yet. We propose indexing anchors by issuer and hash, which requires a new deployment. We also ask for review of how we describe the project's guarantees. Comments are welcome in English or Spanish.

## Por qué publicamos esto

Encontramos este defecto al contrastar el discurso del proyecto con su código. Preferimos resolverlo a la vista, antes de que exista una sola ancla en la cadena, cuando corregirlo todavía no le cuesta nada a nadie.

Buscamos dos cosas: que nos digan si el análisis es correcto y qué se nos escapó.

## Parte 1 · Ocupación de anclas

### El defecto

`E24AnchorRegistry` guarda una sola entrada por hash de credencial, sin importar quién la creó:

```solidity
mapping(bytes32 => Anchor) anchors;
```

Cualquier identidad puede anclar en su propio nombre, y eso es deliberado: la emisión es abierta. Pero, combinado con la entrada única, permite esto:

1. Un emisor firma una credencial y calcula su hash.
2. Un tercero se entera del hash antes de que quede anclado.
3. El tercero llama a `anchorCredential(suDireccion, hash)`.
4. Cuando el emisor legítimo intenta anclar, recibe `AlreadyAnchored`.

**Cómo reproducirlo:**

```bash
npx hardhat test --grep "defecto conocido"
```

Las pruebas están en `test/E24AnchorRegistry.test.js` y `test/sdk.test.js`. La suite ya incluía una prueba, "un mismo hash no se ancla dos veces", que fijaba este comportamiento sin que lo viéramos como un problema.

### Alcance

| Pregunta | Respuesta |
|---|---|
| ¿Permite falsificar una credencial? | No. El verificador exige que el emisor del ancla coincida con el de la credencial, y la presentación falla. |
| ¿Qué logra el atacante? | Bloquear esa credencial concreta. Sigue sin poder anclarse a nombre del emisor. |
| ¿Hay recuperación? | El emisor puede volver a emitir: una prueba con otra fecha produce otro hash. Si el atacante vuelve a verlo a tiempo, puede repetir. |
| ¿Cómo se entera del hash? | Por la transacción de anclaje antes de confirmarse, por el relayer, o por una copia de la credencial que circule antes de anclarse. |
| ¿Es fácil en Base? | **No lo medimos.** No afirmamos que sea fácil ni difícil. |
| ¿Hay anclas afectadas? | Ninguna: a la fecha de este documento, los contratos no tienen operaciones. |

### Opciones

| Opción | Cómo funciona | A favor | En contra |
|---|---|---|---|
| **A. Indexar por emisor y hash** (propuesta) | `mapping(address => mapping(bytes32 => Anchor))`. El verificador consulta con el `issuer` de la credencial. | Elimina el problema: un hash ajeno bajo otro emisor no estorba. No agrega pasos. | Requiere un `E24AnchorRegistry` nuevo y cambiar `anchors`, `revokeCredential` y la firma `Revoke`. |
| B. Comprometer y revelar | Primero se registra un compromiso y después el hash. | Oculta el hash durante el envío. | Dos transacciones y más complejidad; no protege si la credencial ya circuló. |
| C. Envío privado | Mandar las transacciones por un canal no público. | No cambia el contrato. | Es una mitigación: depende de un tercero y no cubre las copias que circulan. |
| D. Aceptar y documentar | El emisor vuelve a emitir si le pasa. | Sin trabajo ni despliegue. | Deja un punto de bloqueo conocido en un protocolo que aún está a tiempo de corregirlo. |

**Propuesta:** opción A. Solo habría que redesplegar `E24AnchorRegistry`; ERC-1056 y `E24Recovery` seguirían en sus direcciones. La firma de credenciales y el test vector no cambian.

### Preguntas

1. ¿El análisis es correcto? ¿Hay un impacto mayor que no estemos viendo?
2. ¿La opción A abre algún problema nuevo? Por ejemplo, en lotes con raíz Merkle o en la búsqueda de anclas por parte de un verificador.
3. ¿Vale la pena medir la explotabilidad en Base, o hay que corregirlo de todas formas?
4. Una corrección cambia la interfaz del contrato. El RFC dice que un cambio incompatible requiere contrato y RFC nuevos, pero sigue en borrador. ¿Basta con una versión nueva del mismo RFC, y `RESOLVER_VERSION` debería subir?

## Parte 2 · Alcance de lo que afirmamos

Borradores de comunicación del proyecto usaron tres frases. Contrastadas con los contratos, ninguna se sostiene sin matices, y dejamos de usarlas para describir E24-V1.

| Frase | Qué es cierto | Dónde falla |
|---|---|---|
| "La identidad le pertenece a la persona" | Una dirección es dueña de sí misma sin transacción. Nadie más puede cambiarla, y los contratos no tienen administrador. | Pertenece a quien tiene la clave. Sin guardianes, perder la clave es perder la identidad. Con recuperación activa, una mayoría de guardianes puede cambiar la clave tras 72 h si el titular no consigue un guardián que no haya aprobado para vetar, y puede cancelar repetidamente su salida. |
| "Las credenciales viajan con quien las ganó" | El titular las guarda fuera de la cadena, y siguen siendo válidas tras recuperar la clave. | El emisor puede revocarlas, y sin ancla vigente no pasan la verificación. La recuperación devuelve la clave, no el archivo. Están atadas a un DID. El código no sabe si alguien las "ganó". Aún no hay billetera. |
| "No hace falta pedirle permiso a nadie" | Crear un DID y anclar en nombre propio no requieren permiso. | Hacen falta gas o un relayer, pasar la admisión de un emisor y estar en una lista de confianza para ser reconocido. |

**Formulaciones que proponemos:**

- "La identidad la controla quien tiene la clave; ningún administrador puede quitársela."
- "La credencial la guarda el titular, y la verificación no depende de una base de datos del emisor, aunque el emisor puede revocarla."
- "Crear una identidad y emitir no requiere permiso; que te reconozcan depende de cada comunidad."

### Preguntas

5. ¿Estas formulaciones son exactas, o siguen prometiendo de más?
6. Que los guardianes puedan cancelar la salida protege contra un ladrón que intente retirar la recuperación, pero también le da a una mayoría poder para retener al titular. ¿Es el equilibrio correcto, y cómo se limitaría sin devolverle esa puerta al ladrón?
7. La recuperación no devuelve el archivo de las credenciales. ¿Debe el protocolo decir algo sobre respaldos o sobre volver a pedir una credencial, o es asunto de la billetera?

## Revisión adicional bienvenida

- La cryptosuite `ecdsa-secp256k1-jcs-e24-2026` (RFC §7.2), que es propia y no tiene revisión externa.
- Los análisis de seguridad y privacidad (RFC §8.1 y §9.1), que escribimos nosotros y que no vieron este defecto.
- La conformidad con *Data Integrity*: sus secciones 5 y 6 no las revisamos punto por punto.

## Cómo comentar

- **Comentarios públicos:** abre un issue en el repositorio y cita el número de pregunta.
- **Si encuentras algo más grave o explotable contra terceros:** usa el reporte privado que indica [SECURITY.md](../SECURITY.md).
- **Idioma:** español o inglés.
- **Datos:** no incluyas datos personales ni claves reales.

## Qué pasará con los comentarios

Cada resolución se registrará en el RFC §15, con su autor si lo autoriza. La decisión final la toma el autor del RFC, y los motivos quedarán escritos. No podemos prometer plazos de respuesta. Los aportes al texto del RFC quedan bajo CC BY 4.0, y los de código, bajo Apache 2.0.
