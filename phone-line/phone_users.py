"""Provision authorized callers without storing plaintext Gemini keys or PINs."""

import argparse
import base64
import getpass
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
from uuid import uuid4

from cryptography.fernet import Fernet

PIN_LENGTH = 6


def normalize_number(value):
    """Accept Israeli local numbers or an explicit international number."""
    number = re.sub(r"[ ()-]", "", value)
    if re.fullmatch(r"0[1-9][0-9]{7,8}", number):
        number = "+972" + number[1:]
    elif number.startswith("00"):
        number = "+" + number[2:]
    elif number.startswith("972"):
        number = "+" + number
    if not re.fullmatch(r"\+[1-9][0-9]{7,14}", number):
        raise ValueError("Invalid caller number")
    return number


def digest_pin(pin, salt):
    return hashlib.scrypt(pin.encode("ascii"), salt=salt, n=16384, r=8, p=1)


def provision(path, number, pin, api_key, cipher):
    if not re.fullmatch(r"[0-9]{6}", pin) or not api_key:
        raise ValueError("A six-digit PIN and API key are required")
    callers = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    current = callers.get(number) or {}
    salt = secrets.token_bytes(16)
    callers[number] = {
        "id": current.get("id") or uuid4().hex,
        "salt": base64.b64encode(salt).decode("ascii"),
        "pin_hash": base64.b64encode(digest_pin(pin, salt)).decode("ascii"),
        "key": cipher.encrypt(api_key.encode()).decode("ascii"),
    }
    # An editor interruption leaves the prior roster intact.
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
            json.dump(callers, output, indent=2)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def verify_pin(record, pin, cipher):
    actual = digest_pin(pin, base64.b64decode(record["salt"]))
    if not hmac.compare_digest(actual, base64.b64decode(record["pin_hash"])):
        return None
    return cipher.decrypt(record["key"].encode()).decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roster", type=Path)
    parser.add_argument("number")
    args = parser.parse_args()
    cipher = Fernet(os.environ["PHONE_MASTER_KEY"].encode())
    pin = getpass.getpass("Six-digit phone PIN: ")
    if pin != getpass.getpass("Repeat PIN: "):
        parser.error("PINs do not match")
    api_key = getpass.getpass("User Gemini API key: ").strip()
    provision(args.roster, normalize_number(args.number), pin, api_key, cipher)
    print("Caller saved")


if __name__ == "__main__":
    main()
