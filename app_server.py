import json
import os
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import jwt

from database import (
    initialize_database,
    load_customers_for_tenant,
    resolve_tenant_id_by_supabase_user_id,
)
from supabase_client import SUPABASE_URL


HOST = "127.0.0.1"
PORT = 8000

SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

_jwks_cache: list = []


def _fetch_jwks() -> list:
    global _jwks_cache
    url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    with urllib.request.urlopen(url) as resp:
        data = json.loads(resp.read())
    _jwks_cache = data.get("keys", [])
    return _jwks_cache


def _get_public_key(kid: str, alg: str):
    keys = _jwks_cache if _jwks_cache else _fetch_jwks()
    for key in keys:
        if key.get("kid") == kid:
            return _key_from_jwk(key, alg)
    # Key not in cache — refresh once and retry
    keys = _fetch_jwks()
    for key in keys:
        if key.get("kid") == kid:
            return _key_from_jwk(key, alg)
    return None


def _key_from_jwk(key: dict, alg: str):
    if alg == "ES256":
        return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(key))
    if alg in ("RS256", "RS384", "RS512"):
        return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
    return None


def _extract_bearer_token(handler: SimpleHTTPRequestHandler) -> str | None:
    authorization = handler.headers.get("Authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        return token or None
    return None


def _validate_jwt(token: str) -> dict | None:
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        alg = header.get("alg", "ES256")

        public_key = _get_public_key(kid, alg)
        if not public_key:
            print(f"DEBUG: No public key found for kid={kid}")
            return None

        return jwt.decode(
            token,
            public_key,
            algorithms=[alg],
            options={"verify_aud": False},
        )
    except jwt.InvalidTokenError as e:
        print(f"DEBUG: JWT validation failed: {e}")
        return None
    except Exception as e:
        print(f"DEBUG: JWT validation error: {e}")
        return None


def _json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _tenant_id_for_request(handler: SimpleHTTPRequestHandler) -> str | None:
    token = _extract_bearer_token(handler)
    if not token:
        return None

    payload = _validate_jwt(token)
    if not payload:
        return None

    supabase_user_id = payload.get("sub")
    if not supabase_user_id:
        return None

    tenant_id = resolve_tenant_id_by_supabase_user_id(supabase_user_id)
    if not tenant_id:
        print(f"DEBUG: No tenant found for supabase_user_id={supabase_user_id}")
    return tenant_id


class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/config":
            _json_response(self, 200, {
                "supabase_url": SUPABASE_URL,
                "supabase_anon_key": SUPABASE_ANON_KEY,
            })
            return

        if path == "/api/leads":
            try:
                tenant_id = _tenant_id_for_request(self)
                if not tenant_id:
                    _json_response(self, 401, {"error": "Missing or invalid token"})
                    return

                leads = load_customers_for_tenant(tenant_id)
                _json_response(self, 200, {"leads": leads})
            except Exception as exc:
                _json_response(self, 500, {"error": f"Failed to load leads: {exc}"})
            return

        if path == "/" or path == "/index.html":
            self.path = "/index.html"
            return super().do_GET()

        return super().do_GET()


def main() -> None:
    db_info = initialize_database()

    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Serving ATTRA app at http://{HOST}:{PORT}")
    if db_info.get("created_default_tenant"):
        print(f"Default tenant API key: {db_info['default_tenant_api_key']}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
