#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ethereal Realms Consciousness LLC y contribuidores
"""
================================================================================
  E24-V1-SIM  ·  Simulación de referencia del protocolo E24-V1 (E24-RFC-0001)
================================================================================

  ⚠  SIMULACIÓN EDUCATIVA · LABORATORIO DE I+D  ⚠
  ---------------------------------------------------------------------------
  Este programa NO emite identidades legales. Toda la "cadena" es un ledger
  local en memoria que imita ERC-1056, E24AnchorRegistry y E24Recovery. Las
  comunidades, emisores y personas son ficticios. Las claves salen de semillas
  públicas, así que cada ejecución produce exactamente los mismos artefactos.
  Sin validez jurídica.
  ---------------------------------------------------------------------------

Recorrido:

  0. Conformidad: esta implementación (independiente del generador) reproduce
     el test vector #1.
  1. Génesis del titular (sin registro, sin gas).
  2. Comunidad A: cuenta multifirma 2-de-3 que autoriza un delegado de firma.
  3. Listas de confianza de A y B (B reconoce la lista de A).
  4. A emite una CedulaE24; el relayer paga el anclaje.
  5. Emisión abierta: un emisor C cualquiera también emite.
  6. Verificación con distintas listas: validez y reconocimiento por separado.
  7. Relayer malicioso: no puede alterar una operación firmada.
  8. Rotación de custodia: las credenciales viejas siguen valiendo.
  9. Tampering: contenido alterado y firma high-S.
 10. Revocación de una credencial por su emisor.
 11. Suspensión reversible por el titular.
 12. Recuperación social: robo de clave, guardianes, timelock y veto.
 13. Privacidad: ningún dato personal ni el titular en las anclas.
 14. Costo: el titular no pagó gas.
"""

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from Crypto.Hash import keccak
from ecdsa import SigningKey, VerifyingKey, SECP256k1, BadSignatureError
from ecdsa.util import sigencode_string, sigdecode_string

AQUI = Path(__file__).resolve().parent
ART = AQUI / "artifacts"
VECTOR = AQUI.parent / "rfc" / "E24-RFC-0001-test-vector-1.json"
CONTEXTO_LOCAL = AQUI.parent / "ns" / "e24" / "v1" / "context.jsonld"

CTX_DID = "https://www.w3.org/ns/did/v1"
CTX_VC = "https://www.w3.org/ns/credentials/v2"
CTX_E24 = "https://estado24.com/ns/e24/v1"
CTX_SECP_2019 = "https://w3id.org/security/suites/secp256k1-2019/v1"
CTX_SECP_REC = "https://w3id.org/security/suites/secp256k1recovery-2020/v2"
CTX_PERFIL_A = "https://comunidad-a.example/ns/cedula/v1"
CRYPTOSUITE = "ecdsa-secp256k1-jcs-e24-2026"
PROTOCOLO = "E24-V1"
RED = "sim"
CHAIN_ID = 84532
RESOLVER_VERSION = 1
N = SECP256k1.order
CERO = "0x" + "00" * 20
VIGENCIA_LARGA = 10 * 365 * 86400
UN_ANIO = 365 * 86400
TIMELOCK = 72 * 3600
FRESCURA_RETO = 300
DESCARGO = "SIMULACIÓN EDUCATIVA · red sim · claves de prueba · personas y comunidades ficticias · sin validez jurídica"


class Rechazo(Exception):
    """Una operación que el contrato o el verificador DEBE rechazar."""


# ---------------------------------------------------------------------------
# Primitivas
# ---------------------------------------------------------------------------
def canon(obj) -> bytes:
    """JCS (RFC 8785) para el subconjunto de E24-V1 (sin punto flotante)."""
    if isinstance(obj, bool) or obj is None:
        return {True: b"true", False: b"false", None: b"null"}[obj]
    if isinstance(obj, int):
        return str(obj).encode()
    if isinstance(obj, str):
        return json.dumps(obj, ensure_ascii=False).encode("utf-8")
    if isinstance(obj, list):
        return b"[" + b",".join(canon(x) for x in obj) + b"]"
    if isinstance(obj, dict):
        orden = sorted(obj, key=lambda k: k.encode("utf-16-be"))
        return b"{" + b",".join(canon(k) + b":" + canon(obj[k]) for k in orden) + b"}"
    raise TypeError(f"JCS: tipo no soportado en E24-V1: {type(obj).__name__}")


