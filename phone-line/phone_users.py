"""Maintain private caller profiles with encrypted Gemini API keys."""

import argparse
import getpass
import json
import os
from pathlib import Path
import re
from uuid import uuid4

from cryptography.fernet import Fernet


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


def provision(path, number, api_key, cipher, *, first_name, last_name):
    number = normalize_number(number)
    if not first_name.strip() or not last_name.strip() or not api_key:
        raise ValueError("First name, last name and API key are required")
    callers = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    current = callers.get(number) or {}
    callers[number] = {
        "id": current.get("id") or uuid4().hex,
        "first_name": first_name.strip(),
        "last_name": last_name.strip(),
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roster", type=Path)
    parser.add_argument("number")
    args = parser.parse_args()
    cipher = Fernet(os.environ["PHONE_MASTER_KEY"].encode())
    first_name = input("First name: ").strip()
    last_name = input("Last name: ").strip()
    api_key = getpass.getpass("User Gemini API key: ").strip()
    provision(args.roster, args.number, api_key, cipher, first_name=first_name, last_name=last_name)
    print("Caller saved")


if __name__ == "__main__":
    main()
