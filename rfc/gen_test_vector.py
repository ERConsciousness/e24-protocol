#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
"""
E24-RFC-0001 · Conformance Test Vector #1 · generador determinístico
=====================================================================
⚠ SIMULACIÓN EDUCATIVA · claves de PRUEBA · sin validez jurídica ⚠

Todo es determinístico: claves derivadas de semillas públicas, timestamps
fijos, firma ECDSA determinística (RFC 6979) normalizada a low-S. Cualquier
implementación que siga E24-RFC-0001 DEBE reproducir exactamente los mismos
DIDs, firmas y hashes, y los mismos resultados de verificación.

Cubre:
  - Derivación de DID en red `eth` (keccak) y `sim` (SHA-256) desde la misma llave.
  - Documento DID por defecto (sin registro en ERC-1056), `#raiz` por recuperación.
  - `CedulaE24` firmada con la cryptosuite ecdsa-secp256k1-jcs-e24-2026 (JCS).
  - Ancla esperada en E24AnchorRegistry.
  - Reto de presentación firmado por el titular.
  - Listas de confianza de dos instancias y resultados de reconocimiento por
    profundidad (§7.4).
  - Tests negativos ejecutables: un carácter alterado, firma high-S, método de
    verificación sustituido, metadatos de la prueba alterados.

Requiere: ecdsa, pycryptodome (keccak).
Uso:  python gen_test_vector.py   →  escribe E24-RFC-0001-test-vector-1.json
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from Crypto.Hash import keccak
from ecdsa import SigningKey, VerifyingKey, SECP256k1, BadSignatureError
from ecdsa.util import sigencode_string, sigdecode_string

AQUI = Path(__file__).resolve().parent
CONTEXTO_LOCAL = AQUI.parent / "ns" / "e24" / "v1" / "context.jsonld"
SALIDA = AQUI / "E24-RFC-0001-test-vector-1.json"

CTX_DID = "https://www.w3.org/ns/did/v1"
CTX_VC = "https://www.w3.org/ns/credentials/v2"
CTX_E24 = "https://estado24.com/ns/e24/v1"
CTX_SECP_REC = "https://w3id.org/security/suites/secp256k1recovery-2020/v2"
CRYPTOSUITE = "ecdsa-secp256k1-jcs-e24-2026"
PROTOCOLO = "E24-V1"
CHAIN_ID = 84532  # Base Sepolia
RESOLVER_VERSION = 1
N = SECP256k1.order

# ---- parámetros fijos del vector ---------------------------------------------
SEMILLAS = {
    "titular": "E24-RFC-0001-TV1-TITULAR",
    "emisor": "E24-RFC-0001-TV1-EMISOR",
    "instanciaA": "E24-RFC-0001-TV1-INSTANCIA-A",
    "instanciaB": "E24-RFC-0001-TV1-INSTANCIA-B",
}
TS_EMISION = "2026-11-01T00:00:00Z"
TS_HASTA = "2027-05-01T00:00:00Z"
TS_RETO = "2026-11-02T12:00:00Z"
TS_VERIFICACION = "2026-11-02T12:00:30Z"
URL_LISTA_A = "https://instancia-a.example/.well-known/e24-lista-confianza.json"
URL_LISTA_B = "https://instancia-b.example/.well-known/e24-lista-confianza.json"
URL_PERFIL = "https://emisor.example/e24/perfil.json"
DOMINIO_VERIFICADOR = "verificador.example"


def unix(ts: str) -> int:
    return int(datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


# ---- primitivas ----------------------------------------------------------------
def jcs(obj) -> bytes:
    """JSON Canonicalization Scheme (RFC 8785) para el subconjunto que usa E24-V1:
    objetos, arreglos, cadenas, enteros, booleanos y null (sin punto flotante)."""
    def ser(o) -> str:
        if o is None:
            return "null"
        if o is True:
            return "true"
        if o is False:
            return "false"
        if isinstance(o, int):
            return str(o)
        if isinstance(o, float):
            raise TypeError("E24-V1 no usa números de punto flotante")
        if isinstance(o, str):
            return json.dumps(o, ensure_ascii=False)
        if isinstance(o, list):
            return "[" + ",".join(ser(x) for x in o) + "]"
        if isinstance(o, dict):
            claves = sorted(o, key=lambda k: k.encode("utf-16-be"))  # orden por unidades UTF-16
            return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + ser(o[k]) for k in claves) + "}"
        raise TypeError(f"tipo no soportado: {type(o)}")
    return ser(obj).encode("utf-8")


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def keccak256(data: bytes) -> bytes:
    k = keccak.new(digest_bits=256)
    k.update(data)
    return k.digest()


def clave_desde_semilla(semilla: str) -> SigningKey:
    """Clave secp256k1 determinística: escalar = SHA-256(semilla)."""
    return SigningKey.from_string(sha256(semilla.encode("utf-8")), curve=SECP256k1)


def identificador(vk: VerifyingKey, red: str) -> str:
    """Derivación normativa (E24-RFC-0001 §6.3)."""
    xy = vk.to_string()  # X‖Y, 64 bytes
    if red == "eth":
        return "0x" + keccak256(xy)[12:].hex()
    if red == "sim":
        return "0x" + sha256(xy).hex()[:40]
    raise ValueError(f"derivación no definida para red '{red}'")


def did(vk: VerifyingKey, red: str) -> str:
    return f"did:e24:{red}:{identificador(vk, red)}"


ALFABETO_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def codificar_prueba(firma: bytes) -> str:
    """proofValue: multibase base58btc (prefijo z) de r‖s, 64 bytes."""
    n = int.from_bytes(firma, "big")
    texto = ""
    while n:
        n, resto = divmod(n, 58)
        texto = ALFABETO_B58[resto] + texto
    return "z" + "1" * (len(firma) - len(firma.lstrip(b"\0"))) + texto


def decodificar_prueba(valor: str):
    """Bytes de r‖s, o None si el valor no es la codificación canónica de 64 bytes."""
    if not isinstance(valor, str) or not valor.startswith("z") or any(c not in ALFABETO_B58 for c in valor[1:]):
        return None
    n = 0
    for c in valor[1:]:
        n = n * 58 + ALFABETO_B58.index(c)
    if n >= 1 << 512:
        return None
    firma = n.to_bytes(64, "big")
    return firma if codificar_prueba(firma) == valor else None


def es_low_s(firma: bytes) -> bool:
    s = int.from_bytes(firma[32:], "big")
    return 0 < s <= N // 2


def firmar(sk: SigningKey, datos: bytes) -> str:
    """ECDSA secp256k1 determinística (RFC 6979) sobre SHA-256(datos), normalizada a low-S."""
    firma = sk.sign_deterministic(datos, hashfunc=hashlib.sha256, sigencode=sigencode_string)
    r, s = int.from_bytes(firma[:32], "big"), int.from_bytes(firma[32:], "big")
    if s > N // 2:
        s = N - s
    return codificar_prueba(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def datos_a_firmar(doc_sin_prueba: dict, config: dict) -> bytes:
    """SHA-256(JCS(config de la prueba)) ‖ SHA-256(JCS(documento sin proof)) — 64 bytes."""
    return sha256(jcs(config)) + sha256(jcs(doc_sin_prueba))


def config_de_prueba(doc: dict, prueba: dict) -> dict:
    config = {k: v for k, v in prueba.items() if k != "proofValue"}
    config["@context"] = doc["@context"]
    return config


def agregar_prueba(doc: dict, sk: SigningKey, metodo: str, proposito: str, creado: str) -> dict:
    prueba = {
        "type": "DataIntegrityProof",
        "cryptosuite": CRYPTOSUITE,
        "verificationMethod": metodo,
        "proofPurpose": proposito,
        "created": creado,
    }
    prueba["proofValue"] = firmar(sk, datos_a_firmar(doc, config_de_prueba(doc, prueba)))
    return {**doc, "proof": prueba}


# ---- verificación (lo que haría un verificador independiente) --------------------
def metodo_en_documento(doc_did: dict, metodo_id: str):
    for m in doc_did["verificationMethod"]:
        if m["id"] == metodo_id:
            return m
    return None


def firma_valida(metodo: dict, valor: str, datos: bytes) -> bool:
    """Valida una firma contra un método de verificación (§7.2.2): directa con
    publicKeyHex, o por recuperación con blockchainAccountId. Rechaza high-S."""
    firma = decodificar_prueba(valor)
    if firma is None or not es_low_s(firma):
        return False
    if "publicKeyHex" in metodo:
        vk = VerifyingKey.from_string(bytes.fromhex(metodo["publicKeyHex"][4:]), curve=SECP256k1)
        try:
            return vk.verify(firma, datos, hashfunc=hashlib.sha256, sigdecode=sigdecode_string)
        except BadSignatureError:
            return False
    cuenta = metodo["blockchainAccountId"].split(":")[-1].lower()
    candidatas = VerifyingKey.from_public_key_recovery(
        firma, datos, SECP256k1, hashfunc=hashlib.sha256, sigdecode=sigdecode_string)
    return any(identificador(c, "eth") == cuenta for c in candidatas)


def prueba_valida(doc: dict, doc_did_firmante: dict, proposito: str) -> bool:
    prueba = doc["proof"]
    metodo_id = prueba["verificationMethod"]
    if prueba.get("cryptosuite") != CRYPTOSUITE or prueba.get("proofPurpose") != proposito:
        return False
    if not metodo_id.startswith(doc_did_firmante["id"] + "#"):
        return False  # el método DEBE pertenecer al DID firmante
    if metodo_id not in doc_did_firmante.get(proposito, []):
        return False
    metodo = metodo_en_documento(doc_did_firmante, metodo_id)
    if metodo is None:
        return False
    sin_prueba = {k: v for k, v in doc.items() if k != "proof"}
    return firma_valida(metodo, prueba["proofValue"], datos_a_firmar(sin_prueba, config_de_prueba(sin_prueba, prueba)))


# ---- documentos --------------------------------------------------------------------
def documento_did_eth(vk: VerifyingKey) -> dict:
    """Documento por defecto en red eth: sin cambios en ERC-1056, dueño = la propia dirección."""
    d = did(vk, "eth")
    return {
        "@context": [CTX_DID, CTX_SECP_REC, CTX_E24],
        "id": d,
        "controller": d,
        "verificationMethod": [{
            "id": f"{d}#raiz",
            "type": "EcdsaSecp256k1RecoveryMethod2020",
            "controller": d,
            "blockchainAccountId": f"eip155:{CHAIN_ID}:{identificador(vk, 'eth')}",
        }],
        "authentication": [f"{d}#raiz"],
        "assertionMethod": [f"{d}#raiz"],
        "e24": {"protocol": PROTOCOLO, "network": "eth", "resolverVersion": RESOLVER_VERSION, "estado": "activo"},
    }


def lista_confianza(issuer: str, emisores: list, reconoce: list) -> dict:
    return {
        "@context": [CTX_VC, CTX_E24],
        "type": ["VerifiableCredential", "ListaConfianzaE24"],
        "issuer": issuer,
        "validFrom": TS_EMISION,
        "validUntil": TS_HASTA,
        "credentialSubject": {"version": 1, "emisores": emisores, "reconoceListas": reconoce},
    }


def reconocimiento(raices: list, listas: dict, docs: dict, emisor: str, tipo: str,
                   ahora: int, profundidad_max: int = 1):
    """§7.4: recorre listas desde las raíces elegidas por el verificador.
    Devuelve la cadena de URLs que reconoce al emisor, o None."""
    visitadas = set()
    frontera = [(url, [url]) for url in raices]
    for profundidad in range(profundidad_max + 1):
        siguiente = []
        for url, cadena in frontera:
            if url in visitadas or url not in listas:
                continue
            visitadas.add(url)
            lista = listas[url]
            doc_emisor_lista = docs.get(lista["issuer"])
            if doc_emisor_lista is None or not prueba_valida(lista, doc_emisor_lista, "assertionMethod"):
                continue
            if not (unix(lista["validFrom"]) <= ahora < unix(lista["validUntil"])):
                continue
            for e in lista["credentialSubject"]["emisores"]:
                if e["id"] == emisor and tipo in e["tipos"]:
                    return cadena
            for r in lista["credentialSubject"]["reconoceListas"]:
                siguiente.append((r["url"], cadena + [r["url"]]))
        frontera = siguiente
    return None


# ---- 1 · claves y DIDs -----------------------------------------------------------------
sk = {rol: clave_desde_semilla(s) for rol, s in SEMILLAS.items()}
vk = {rol: k.get_verifying_key() for rol, k in sk.items()}
dids = {rol: did(vk[rol], "eth") for rol in sk}
docs_did = {dids[rol]: documento_did_eth(vk[rol]) for rol in sk}

# ---- 2 · CedulaE24 -----------------------------------------------------------------------
cedula_sin_prueba = {
    "@context": [CTX_VC, CTX_E24],
    "type": ["VerifiableCredential", "CedulaE24"],
    "issuer": dids["emisor"],
    "validFrom": TS_EMISION,
    "perfilEmisor": URL_PERFIL,
    "credentialSubject": {
        "id": dids["titular"],
        "numero": "PRUEBA-0001",
        "categoria": "Diaspora",
    },
}
cedula = agregar_prueba(cedula_sin_prueba, sk["emisor"], f"{dids['emisor']}#raiz", "assertionMethod", TS_EMISION)
config_cedula = config_de_prueba(cedula_sin_prueba, cedula["proof"])
datos_cedula = datos_a_firmar(cedula_sin_prueba, config_cedula)
hash_ancla = sha256(jcs(cedula)).hex()

ancla_esperada = {
    "hash": "0x" + hash_ancla,
    "issuer": identificador(vk["emisor"], "eth"),
    "anchoredAt": unix(TS_EMISION),
    "revoked": False,
}

# ---- 3 · reto de presentación -------------------------------------------------------------
reto_sin_prueba = {
    "@context": [CTX_VC, CTX_E24],
    "type": "RetoE24",
    "titular": dids["titular"],
    "nonce": sha256(b"E24-RFC-0001-TV1-NONCE").hex()[:32],
    "dominio": DOMINIO_VERIFICADOR,
    "creadoEn": TS_RETO,
}
reto = agregar_prueba(reto_sin_prueba, sk["titular"], f"{dids['titular']}#raiz", "authentication", TS_RETO)

# ---- 4 · listas de confianza ------------------------------------------------------------------
lista_a = agregar_prueba(
    lista_confianza(dids["instanciaA"], [{
        "id": dids["emisor"],
        "tipos": ["CedulaE24"],
        "prefijoAlias": "PRUEBA",
        "perfil": URL_PERFIL,
        "desde": TS_EMISION,
    }], []),
    sk["instanciaA"], f"{dids['instanciaA']}#raiz", "assertionMethod", TS_EMISION)
lista_b = agregar_prueba(
    lista_confianza(dids["instanciaB"], [], [{"url": URL_LISTA_A, "issuer": dids["instanciaA"]}]),
    sk["instanciaB"], f"{dids['instanciaB']}#raiz", "assertionMethod", TS_EMISION)
listas = {URL_LISTA_A: lista_a, URL_LISTA_B: lista_b}

# ---- 5 · verificación positiva (asserts) ---------------------------------------------------------
ahora = unix(TS_VERIFICACION)
assert prueba_valida(cedula, docs_did[dids["emisor"]], "assertionMethod"), "FALLO: firma de la cédula"
assert prueba_valida(reto, docs_did[dids["titular"]], "authentication"), "FALLO: firma del reto"
assert cedula["credentialSubject"]["id"] == reto["titular"], "FALLO: sujeto ≠ titular del reto"

casos_reconocimiento = [
    {"raices": [URL_LISTA_A], "profundidadMax": 1},
    {"raices": [URL_LISTA_B], "profundidadMax": 1},
    {"raices": [URL_LISTA_B], "profundidadMax": 0},
    {"raices": [], "profundidadMax": 1},
]
for caso in casos_reconocimiento:
    cadena = reconocimiento(caso["raices"], listas, docs_did, dids["emisor"], "CedulaE24", ahora, caso["profundidadMax"])
    caso["esperado"] = {"reconocido": cadena is not None, "cadena": cadena or []}
assert casos_reconocimiento[0]["esperado"]["cadena"] == [URL_LISTA_A]
assert casos_reconocimiento[1]["esperado"]["cadena"] == [URL_LISTA_B, URL_LISTA_A]
assert not casos_reconocimiento[2]["esperado"]["reconocido"]
assert not casos_reconocimiento[3]["esperado"]["reconocido"]

# ---- 6 · tests negativos ejecutables --------------------------------------------------------------
negativos = []

# 6.1 un carácter alterado en el contenido
rota = json.loads(jcs(cedula).decode("utf-8"))
rota["credentialSubject"]["numero"] = "PRUEBA-0002"
assert not prueba_valida(rota, docs_did[dids["emisor"]], "assertionMethod")
hash_rota = sha256(jcs(rota)).hex()
assert hash_rota != hash_ancla
negativos.append({
    "caso": "contenido alterado",
    "alteracion": {"campo": "credentialSubject.numero", "de": "PRUEBA-0001", "a": "PRUEBA-0002"},
    "hashAlterado": hash_rota,
    "esperado": "firma INVÁLIDA (chequeo 2) y hash no anclado (chequeo 3)",
})

# 6.2 firma high-S: matemáticamente válida, pero NO canónica → DEBE rechazarse
firma = decodificar_prueba(cedula["proof"]["proofValue"])
r, s = firma[:32], int.from_bytes(firma[32:], "big")
firma_high_s = r + (N - s).to_bytes(32, "big")
cedula_high_s = {**cedula, "proof": {**cedula["proof"], "proofValue": codificar_prueba(firma_high_s)}}
vk_emisor = vk["emisor"]
assert vk_emisor.verify(firma_high_s, datos_cedula, hashfunc=hashlib.sha256, sigdecode=sigdecode_string)
assert not prueba_valida(cedula_high_s, docs_did[dids["emisor"]], "assertionMethod")
negativos.append({
    "caso": "firma high-S",
    "proofValueAlterado": codificar_prueba(firma_high_s),
    "esperado": "RECHAZADA aunque ECDSA la acepte: E24-V1 exige low-S (s ≤ n/2)",
})

# 6.2b la misma firma en hex, sin multibase: Data Integrity exige multibase
cedula_hex = {**cedula, "proof": {**cedula["proof"], "proofValue": firma.hex()}}
assert not prueba_valida(cedula_hex, docs_did[dids["emisor"]], "assertionMethod")
negativos.append({
    "caso": "proofValue sin multibase",
    "proofValueAlterado": firma.hex(),
    "esperado": "RECHAZADA: proofValue DEBE ser multibase base58btc canónico",
})

# 6.3 método de verificación sustituido por uno de otro DID
cedula_otro_metodo = {**cedula, "proof": {**cedula["proof"], "verificationMethod": f"{dids['titular']}#raiz"}}
assert not prueba_valida(cedula_otro_metodo, docs_did[dids["emisor"]], "assertionMethod")
assert not prueba_valida(cedula_otro_metodo, docs_did[dids["titular"]], "assertionMethod")
negativos.append({
    "caso": "método de verificación sustituido",
    "verificationMethodAlterado": f"{dids['titular']}#raiz",
    "esperado": "RECHAZADA: el método no pertenece al issuer y la configuración de la prueba está firmada",
})

# 6.4 metadatos de la prueba alterados (la configuración también se firma)
cedula_otra_fecha = {**cedula, "proof": {**cedula["proof"], "created": "2026-11-01T00:00:01Z"}}
assert not prueba_valida(cedula_otra_fecha, docs_did[dids["emisor"]], "assertionMethod")
negativos.append({
    "caso": "metadatos de la prueba alterados",
    "alteracion": {"campo": "proof.created", "de": TS_EMISION, "a": "2026-11-01T00:00:01Z"},
    "esperado": "RECHAZADA: SHA-256(JCS(config)) forma parte de lo firmado",
})

# ---- 7 · vector completo -----------------------------------------------------------------------------
contexto_bytes = CONTEXTO_LOCAL.read_bytes()
vector = {
    "_meta": {
        "vector": "E24-RFC-0001 · Conformance Test Vector #1",
        "vectorVersion": "1.1",
        "rfcVersion": "0.5.3",
        "licencia": "Apache-2.0 · © 2026 Ethereal Realms Consciousness LLC y contribuidores",
        "descargo": "SIMULACIÓN EDUCATIVA · claves de PRUEBA derivadas de semillas públicas · sin datos personales · sin validez jurídica",
        "reproducibilidad": "Determinístico: mismas semillas → mismos bytes. ECDSA RFC 6979 + normalización low-S.",
        "canonicalizacion": "JCS (RFC 8785)",
    },
    "contexto": {
        "url": CTX_E24,
        "sha256": hashlib.sha256(contexto_bytes).hexdigest(),
        "archivo": "estado24/ns/e24/v1/context.jsonld",
    },
    "semillas": {**SEMILLAS, "derivacion": "clave privada = SHA-256(semilla) como escalar secp256k1"},
    "claves": {
        rol: {
            "privateKeyHex": sk[rol].to_string().hex(),
            "publicKeyHex": "0x04" + vk[rol].to_string().hex(),
            "ethAddress": identificador(vk[rol], "eth"),
            "didEth": did(vk[rol], "eth"),
            "didSim": did(vk[rol], "sim"),
        } for rol in sk
    },
    "documentosDid": {rol: docs_did[dids[rol]] for rol in sk},
    "cedula": {
        "credencial": cedula,
        "intermedios": {
            "jcsConfigPrueba": jcs(config_cedula).decode("utf-8"),
            "sha256ConfigPrueba": sha256(jcs(config_cedula)).hex(),
            "sha256DocumentoSinPrueba": sha256(jcs(cedula_sin_prueba)).hex(),
            "datosFirmados": datos_cedula.hex(),
        },
        "hashAncla": hash_ancla,
    },
    "anclaEsperada": ancla_esperada,
    "reto": reto,
    "listasConfianza": listas,
    "verificacion": {
        "momento": TS_VERIFICACION,
        "chequeos": {
            "1_retoFirmadoPorTitular": True,
            "2_firmaDelEmisor": True,
            "3_anclada": "requiere anclaEsperada en E24AnchorRegistry",
            "4_sujetoEsTitular": True,
        },
        "reconocimiento": casos_reconocimiento,
    },
    "testsNegativos": negativos,
    "checks": [
        "1. Derivar claves desde semillas → publicKeyHex, ethAddress, didEth y didSim exactos",
        "2. Construir el documento DID por defecto de cada rol → igual a documentosDid",
        "3. Reconstruir datosFirmados de la cédula (JCS + SHA-256) → igual a intermedios.datosFirmados",
        "4. Verificar la cédula por recuperación con blockchainAccountId del emisor → válida",
        "5. SHA-256(JCS(cédula con proof)) → igual a hashAncla",
        "6. Verificar el reto con el documento del titular (proofPurpose authentication) → válido",
        "7. Evaluar cada caso de reconocimiento → igual a 'esperado'",
        "8. Reproducir cada test negativo → rechazado",
        "9. SHA-256 del contexto local → igual a contexto.sha256",
    ],
}

with open(SALIDA, "w", encoding="utf-8", newline="\n") as f:
    json.dump(vector, f, ensure_ascii=False, indent=2)
    f.write("\n")

print("did titular (eth) :", dids["titular"])
print("did titular (sim) :", did(vk["titular"], "sim"))
print("did emisor  (eth) :", dids["emisor"])
print("hash ancla        :", hash_ancla)
print("contexto sha256   :", vector["contexto"]["sha256"])
print("reconocimiento    :", [c["esperado"]["reconocido"] for c in casos_reconocimiento])
print("negativos         : ✅", len(negativos), "rechazados")
print("→", SALIDA.name, "escrito (vectorVersion 1.1)")
