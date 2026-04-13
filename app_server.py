import json
import os
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import jwt

from database import (
    create_customer,
    create_customer_event,
    create_deal,
    create_tag,
    delete_customer_event,
    get_customer_events,
    get_customer_tags,
    get_tags_for_tenant,
    get_tenant,
    initialize_database,
    load_customer_tags_for_tenant,
    load_customers_for_tenant,
    load_deals_for_tenant,
    resolve_tenant_id_by_supabase_user_id,
    set_customer_tags,
    update_customer,
    update_deal,
    update_tenant_settings,
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

        if path == "/api/settings":
            try:
                tenant_id = _tenant_id_for_request(self)
                if not tenant_id:
                    _json_response(self, 401, {"error": "Missing or invalid token"})
                    return
                tenant = get_tenant(tenant_id)
                _json_response(self, 200, {
                    "hide_personal_contacts": bool((tenant or {}).get("hide_personal_contacts", False)),
                    "username": (tenant or {}).get("username") or "",
                    "display_name": (tenant or {}).get("display_name") or "",
                })
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path == "/api/deals":
            try:
                tenant_id = _tenant_id_for_request(self)
                if not tenant_id:
                    _json_response(self, 401, {"error": "Missing or invalid token"})
                    return

                deals = load_deals_for_tenant(tenant_id)
                _json_response(self, 200, {"deals": deals})
            except Exception as exc:
                _json_response(self, 500, {"error": f"Failed to load deals: {exc}"})
            return

        if path == "/api/tags":
            try:
                tenant_id = _tenant_id_for_request(self)
                if not tenant_id:
                    _json_response(self, 401, {"error": "Missing or invalid token"})
                    return
                tags = get_tags_for_tenant(tenant_id)
                _json_response(self, 200, {"tags": tags})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path == "/api/customer-tags":
            try:
                tenant_id = _tenant_id_for_request(self)
                if not tenant_id:
                    _json_response(self, 401, {"error": "Missing or invalid token"})
                    return
                mapping = load_customer_tags_for_tenant(tenant_id)
                _json_response(self, 200, {"customer_tags": mapping})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path.startswith("/api/leads/") and path.endswith("/tags"):
            parts = path.split("/")
            try:
                customer_id = int(parts[3])
            except (IndexError, ValueError):
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            try:
                tenant_id = _tenant_id_for_request(self)
                if not tenant_id:
                    _json_response(self, 401, {"error": "Missing or invalid token"})
                    return
                tags = get_customer_tags(customer_id)
                _json_response(self, 200, {"tags": tags})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path.startswith("/api/leads/") and path.endswith("/events"):
            parts = path.split("/")
            try:
                customer_id = int(parts[3])
            except (IndexError, ValueError):
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            try:
                tenant_id = _tenant_id_for_request(self)
                if not tenant_id:
                    _json_response(self, 401, {"error": "Missing or invalid token"})
                    return
                events = get_customer_events(tenant_id, customer_id)
                _json_response(self, 200, {"events": events})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path == "/" or path == "/index.html":
            self.path = "/index.html"
            return super().do_GET()

        return super().do_GET()

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        tenant_id = _tenant_id_for_request(self)
        if not tenant_id:
            _json_response(self, 401, {"error": "Missing or invalid token"})
            return

        if path.startswith("/api/events/"):
            event_id_str = path[len("/api/events/"):]
            try:
                event_id = int(event_id_str)
            except ValueError:
                _json_response(self, 400, {"error": "Invalid event id"})
                return
            try:
                delete_customer_event(tenant_id, event_id)
                _json_response(self, 200, {"ok": True})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        _json_response(self, 404, {"error": "Not found"})

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        tenant_id = _tenant_id_for_request(self)
        if not tenant_id:
            _json_response(self, 401, {"error": "Missing or invalid token"})
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

        # PATCH /api/settings
        if path == "/api/settings":
            try:
                update_tenant_settings(tenant_id, body)
                _json_response(self, 200, {"ok": True})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        # PATCH /api/deals/<id>
        if path.startswith("/api/deals/"):
            deal_id_str = path[len("/api/deals/"):]
            try:
                deal_id = int(deal_id_str)
            except ValueError:
                _json_response(self, 400, {"error": "Invalid deal id"})
                return
            try:
                row = update_deal(tenant_id, deal_id, body)
                if row is None:
                    _json_response(self, 404, {"error": "Deal not found"})
                else:
                    _json_response(self, 200, {"deal": row})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        # PATCH /api/leads/<id>
        if path.startswith("/api/leads/"):
            customer_id_str = path[len("/api/leads/"):]
            try:
                customer_id = int(customer_id_str)
            except ValueError:
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            try:
                row = update_customer(tenant_id, customer_id, body)
                if row is None:
                    _json_response(self, 404, {"error": "Customer not found"})
                else:
                    _json_response(self, 200, {"customer": row})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        _json_response(self, 404, {"error": "Not found"})

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        tenant_id = _tenant_id_for_request(self)
        if not tenant_id:
            _json_response(self, 401, {"error": "Missing or invalid token"})
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

        if path.startswith("/api/leads/") and path.endswith("/tags"):
            parts = path.split("/")
            try:
                customer_id = int(parts[3])
            except (IndexError, ValueError):
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            tag_ids = [int(x) for x in (body.get("tag_ids") or []) if x]
            try:
                set_customer_tags(customer_id, tag_ids)
                _json_response(self, 200, {"ok": True})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        _json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        tenant_id = _tenant_id_for_request(self)
        if not tenant_id:
            _json_response(self, 401, {"error": "Missing or invalid token"})
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

        if path == "/api/leads":
            try:
                row = create_customer(tenant_id, body)
                _json_response(self, 201, {"customer": row})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path == "/api/tags":
            try:
                name = (body.get("name") or "").strip()
                if not name:
                    _json_response(self, 400, {"error": "name required"})
                    return
                tag = create_tag(tenant_id, name)
                _json_response(self, 201, {"tag": tag})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path == "/api/deals":
            try:
                row = create_deal(tenant_id, body)
                _json_response(self, 201, {"deal": row})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path.startswith("/api/leads/") and path.endswith("/events"):
            parts = path.split("/")
            try:
                customer_id = int(parts[3])
            except (IndexError, ValueError):
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            try:
                title = (body.get("title") or "").strip()
                if not title:
                    _json_response(self, 400, {"error": "title required"})
                    return
                event_date = (body.get("event_date") or "").strip()
                if not event_date:
                    _json_response(self, 400, {"error": "event_date required"})
                    return
                row = create_customer_event(tenant_id, customer_id, body)
                _json_response(self, 201, {"event": row})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        _json_response(self, 404, {"error": "Not found"})


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