def sha(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def clave(semilla: str) -> SigningKey:
    return SigningKey.from_string(sha(semilla.encode("utf-8")), curve=SECP256k1)


def ident(vk: VerifyingKey, red: str = RED) -> str:
    xy = vk.to_string()
    if red == "eth":
        k = keccak.new(digest_bits=256)
        k.update(xy)
        return "0x" + k.digest()[12:].hex()
    return "0x" + sha(xy).hex()[:40]


def id_contrato(etiqueta: str) -> str:
    """Dirección simulada de un contrato (no deriva de ninguna clave)."""
    return "0x" + sha(("contrato:" + etiqueta).encode("utf-8")).hex()[:40]


def did_de(identificador: str, red: str = RED) -> str:
    return f"did:e24:{red}:{identificador}"


def id_de_did(d: str) -> str:
    return d.rsplit(":", 1)[-1]


def unix(ts: str) -> int:
    return int(datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def iso(t: int) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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


def firmar(sk: SigningKey, datos: bytes) -> str:
    firma = sk.sign_deterministic(datos, hashfunc=hashlib.sha256, sigencode=sigencode_string)
    s = int.from_bytes(firma[32:], "big")
    if s > N // 2:
        s = N - s
    return codificar_prueba(firma[:32] + s.to_bytes(32, "big"))


def _bytes_firma(valor: str):
    firma = decodificar_prueba(valor)
    if firma is None:
        return None
    s = int.from_bytes(firma[32:], "big")
    return firma if 0 < s <= N // 2 else None  # low-S obligatorio


def firma_de_cuenta(valor: str, datos: bytes, cuenta: str, red: str) -> bool:
    firma = _bytes_firma(valor)
    if firma is None:
        return False
    candidatas = VerifyingKey.from_public_key_recovery(
        firma, datos, SECP256k1, hashfunc=hashlib.sha256, sigdecode=sigdecode_string)
    return any(ident(c, red) == cuenta.lower() for c in candidatas)


def firma_de_clave(valor: str, datos: bytes, public_key_hex: str) -> bool:
    firma = _bytes_firma(valor)
    if firma is None:
        return False
    vk = VerifyingKey.from_string(bytes.fromhex(public_key_hex[4:]), curve=SECP256k1)
    try:
        return vk.verify(firma, datos, hashfunc=hashlib.sha256, sigdecode=sigdecode_string)
    except BadSignatureError:
        return False


# ---------------------------------------------------------------------------
# Cryptosuite ecdsa-secp256k1-jcs-e24-2026 (§7.2.2)
# ---------------------------------------------------------------------------
def config_prueba(doc_sin_prueba: dict, prueba: dict) -> dict:
    config = {k: v for k, v in prueba.items() if k != "proofValue"}
    config["@context"] = doc_sin_prueba["@context"]
    return config


def datos_prueba(doc_sin_prueba: dict, config: dict) -> bytes:
    return sha(canon(config)) + sha(canon(doc_sin_prueba))


def con_prueba(doc: dict, sk: SigningKey, metodo: str, proposito: str, creado: str) -> dict:
    prueba = {"type": "DataIntegrityProof", "cryptosuite": CRYPTOSUITE,
              "verificationMethod": metodo, "proofPurpose": proposito, "created": creado}
    prueba["proofValue"] = firmar(sk, datos_prueba(doc, config_prueba(doc, prueba)))
    return {**doc, "proof": prueba}


def metodo_firma(metodo: dict, firma_hex: str, datos: bytes) -> bool:
    if "publicKeyHex" in metodo:
        return firma_de_clave(firma_hex, datos, metodo["publicKeyHex"])
    espacio, *_, cuenta = metodo["blockchainAccountId"].split(":")
    red = {"eip155": "eth", "e24sim": "sim"}.get(espacio)
    return red is not None and firma_de_cuenta(firma_hex, datos, cuenta, red)


def prueba_valida(doc: dict, doc_did: dict, proposito: str) -> bool:
    prueba = doc.get("proof", {})
    metodo_id = prueba.get("verificationMethod", "")
    if prueba.get("cryptosuite") != CRYPTOSUITE or prueba.get("proofPurpose") != proposito:
        return False
    if not metodo_id.startswith(doc_did["id"] + "#") or metodo_id not in doc_did.get(proposito, []):
        return False
    metodo = next((m for m in doc_did["verificationMethod"] if m["id"] == metodo_id), None)
    if metodo is None:
        return False
    sin_prueba = {k: v for k, v in doc.items() if k != "proof"}
    return metodo_firma(metodo, prueba.get("proofValue", ""), datos_prueba(sin_prueba, config_prueba(sin_prueba, prueba)))


# ---------------------------------------------------------------------------
# Cadena simulada: ERC-1056 + E24AnchorRegistry + relayer
# ---------------------------------------------------------------------------
class Cadena:
    def __init__(self, inicio: str):
        self.t = unix(inicio)
        self.eventos = []
        self.gas = {}          # pagador → número de operaciones pagadas
        self.nonces = {}       # firmante → nonce de operaciones firmadas
        self.pubs = {}         # sim: claves públicas registradas en la génesis (§6.4)
        self.erc = ERC1056(self)
        self.anclas = AnchorRegistry(self)

    def avanzar(self, segundos: int):
        self.t += segundos

    def emitir(self, contrato: str, evento: str, **datos):
        self.eventos.append({"t": self.t, "contrato": contrato, "evento": evento, **datos})

    def registrar_genesis(self, vk: VerifyingKey) -> str:
        """Solo red sim: el ledger guarda la clave pública (no cuesta gas, no es una transacción)."""
        i = ident(vk)
        self.pubs[i] = "0x04" + vk.to_string().hex()
        return i

    def llamar(self, remitente: str, contrato: str, fn: str, args: dict, pagador: str):
        destino = {"ERC1056": self.erc, "E24AnchorRegistry": self.anclas}[contrato]
        resultado = getattr(destino, fn)(remitente, **args)
        self.gas[pagador] = self.gas.get(pagador, 0) + 1
        return resultado

    def operacion(self, sk: SigningKey, contrato: str, fn: str, **args):
        """Operación firmada fuera de cadena (equivalente a las funciones …Signed)."""
        firmante = ident(sk.get_verifying_key())
        op = {"contrato": contrato, "fn": fn, "args": args, "firmante": firmante,
              "nonce": self.nonces.get(firmante, 0)}
        return op, firmar(sk, canon(op))

    def enviar(self, op: dict, firma: str, pagador: str):
        """Lo que hace un relayer: enviar y pagar. No puede alterar nada."""
        if not firma_de_cuenta(firma, canon(op), op["firmante"], RED):
            raise Rechazo("firma de la operación inválida (¿alterada por el relayer?)")
        if op["nonce"] != self.nonces.get(op["firmante"], 0):
            raise Rechazo("nonce inválido (repetición)")
        self.nonces[op["firmante"]] = op["nonce"] + 1
        return self.llamar(op["firmante"], op["contrato"], op["fn"], op["args"], pagador)


class ERC1056:
    """Imitación de EthereumDIDRegistry: el estado se reconstruye desde eventos."""
    NOMBRE = "ERC1056"

    def __init__(self, c: Cadena):
        self.c = c

    def _eventos(self, evento: str, identity: str, en: int):
        for e in self.c.eventos:
            if e["t"] > en:
                break
            if e["contrato"] == self.NOMBRE and e["evento"] == evento and e["identity"] == identity:
                yield e

    def identityOwner(self, identity: str, en: int = None) -> str:
        dueno = identity
        for e in self._eventos("DIDOwnerChanged", identity, self.c.t if en is None else en):
            dueno = e["owner"]
        return dueno

    def _solo_dueno(self, remitente: str, identity: str):
        if remitente != self.identityOwner(identity):
            raise Rechazo(f"{remitente} no es el dueño de {identity}")

    def changeOwner(self, remitente, identity, newOwner):
        self._solo_dueno(remitente, identity)
        self.c.emitir(self.NOMBRE, "DIDOwnerChanged", identity=identity, owner=newOwner)

    def addDelegate(self, remitente, identity, delegateType, delegate, validity):
        self._solo_dueno(remitente, identity)
        self.c.emitir(self.NOMBRE, "DIDDelegateChanged", identity=identity, delegateType=delegateType,
                      delegate=delegate, validTo=self.c.t + validity)

    def revokeDelegate(self, remitente, identity, delegateType, delegate):
        self._solo_dueno(remitente, identity)
        self.c.emitir(self.NOMBRE, "DIDDelegateChanged", identity=identity, delegateType=delegateType,
                      delegate=delegate, validTo=self.c.t)

    def setAttribute(self, remitente, identity, name, value, validity):
        self._solo_dueno(remitente, identity)
        self.c.emitir(self.NOMBRE, "DIDAttributeChanged", identity=identity, name=name, value=value,
                      validTo=self.c.t + validity)

    def revokeAttribute(self, remitente, identity, name, value):
        self._solo_dueno(remitente, identity)
        self.c.emitir(self.NOMBRE, "DIDAttributeChanged", identity=identity, name=name, value=value, validTo=0)

    def validDelegate(self, identity, delegateType, delegate, en: int = None) -> bool:
        en = self.c.t if en is None else en
        vence = 0
        for e in self._eventos("DIDDelegateChanged", identity, en):
            if e["delegateType"] == delegateType and e["delegate"] == delegate:
                vence = e["validTo"]
        return vence > en

    def delegados(self, identity, en: int = None):
        en = self.c.t if en is None else en
        vistos = []
        for e in self._eventos("DIDDelegateChanged", identity, en):
            par = (e["delegateType"], e["delegate"])
            if par not in vistos:
                vistos.append(par)
        return [p for p in vistos if self.validDelegate(identity, p[0], p[1], en)]

    def atributos(self, identity, en: int = None):
        en = self.c.t if en is None else en
        vence = {}
        for e in self._eventos("DIDAttributeChanged", identity, en):
            vence[(e["name"], e["value"])] = e["validTo"]
        return [par for par, v in vence.items() if v > en]

    def ultimo_cambio(self, identity, en: int = None):
        en = self.c.t if en is None else en
        ts = [e["t"] for e in self.c.eventos if e["t"] <= en and e["contrato"] == self.NOMBRE and e["identity"] == identity]
        return max(ts) if ts else None


class AnchorRegistry:
    """E24AnchorRegistry (§7.5): sin administrador, sin titular en cadena."""
    NOMBRE = "E24AnchorRegistry"

    def __init__(self, c: Cadena):
        self.c = c
        self.anclas = {}

    def _autorizado(self, remitente, issuer) -> bool:
        return remitente == self.c.erc.identityOwner(issuer) or self.c.erc.validDelegate(issuer, "veriKey", remitente)

    def anchorCredential(self, remitente, issuer, hash):
        if not self._autorizado(remitente, issuer):
            raise Rechazo(f"{remitente} no puede anclar en nombre de {issuer}")
        if hash in self.anclas:
            raise Rechazo("hash ya anclado")
        self.anclas[hash] = {"issuer": issuer, "anchoredAt": self.c.t, "revoked": False}
        self.c.emitir(self.NOMBRE, "CredentialAnchored", hash=hash, issuer=issuer, sender=remitente)

    def revokeCredential(self, remitente, hash):
        ancla = self.anclas.get(hash)
        if ancla is None:
            raise Rechazo("hash no anclado")
        if not self._autorizado(remitente, ancla["issuer"]):
            raise Rechazo(f"{remitente} no puede revocar anclas de {ancla['issuer']}")
        ancla["revoked"] = True
        self.c.emitir(self.NOMBRE, "CredentialRevoked", hash=hash, issuer=ancla["issuer"], sender=remitente)


# ---------------------------------------------------------------------------
# Cuentas de contrato: multifirma y E24Recovery
# ---------------------------------------------------------------------------
class Multisig:
    """Cuenta de contrato k-de-n (imitación mínima de un Gnosis Safe)."""

    def __init__(self, c: Cadena, etiqueta: str, firmantes: list, umbral: int):
        self.c = c
        self.id = id_contrato(etiqueta)
        self.firmantes = {ident(sk.get_verifying_key()) for sk in firmantes}
        self.umbral = umbral
        self.nonce = 0

    def ejecutar(self, sks: list, contrato: str, fn: str, pagador: str, **args):
        propuesta = canon({"multisig": self.id, "contrato": contrato, "fn": fn, "args": args, "nonce": self.nonce})
        aprobaciones = set()
        for sk in sks:
            firmante = ident(sk.get_verifying_key())
            if firmante in self.firmantes and firma_de_cuenta(firmar(sk, propuesta), propuesta, firmante, RED):
                aprobaciones.add(firmante)
        if len(aprobaciones) < self.umbral:
            raise Rechazo(f"multifirma: {len(aprobaciones)} de {self.umbral} firmas requeridas")
        self.nonce += 1
        return self.c.llamar(self.id, contrato, fn, args, pagador)


class Recuperacion:
    """E24Recovery (§6.7): dueño de la identidad en ERC-1056, obedece a la clave
    activa y permite a los guardianes reemplazarla con k-de-n + timelock."""
    NOMBRE = "E24Recovery"

    def __init__(self, c: Cadena, identity: str, clave_activa: str, guardianes: dict, k: int,
                 organizaciones_emisoras: set):
        n = len(guardianes)
        if not 3 <= n <= 5:
            raise Rechazo("se requieren entre 3 y 5 guardianes")
        if not k > n / 2:
            raise Rechazo("k debe ser mayoría estricta")
        orgs = [o for o in guardianes.values() if o is not None]
        if len(orgs) != len(set(orgs)):
            raise Rechazo("diversidad: una organización controla más de un guardián")
        if sum(1 for o in orgs if o in organizaciones_emisoras) >= k:
            raise Rechazo("diversidad: los emisores del titular sumarían k guardianes")
        self.c = c
        self.id = id_contrato("recovery:" + identity)
        self.identity = identity
        self.clave_activa = clave_activa
        self.guardianes = set(guardianes)
        self.k = k
        self.pendiente = None
        self.retiro = None
        self.registros = []  # lo que la clave activa agregó vía operar(); se revoca al recuperar
        # nonces separados: un ladrón con la clave activa no invalida las firmas de los guardianes
        self.nonce_op = 0
        self.nonce_guardianes = 0

    def _firmantes(self, sks: list, accion: dict, permitidos: set, nonce: int) -> set:
        datos = canon({"recovery": self.id, **accion, "nonce": nonce})
        ids = set()
        for sk in sks:
            firmante = ident(sk.get_verifying_key())
            if firmante in permitidos and firma_de_cuenta(firmar(sk, datos), datos, firmante, RED):
                ids.add(firmante)
        return ids

    def _erc(self, fn: str, pagador: str, **args):
        return self.c.llamar(self.id, "ERC1056", fn, {"identity": self.identity, **args}, pagador)

    def activar(self, pagador: str):
        """Tras changeOwner(identity → este contrato): la clave activa queda como delegado."""
        for tipo in ("sigAuth", "veriKey"):
            self._erc("addDelegate", pagador, delegateType=tipo, delegate=self.clave_activa, validity=VIGENCIA_LARGA)

    def operar(self, sk_activa: SigningKey, fn: str, pagador: str, **args):
        """Operaciones normales: inmediatas si las firma la clave activa."""
        if not self._firmantes([sk_activa], {"accion": "operar", "fn": fn, "args": args}, {self.clave_activa}, self.nonce_op):
            raise Rechazo("solo la clave activa opera la identidad")
        if fn == "changeOwner":
            raise Rechazo("sacar a E24Recovery como dueño debilita la recuperación: requiere timelock")
        if fn not in ("addDelegate", "revokeDelegate", "setAttribute", "revokeAttribute"):
            raise Rechazo(f"operar no permite {fn}")
        registro = (("delegado", args["delegateType"], args["delegate"]) if "Delegate" in fn
                    else ("atributo", args["name"], args["value"]))
        if fn.startswith("revoke"):
            if registro in self.registros:
                self.registros.remove(registro)
        elif registro not in self.registros:
            if len(self.registros) >= 16:
                raise Rechazo("máximo 16 registros")
            self.registros.append(registro)
        self.nonce_op += 1
        return self._erc(fn, pagador, **args)

    def solicitar_retiro(self, sk_activa: SigningKey, nuevo_dueno: str):
        if not self._firmantes([sk_activa], {"accion": "retirar", "nuevoDueno": nuevo_dueno}, {self.clave_activa}, self.nonce_op):
            raise Rechazo("solo la clave activa puede solicitar el retiro")
        self.nonce_op += 1
        self.retiro = {"nuevoDueno": nuevo_dueno, "ejecutableEn": self.c.t + TIMELOCK}
        self.c.emitir(self.NOMBRE, "WeakeningRequested", identity=self.identity, **self.retiro)

    def cancelar_retiro(self, sks_guardianes: list):
        if self.retiro is None:
            raise Rechazo("no hay retiro pendiente")
        if len(self._firmantes(sks_guardianes, {"accion": "cancelarRetiro"}, self.guardianes, self.nonce_guardianes)) < self.k:
            raise Rechazo("cancelar un retiro requiere k guardianes")
        self.nonce_guardianes += 1
        self.retiro = None
        self.c.emitir(self.NOMBRE, "WeakeningCancelled", identity=self.identity)

    def iniciar_recuperacion(self, sks_guardianes: list, nueva_clave: str):
        aprobadores = self._firmantes(sks_guardianes, {"accion": "recuperar", "nuevaClave": nueva_clave},
                                      self.guardianes, self.nonce_guardianes)
        if len(aprobadores) < self.k:
            raise Rechazo(f"recuperación: {len(aprobadores)} de {self.k} guardianes")
        self.nonce_guardianes += 1
        self.pendiente = {"nuevaClave": nueva_clave, "ejecutableEn": self.c.t + TIMELOCK, "aprobadores": aprobadores}
        self.c.emitir(self.NOMBRE, "RecoveryInitiated", identity=self.identity, nuevaClave=nueva_clave,
                      ejecutableEn=self.pendiente["ejecutableEn"])

    def vetar(self, sk_activa: SigningKey, sks_guardianes: list):
        """Veto = clave activa + al menos un guardián que no aprobó la recuperación."""
        if self.pendiente is None:
            raise Rechazo("no hay recuperación pendiente")
        accion = {"accion": "vetar", "nuevaClave": self.pendiente["nuevaClave"]}
        if not self._firmantes([sk_activa], accion, {self.clave_activa}, self.nonce_guardianes):
            raise Rechazo("el veto requiere la clave activa")
        if not self._firmantes(sks_guardianes, accion, self.guardianes - self.pendiente["aprobadores"], self.nonce_guardianes):
            raise Rechazo("el veto requiere además un guardián que no haya aprobado la recuperación")
        self.nonce_guardianes += 1
        self.pendiente = None
        self.c.emitir(self.NOMBRE, "RecoveryCancelled", identity=self.identity)

    def ejecutar_recuperacion(self, pagador: str):
        if self.pendiente is None:
            raise Rechazo("no hay recuperación pendiente")
        if self.c.t < self.pendiente["ejecutableEn"]:
            raise Rechazo("timelock de 72 h aún vigente")
        nueva = self.pendiente["nuevaClave"]
        for clase, clave_reg, valor in self.registros:  # todo lo que agregó la clave anterior
            if clase == "delegado":
                self._erc("revokeDelegate", pagador, delegateType=clave_reg, delegate=valor)
            else:
                self._erc("revokeAttribute", pagador, name=clave_reg, value=valor)
        self.registros = []
        self.retiro = None
        for tipo in ("sigAuth", "veriKey"):
            self._erc("revokeDelegate", pagador, delegateType=tipo, delegate=self.clave_activa)
            self._erc("addDelegate", pagador, delegateType=tipo, delegate=nueva, validity=VIGENCIA_LARGA)
        self.clave_activa = nueva
        self.pendiente = None
        self.c.emitir(self.NOMBRE, "RecoveryExecuted", identity=self.identity, nuevaClave=nueva)


# ---------------------------------------------------------------------------
# Resolver did:e24:sim (§6.4, §6.5)
# ---------------------------------------------------------------------------
def resolver(c: Cadena, d: str, en: int = None) -> dict:
    en = c.t if en is None else en
    i = id_de_did(d)
    dueno = c.erc.identityOwner(i, en)
    doc = {"@context": [CTX_DID, CTX_SECP_2019, CTX_SECP_REC, CTX_E24], "id": d, "controller": d,
           "verificationMethod": [], "authentication": [], "assertionMethod": []}
    metadatos = {"protocol": PROTOCOLO, "network": RED, "resolverVersion": RESOLVER_VERSION}
    if dueno == CERO:
        doc["e24"] = {**metadatos, "estado": "desactivado"}
        return doc
    raiz = {"id": f"{d}#raiz", "controller": d}
    if dueno in c.pubs:
        raiz.update(type="EcdsaSecp256k1VerificationKey2019", publicKeyHex=c.pubs[dueno])
    else:
        raiz.update(type="EcdsaSecp256k1RecoveryMethod2020", blockchainAccountId=f"e24sim:local:{dueno}")
    doc["verificationMethod"].append(raiz)
    doc["authentication"].append(raiz["id"])
    doc["assertionMethod"].append(raiz["id"])
    for tipo, delegado in c.erc.delegados(i, en):
        mid = f"{d}#delegado-{delegado}"
        if all(m["id"] != mid for m in doc["verificationMethod"]):
            doc["verificationMethod"].append({"id": mid, "type": "EcdsaSecp256k1RecoveryMethod2020",
                                              "controller": d, "blockchainAccountId": f"e24sim:local:{delegado}"})
        destinos = ["assertionMethod", "authentication"] if tipo == "sigAuth" else ["assertionMethod"]
        for rel in destinos:
            if mid not in doc[rel]:
                doc[rel].append(mid)
    atributos = c.erc.atributos(i, en)
    servicios = [{"id": f"{d}#lista-confianza", "type": "E24ListaConfianza", "serviceEndpoint": v}
                 for n, v in atributos if n == "did/svc/E24ListaConfianza"]
    if servicios:
        doc["service"] = servicios
    estado = "suspendido" if ("e24/estado", "suspendido") in atributos else "activo"
    doc["e24"] = {**metadatos, "estado": estado}
    actualizado = c.erc.ultimo_cambio(i, en)
    if actualizado is not None:
        doc["e24"]["updatedAt"] = actualizado
    return doc


# ---------------------------------------------------------------------------
# Listas de confianza y verificación (§7.4, §7.6)
# ---------------------------------------------------------------------------
def reconocimiento(web: dict, raices: list, emisor: str, tipo: str, ahora: int,
                   profundidad_max: int, resolver_did) -> list:
    """Devuelve la cadena de listas que reconoce al emisor, o [] si ninguna."""
    if profundidad_max > 2:
        raise Rechazo("E24-V1 no permite profundidad mayor que 2")
    visitadas = set()
    frontera = [(url, [url]) for url in raices]
    for _ in range(profundidad_max + 1):
        siguiente = []
        for url, cadena in frontera:
            if url in visitadas or url not in web:
                continue
            visitadas.add(url)
            lista = web[url]
            if not prueba_valida(lista, resolver_did(lista["issuer"]), "assertionMethod"):
                continue
            if not unix(lista["validFrom"]) <= ahora < unix(lista["validUntil"]):
                continue
            sujeto = lista["credentialSubject"]
            if any(e["id"] == emisor and tipo in e["tipos"] for e in sujeto["emisores"]):
                return cadena
            siguiente += [(r["url"], cadena + [r["url"]]) for r in sujeto["reconoceListas"]]
        frontera = siguiente
    return []


class Verificador:
    def __init__(self, nombre: str, dominio: str, raices: list, profundidad: int = 1):
        self.nombre, self.dominio, self.raices, self.profundidad = nombre, dominio, raices, profundidad
        self.contador = 0

    def nuevo_nonce(self) -> str:
        self.contador += 1
        return sha(f"{self.dominio}:{self.contador}".encode()).hex()[:32]

    def verificar(self, c: Cadena, web: dict, presentacion: dict, nonce: str, nombres: dict) -> dict:
        vc, reto = presentacion["credencial"], presentacion["reto"]
        doc_titular = resolver(c, reto["titular"])
        fresco = abs(c.t - unix(reto["creadoEn"])) <= FRESCURA_RETO
        ch1 = (doc_titular["e24"]["estado"] == "activo" and reto.get("type") == "RetoE24"
               and reto["nonce"] == nonce and reto["dominio"] == self.dominio and fresco
               and prueba_valida(reto, doc_titular, "authentication"))
        ancla = c.anclas.anclas.get(sha(canon(vc)).hex())
        emisor = id_de_did(vc["issuer"])
        ch3 = ancla is not None and not ancla["revoked"] and ancla["issuer"] == emisor
        # §7.6: el método del emisor se evalúa en el momento del anclaje
        doc_emisor = resolver(c, vc["issuer"], ancla["anchoredAt"] if ancla else None)
        ch2 = prueba_valida(vc, doc_emisor, "assertionMethod")
        ch4 = vc["credentialSubject"]["id"] == reto["titular"]
        cadena = reconocimiento(web, self.raices, vc["issuer"], "CedulaE24", c.t, self.profundidad,
                                lambda d: resolver(c, d))
        valida = ch1 and ch2 and ch3 and ch4
        texto = "Credencial " + ("válida" if valida else "INVÁLIDA") + " · "
        if cadena:
            texto += "emisor reconocido por " + ", a quien reconoce ".join(nombres.get(u, u) for u in reversed(cadena))
        else:
            texto += "emisor no reconocido por ninguna de tus listas"
        return {"verificador": self.nombre, "momento": iso(c.t),
                "chequeos": {"1_titular": ch1, "2_firmaEmisor": ch2, "3_anclada": ch3, "4_sujetoEsTitular": ch4},
                "valida": valida, "reconocida": bool(cadena), "cadena": cadena, "resultado": texto}


# ---------------------------------------------------------------------------
# Documentos
# ---------------------------------------------------------------------------
def documento_eth_por_defecto(vk: VerifyingKey) -> dict:
    d = did_de(ident(vk, "eth"), "eth")
    return {
        "@context": [CTX_DID, CTX_SECP_REC, CTX_E24],
        "id": d, "controller": d,
        "verificationMethod": [{"id": f"{d}#raiz", "type": "EcdsaSecp256k1RecoveryMethod2020", "controller": d,
                                "blockchainAccountId": f"eip155:{CHAIN_ID}:{ident(vk, 'eth')}"}],
        "authentication": [f"{d}#raiz"], "assertionMethod": [f"{d}#raiz"],
        "e24": {"protocol": PROTOCOLO, "network": "eth", "resolverVersion": RESOLVER_VERSION, "estado": "activo"},
    }


def lista(issuer: str, version: int, desde: int, emisores: list, reconoce: list) -> dict:
    return {"@context": [CTX_VC, CTX_E24], "type": ["VerifiableCredential", "ListaConfianzaE24"],
            "issuer": issuer, "validFrom": iso(desde), "validUntil": iso(desde + 180 * 86400),
            "credentialSubject": {"version": version, "emisores": emisores, "reconoceListas": reconoce}}


def cedula(issuer: str, titular: str, numero: str, creado: int, contextos_extra=(), datos_perfil=None) -> dict:
    return {"@context": [CTX_VC, CTX_E24, *contextos_extra], "type": ["VerifiableCredential", "CedulaE24"],
            "issuer": issuer, "validFrom": iso(creado), "perfilEmisor": "https://comunidad-a.example/e24/perfil.json",
            "credentialSubject": {"id": titular, "numero": numero, "categoria": "Diaspora", **(datos_perfil or {})}}


def presentar(vc: dict, sk: SigningKey, metodo: str, titular: str, nonce: str, dominio: str, creado: int) -> dict:
    reto = {"@context": [CTX_VC, CTX_E24], "type": "RetoE24", "titular": titular, "nonce": nonce,
            "dominio": dominio, "creadoEn": iso(creado)}
    return {"credencial": vc, "reto": con_prueba(reto, sk, metodo, "authentication", iso(creado))}


# ---------------------------------------------------------------------------
# Salida
# ---------------------------------------------------------------------------
FALLOS = []


def titulo(n, texto):
    print(f"\n── {n}. {texto} " + "─" * max(0, 66 - len(texto)))


def esperar(cond: bool, texto: str):
    print(("  ✅ " if cond else "  ❌ ") + texto)
    if not cond:
        FALLOS.append(texto)


def rechazado(fn, texto: str):
    try:
        fn()
    except Rechazo as e:
        esperar(True, f"{texto} → rechazado: {e}")
        return
    esperar(False, f"{texto} → NO fue rechazado")


def guardar(nombre: str, contenido):
    ART.mkdir(exist_ok=True)
    with open(ART / nombre, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"descargo": DESCARGO, "contenido": contenido}, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------
# 0 · Conformidad contra el test vector #1
# ---------------------------------------------------------------------------
def conformidad():
    titulo(0, "Conformidad con E24-RFC-0001 test vector #1")
    v = json.loads(VECTOR.read_text(encoding="utf-8"))
    esperar(hashlib.sha256(CONTEXTO_LOCAL.read_bytes()).hexdigest() == v["contexto"]["sha256"],
            "contexto v1 local coincide con el hash del vector")
    docs = {}
    for rol, semilla in ((r, s) for r, s in v["semillas"].items() if r != "derivacion"):
        vk = clave(semilla).get_verifying_key()
        esperado = v["claves"][rol]
        esperar("0x04" + vk.to_string().hex() == esperado["publicKeyHex"]
                and ident(vk, "eth") == esperado["ethAddress"]
                and did_de(ident(vk, "sim")) == esperado["didSim"], f"claves y DIDs de '{rol}'")
        doc = documento_eth_por_defecto(vk)
        esperar(doc == v["documentosDid"][rol], f"documento DID por defecto de '{rol}'")
        docs[doc["id"]] = doc
    vc = v["cedula"]["credencial"]
    emisor = docs[vc["issuer"]]
    sin_prueba = {k: x for k, x in vc.items() if k != "proof"}
    esperar(datos_prueba(sin_prueba, config_prueba(sin_prueba, vc["proof"])).hex()
            == v["cedula"]["intermedios"]["datosFirmados"], "datos firmados (JCS + SHA-256)")
    esperar(prueba_valida(vc, emisor, "assertionMethod"), "firma de la cédula por recuperación")
    esperar(sha(canon(vc)).hex() == v["cedula"]["hashAncla"], "hash del ancla")
    esperar(prueba_valida(v["reto"], docs[v["reto"]["titular"]], "authentication"), "firma del reto")
    ahora = unix(v["verificacion"]["momento"])
    for caso in v["verificacion"]["reconocimiento"]:
        cadena = reconocimiento(v["listasConfianza"], caso["raices"], vc["issuer"], "CedulaE24", ahora,
                                caso["profundidadMax"], lambda d: docs[d])
        esperar(cadena == caso["esperado"]["cadena"], f"reconocimiento raíces={len(caso['raices'])} prof={caso['profundidadMax']}")
    negativos = {n["caso"]: n for n in v["testsNegativos"]}
    rota = json.loads(json.dumps(vc))
    rota["credentialSubject"]["numero"] = negativos["contenido alterado"]["alteracion"]["a"]
    esperar(not prueba_valida(rota, emisor, "assertionMethod")
            and sha(canon(rota)).hex() == negativos["contenido alterado"]["hashAlterado"], "negativo: contenido alterado")
    for caso, campo in (("firma high-S", "proofValueAlterado"),
                        ("proofValue sin multibase", "proofValueAlterado"),
                        ("método de verificación sustituido", "verificationMethodAlterado")):
        clave_prueba = {"proofValueAlterado": "proofValue", "verificationMethodAlterado": "verificationMethod"}[campo]
        alterada = {**vc, "proof": {**vc["proof"], clave_prueba: negativos[caso][campo]}}
        esperar(not prueba_valida(alterada, emisor, "assertionMethod"), f"negativo: {caso}")
    alt = negativos["metadatos de la prueba alterados"]["alteracion"]
    alterada = {**vc, "proof": {**vc["proof"], "created": alt["a"]}}
    esperar(not prueba_valida(alterada, emisor, "assertionMethod"), "negativo: metadatos de la prueba alterados")


# ---------------------------------------------------------------------------
# Recorrido
# ---------------------------------------------------------------------------
def main():
    print("=" * 80)
    print("  E24-V1-SIM · simulación de referencia · " + DESCARGO)
    print("=" * 80)
    conformidad()

    c = Cadena("2026-11-01T00:00:00Z")
    relayer = ident(clave("E24-SIM-RELAYER").get_verifying_key())
    web = {}
    URL_A = "https://comunidad-a.example/.well-known/e24-lista-confianza.json"
    URL_B = "https://comunidad-b.example/.well-known/e24-lista-confianza.json"
    nombres = {URL_A: "Comunidad A", URL_B: "Comunidad B"}

    # 1 · génesis del titular
    titulo(1, "Génesis del titular")
    sk_t = clave("E24-SIM-TITULAR")
    t_id = c.registrar_genesis(sk_t.get_verifying_key())
    did_t = did_de(t_id)
    print(f"  DID del titular: {did_t}")
    print("  ⚠ Advertencia (§8): \"Si pierdes este dispositivo sin respaldo, pierdes tu identidad E24. Configura guardianes.\"")
    esperar(c.gas == {} and not c.eventos, "el DID existe sin registro, sin gas y sin permiso de nadie")

    # 2 · Comunidad A: cuenta multifirma 2-de-3 con delegado de firma
    titulo(2, "Comunidad A: multifirma 2-de-3 y delegado de firma")
    custodios = [clave(f"E24-SIM-A-CUSTODIO-{i}") for i in (1, 2, 3)]
    safe_a = Multisig(c, "comunidad-a-safe", custodios, 2)
    did_a = did_de(safe_a.id)
    sk_d1 = clave("E24-SIM-A-DELEGADO-1")
    d1 = ident(sk_d1.get_verifying_key())
    rechazado(lambda: safe_a.ejecutar(custodios[:1], "ERC1056", "addDelegate", relayer, identity=safe_a.id,
                                      delegateType="veriKey", delegate=d1, validity=UN_ANIO),
              "un solo custodio intenta autorizar un delegado")
    safe_a.ejecutar(custodios[:2], "ERC1056", "addDelegate", relayer, identity=safe_a.id,
                    delegateType="veriKey", delegate=d1, validity=UN_ANIO)
    safe_a.ejecutar(custodios[1:], "ERC1056", "setAttribute", relayer, identity=safe_a.id,
                    name="did/svc/E24ListaConfianza", value=URL_A, validity=UN_ANIO)
    doc_a = resolver(c, did_a)
    print(f"  DID de Comunidad A (contrato): {did_a}")
    esperar(f"{did_a}#delegado-{d1}" in doc_a["assertionMethod"], "el delegado D1 figura en assertionMethod")
    esperar(doc_a["verificationMethod"][0]["type"] == "EcdsaSecp256k1RecoveryMethod2020",
            "#raiz de un contrato no tiene clave pública: método por recuperación")

    # 3 · listas de confianza
    titulo(3, "Listas de confianza: A reconoce a su emisor, B reconoce a A")
    sk_b = clave("E24-SIM-COMUNIDAD-B")
    did_b = did_de(c.registrar_genesis(sk_b.get_verifying_key()))
    entrada_a = {"id": did_a, "tipos": ["CedulaE24"], "prefijoAlias": "CA-V",
                 "perfil": "https://comunidad-a.example/e24/perfil.json", "desde": iso(c.t)}
    web[URL_A] = con_prueba(lista(did_a, 1, c.t, [entrada_a], []), sk_d1, f"{did_a}#delegado-{d1}", "assertionMethod", iso(c.t))
    web[URL_B] = con_prueba(lista(did_b, 1, c.t, [], [{"url": URL_A, "issuer": did_a}]), sk_b, f"{did_b}#raiz", "assertionMethod", iso(c.t))
    esperar(prueba_valida(web[URL_A], resolver(c, did_a), "assertionMethod"), "lista de A firmada por su delegado")
    esperar(prueba_valida(web[URL_B], resolver(c, did_b), "assertionMethod"), "lista de B firmada por su #raiz")

    # 4 · emisión y anclaje
    titulo(4, "Comunidad A emite una CedulaE24; el relayer paga el anclaje")
    c.avanzar(3600)
    datos_personales = {"nombre": "Persona Ficticia Uno", "origen": "Ciudad Ficticia"}
    vc1 = con_prueba(cedula(did_a, did_t, "CA-V-2026-000001", c.t, [CTX_PERFIL_A], datos_personales),
                     sk_d1, f"{did_a}#delegado-{d1}", "assertionMethod", iso(c.t))
    h1 = sha(canon(vc1)).hex()
    c.enviar(*c.operacion(sk_d1, "E24AnchorRegistry", "anchorCredential", issuer=safe_a.id, hash=h1), pagador=relayer)
    esperar(c.anclas.anclas[h1]["issuer"] == safe_a.id, "ancla registrada con issuer = Comunidad A (no el delegado)")

    # 5 · emisión abierta
    titulo(5, "Emisión abierta: un emisor C cualquiera también emite")
    sk_c = clave("E24-SIM-EMISOR-C")
    c_id = c.registrar_genesis(sk_c.get_verifying_key())
    did_c = did_de(c_id)
    vc_c = con_prueba(cedula(did_c, did_t, "C-0001", c.t), sk_c, f"{did_c}#raiz", "assertionMethod", iso(c.t))
    c.enviar(*c.operacion(sk_c, "E24AnchorRegistry", "anchorCredential", issuer=c_id, hash=sha(canon(vc_c)).hex()), pagador=c_id)
    esperar(sha(canon(vc_c)).hex() in c.anclas.anclas, "nadie necesitó permiso para emitir y anclar")

    # 6 · verificación con distintas listas
    titulo(6, "Verificación: validez y reconocimiento por separado")
    resultados = []
    casos = [
        (Verificador("V1 (confía en A)", "v1.example", [URL_A]), vc1, True, [URL_A]),
        (Verificador("V2 (confía en B)", "v2.example", [URL_B]), vc1, True, [URL_B, URL_A]),
        (Verificador("V3 (sin listas)", "v3.example", []), vc1, True, []),
        (Verificador("V1 con la cédula de C", "v1.example", [URL_A]), vc_c, True, []),
        (Verificador("V2 con profundidad 0", "v2.example", [URL_B], 0), vc1, True, []),
    ]
    for verificador, vc, valida, cadena in casos:
        c.avanzar(10)
        nonce = verificador.nuevo_nonce()
        p = presentar(vc, sk_t, f"{did_t}#raiz", did_t, nonce, verificador.dominio, c.t)
        r = verificador.verificar(c, web, p, nonce, nombres)
        resultados.append(r)
        esperar(r["valida"] == valida and r["cadena"] == cadena, f"{verificador.nombre}: {r['resultado']}")
    guardar("presentacion-ejemplo.json", p)

    # 7 · relayer malicioso
    titulo(7, "Relayer malicioso: no puede alterar una operación firmada")
    op, firma = c.operacion(sk_t, "ERC1056", "setAttribute", identity=t_id, name="e24/estado",
                            value="suspendido", validity=UN_ANIO)
    op_alterada = {**op, "args": {**op["args"], "identity": safe_a.id}}
    rechazado(lambda: c.enviar(op_alterada, firma, relayer), "el relayer cambia la identidad objetivo")
    rechazado(lambda: c.enviar(*c.operacion(sk_c, "E24AnchorRegistry", "anchorCredential", issuer=safe_a.id,
                                            hash="ff" * 32), pagador=relayer),
              "C intenta anclar en nombre de Comunidad A")

    # 8 · rotación de custodia
    titulo(8, "Rotación de custodia: D1 → D2 sin reemitir credenciales")
    c.avanzar(86400)
    sk_d2 = clave("E24-SIM-A-DELEGADO-2")
    d2 = ident(sk_d2.get_verifying_key())
    safe_a.ejecutar([custodios[0], custodios[2]], "ERC1056", "revokeDelegate", relayer,
                    identity=safe_a.id, delegateType="veriKey", delegate=d1)
    safe_a.ejecutar([custodios[0], custodios[2]], "ERC1056", "addDelegate", relayer,
                    identity=safe_a.id, delegateType="veriKey", delegate=d2, validity=UN_ANIO)
    esperar(not prueba_valida(web[URL_A], resolver(c, did_a), "assertionMethod"),
            "la lista v1 de A, firmada por D1, ya no valida: hay que republicarla")
    web[URL_A] = con_prueba(lista(did_a, 2, c.t, [entrada_a], []), sk_d2, f"{did_a}#delegado-{d2}", "assertionMethod", iso(c.t))
    v1 = Verificador("V1", "v1.example", [URL_A])
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc1, sk_t, f"{did_t}#raiz", did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(r["valida"] and r["reconocida"], "la cédula firmada por D1 sigue válida (D1 era vigente al anclar)")
    vc_d1_tarde = con_prueba(cedula(did_a, did_t, "CA-V-2026-000099", c.t), sk_d1, f"{did_a}#delegado-{d1}", "assertionMethod", iso(c.t))
    rechazado(lambda: c.enviar(*c.operacion(sk_d1, "E24AnchorRegistry", "anchorCredential", issuer=safe_a.id,
                                            hash=sha(canon(vc_d1_tarde)).hex()), pagador=relayer),
              "D1 revocado intenta anclar una cédula nueva")
    vc2 = con_prueba(cedula(did_a, did_t, "CA-V-2026-000002", c.t), sk_d2, f"{did_a}#delegado-{d2}", "assertionMethod", iso(c.t))
    h2 = sha(canon(vc2)).hex()
    c.enviar(*c.operacion(sk_d2, "E24AnchorRegistry", "anchorCredential", issuer=safe_a.id, hash=h2), pagador=relayer)
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc2, sk_t, f"{did_t}#raiz", did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(r["valida"], "cédula nueva firmada por D2 válida")

    # 9 · tampering
    titulo(9, "Tampering: un carácter alterado y firma high-S")
    rota = json.loads(json.dumps(vc1))
    rota["credentialSubject"]["numero"] = "CA-V-2026-000007"
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(rota, sk_t, f"{did_t}#raiz", did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(not r["chequeos"]["2_firmaEmisor"] and not r["chequeos"]["3_anclada"], "contenido alterado: fallan los chequeos 2 y 3")
    firma = decodificar_prueba(vc1["proof"]["proofValue"])
    alta = codificar_prueba(firma[:32] + (N - int.from_bytes(firma[32:], "big")).to_bytes(32, "big"))
    vc_alta = {**vc1, "proof": {**vc1["proof"], "proofValue": alta}}
    esperar(not prueba_valida(vc_alta, resolver(c, did_a, c.anclas.anclas[h1]["anchoredAt"]), "assertionMethod"),
            "firma high-S rechazada aunque ECDSA la acepte")

    # 10 · revocación por el emisor
    titulo(10, "Revocación de una credencial por su emisor")
    c.enviar(*c.operacion(sk_d2, "E24AnchorRegistry", "revokeCredential", hash=h2), pagador=relayer)
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc2, sk_t, f"{did_t}#raiz", did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(not r["chequeos"]["3_anclada"] and r["chequeos"]["1_titular"], "cédula 2 revocada; el DID del titular sigue intacto")
    rechazado(lambda: c.enviar(*c.operacion(sk_c, "E24AnchorRegistry", "revokeCredential", hash=h1), pagador=relayer),
              "C intenta revocar una cédula de A")

    # 11 · suspensión reversible
    titulo(11, "Suspensión reversible por el titular")
    c.enviar(*c.operacion(sk_t, "ERC1056", "setAttribute", identity=t_id, name="e24/estado",
                          value="suspendido", validity=VIGENCIA_LARGA), pagador=relayer)
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc1, sk_t, f"{did_t}#raiz", did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(not r["valida"] and resolver(c, did_t)["e24"]["estado"] == "suspendido", "DID suspendido: presentaciones rechazadas")
    rechazado(lambda: safe_a.ejecutar(custodios[:2], "ERC1056", "revokeAttribute", relayer, identity=t_id,
                                      name="e24/estado", value="suspendido"),
              "Comunidad A intenta reactivar al titular")
    c.enviar(*c.operacion(sk_t, "ERC1056", "revokeAttribute", identity=t_id, name="e24/estado",
                          value="suspendido"), pagador=relayer)
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc1, sk_t, f"{did_t}#raiz", did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(r["valida"], "el titular reactivó su DID")

    # 12 · recuperación social
    titulo(12, "Recuperación social: robo de clave, guardianes, timelock y veto")
    sk_g = [clave(f"E24-SIM-GUARDIAN-{i}") for i in range(1, 6)]
    g = [ident(k.get_verifying_key()) for k in sk_g]
    orgs = {g[0]: "Comunidad A", g[1]: None, g[2]: None, g[3]: "Universidad Ficticia", g[4]: None}
    rechazado(lambda: Recuperacion(c, t_id, t_id, dict(zip(g[:4], [None] * 4)), 2, set()),
              "k=2 con 4 guardianes (no es mayoría estricta)")
    rechazado(lambda: Recuperacion(c, t_id, t_id, {g[0]: "Comunidad A", g[1]: "Comunidad A", g[2]: None}, 2, set()),
              "una organización con dos guardianes")
    rec = Recuperacion(c, t_id, t_id, orgs, 3, {"Comunidad A"})
    c.enviar(*c.operacion(sk_t, "ERC1056", "changeOwner", identity=t_id, newOwner=rec.id), pagador=relayer)
    rec.activar(pagador=relayer)
    print(f"  E24Recovery {rec.id} es ahora dueño; 3 de 5 guardianes; timelock 72 h")
    metodo_activo = f"{did_t}#delegado-{t_id}"
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc1, sk_t, metodo_activo, did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(r["valida"], "el titular firma como delegado sigAuth de su propia identidad")

    print("  ⚠ Un ladrón obtiene la clave del titular.")
    sk_ladron = sk_t
    sk_ladron2 = clave("LADRON-SEGUNDA-CLAVE")
    ladron2 = ident(sk_ladron2.get_verifying_key())
    rec.operar(sk_ladron, "addDelegate", relayer, delegateType="sigAuth", delegate=ladron2, validity=UN_ANIO)
    print("  El ladrón agrega una segunda clave suya como delegado sigAuth.")
    rechazado(lambda: rec.operar(sk_ladron, "changeOwner", relayer, newOwner=ident(clave("LADRON").get_verifying_key())),
              "el ladrón intenta sacar a E24Recovery de inmediato")
    rec.solicitar_retiro(sk_ladron, ident(clave("LADRON").get_verifying_key()))
    print("  El ladrón solicita el retiro (queda en timelock); los guardianes lo detectan.")
    rec.cancelar_retiro(sk_g[1:4])
    esperar(rec.retiro is None, "3 guardianes cancelan el retiro durante el timelock")

    sk_nueva = clave("E24-SIM-TITULAR-NUEVA")
    nueva = ident(sk_nueva.get_verifying_key())
    rec.iniciar_recuperacion(sk_g[1:4], nueva)
    rechazado(lambda: rec.vetar(sk_ladron, []), "el ladrón intenta vetar solo con la clave")
    rechazado(lambda: rec.ejecutar_recuperacion(relayer), "ejecutar antes de 72 h")
    c.avanzar(TIMELOCK)
    rec.ejecutar_recuperacion(relayer)
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc1, sk_nueva, f"{did_t}#delegado-{nueva}", did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(r["valida"], "con la clave nueva, la misma cédula y el mismo DID siguen válidos")
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc1, sk_ladron, metodo_activo, did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(not r["chequeos"]["1_titular"], "la clave robada ya no autentica al titular")
    nonce = v1.nuevo_nonce()
    r = v1.verificar(c, web, presentar(vc1, sk_ladron2, f"{did_t}#delegado-{ladron2}", did_t, nonce, v1.dominio, c.t), nonce, nombres)
    esperar(not r["chequeos"]["1_titular"], "la segunda clave que agregó el ladrón también quedó revocada")

    print("  Tres guardianes en colusión intentan apoderarse de la identidad.")
    rec.iniciar_recuperacion([sk_g[0], sk_g[3], sk_g[4]], ident(clave("COLUSION").get_verifying_key()))
    rec.vetar(sk_nueva, [sk_g[1]])
    esperar(rec.pendiente is None, "el titular + un guardián honesto vetan la recuperación")

    # 13 · privacidad
    titulo(13, "Privacidad: qué hay en la cadena")
    cadena_txt = json.dumps({"eventos": c.eventos, "anclas": c.anclas.anclas}, ensure_ascii=False)
    pii = list(datos_personales.values()) + ["CA-V-2026-000001", "Diaspora"]
    esperar(not any(x in cadena_txt for x in pii), "ningún dato personal ni número de cédula en la cadena")
    eventos_anclas = [e for e in c.eventos if e["contrato"] == "E24AnchorRegistry"]
    esperar(all(t_id not in json.dumps(e) for e in eventos_anclas), "las anclas no mencionan al titular")

    # 14 · costo
    titulo(14, "Costo para el titular")
    pagados_titular = c.gas.get(t_id, 0)
    esperar(pagados_titular == 0, f"el titular pagó 0 operaciones; el relayer pagó {c.gas.get(relayer, 0)}")

    # artefactos
    guardar("documento-did-titular.json", resolver(c, did_t))
    guardar("documento-did-comunidad-a.json", resolver(c, did_a))
    guardar("cedula-comunidad-a.json", vc1)
    guardar("cedula-emisor-c.json", vc_c)
    guardar("listas-confianza.json", web)
    guardar("verificaciones.json", resultados)
    guardar("cadena-sim.json", {"eventos": c.eventos, "anclas": c.anclas.anclas, "gasPorPagador": c.gas})

    print("\n" + "=" * 80)
    if FALLOS:
        print(f"  ❌ {len(FALLOS)} expectativa(s) fallaron:")
        for f in FALLOS:
            print("     -", f)
        sys.exit(1)
    print(f"  ✅ Todas las expectativas se cumplen · artefactos en {ART.name}/")
    print("=" * 80)


if __name__ == "__main__":
    main()
