"""
env_loader.py

Single shared implementation of .env file loading. Imported by every script
that reads environment variables so the function is defined exactly once.

Exports:
  _load_env_file(path)  — reads key=value pairs from path into os.environ,
                          skipping blank lines and comments, honouring
                          single/double quote stripping, never overwriting
                          variables that are already set in the environment
"""

import os


def _load_env_file(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
