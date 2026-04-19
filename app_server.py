"""
app_server.py

ThreadingHTTPServer that serves the ATTRA web UI and its REST API on
port 8000. All API routes live under /api/ and require a valid Supabase
JWT in the Authorization header. Static frontend files (index.html,
app.js, etc.) are served directly from the repo root.

Does not require Beeper Desktop or Ollama — it only talks to Supabase
and, for voice notes, to a local faster-whisper / ffmpeg installation.

Key responsibilities:
  - JWT authentication via Supabase JWKS endpoint
  - CRUD for customers (/api/leads), deals (/api/deals), tags (/api/tags),
    customer tags (/api/leads/<id>/tags), and events (/api/leads/<id>/events)
  - Tenant settings read/write (/api/settings)
  - Voice note upload (/api/leads/<id>/voice-note): decodes base64 audio,
    transcribes it with faster-whisper in a background thread, appends the
    transcription to the customer's notes, and queues a raw_messages batch
    for process_raw_messages.py to pick up
  - Cache-Control headers on all responses so Cloudflare tunnels don't
    serve stale JS/HTML
"""

import json
import os
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


def _print(*args, **kwargs):
    print(datetime.now().strftime('%H:%M:%S'), *args, **kwargs)

import jwt

from database import (
    create_customer,
    create_feedback,
    create_customer_event,
    create_deal,
    create_tag,
    delete_customer_event,
    delete_tag,
    get_all_customer_events,
    get_customer,
    get_customer_events,
    get_customer_tags,
    get_tags_for_tenant,
    get_tenant,
    initialize_database,
    insert_raw_message_batch,
    load_customer_tags_for_tenant,
    load_customers_for_tenant,
    merge_customers,
    load_deals_for_tenant,
    queue_customer_refresh,
    resolve_tenant_id_by_supabase_user_id,
    set_customer_tags,
    soft_delete_customer,
    update_customer,
    update_deal,
    update_tag,
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
            return None

        return jwt.decode(
            token,
            public_key,
            algorithms=[alg],
            options={"verify_aud": False},
        )
    except jwt.InvalidTokenError:
        return None
    except Exception:
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
    return tenant_id


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        parsed_path = urlparse(self.path).path
        if not parsed_path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

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
                    "voice_note_append_to_notes": bool((tenant or {}).get("voice_note_append_to_notes", True)),
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

        if path == "/api/events":
            try:
                tenant_id = _tenant_id_for_request(self)
                if not tenant_id:
                    _json_response(self, 401, {"error": "Missing or invalid token"})
                    return
                events = get_all_customer_events(tenant_id)
                _json_response(self, 200, {"events": events})
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

        if path.startswith("/api/tags/"):
            tag_id_str = path[len("/api/tags/"):]
            try:
                tag_id = int(tag_id_str)
            except ValueError:
                _json_response(self, 400, {"error": "Invalid tag id"})
                return
            try:
                delete_tag(tenant_id, tag_id)
                _json_response(self, 200, {"ok": True})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path.startswith("/api/leads/"):
            customer_id_str = path[len("/api/leads/"):]
            try:
                customer_id = int(customer_id_str)
            except ValueError:
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            try:
                soft_delete_customer(tenant_id, customer_id)
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

        # PATCH /api/tags/<id>
        if path.startswith("/api/tags/"):
            tag_id_str = path[len("/api/tags/"):]
            try:
                tag_id = int(tag_id_str)
            except ValueError:
                _json_response(self, 400, {"error": "Invalid tag id"})
                return
            name = (body.get("name") or "").strip()
            if not name:
                _json_response(self, 400, {"error": "name required"})
                return
            color = body.get("color") or None
            try:
                tag = update_tag(tenant_id, tag_id, name, color)
                if tag is None:
                    _json_response(self, 404, {"error": "Tag not found"})
                else:
                    _json_response(self, 200, {"tag": tag})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

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
                color = body.get("color") or None
                tag = create_tag(tenant_id, name, color)
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

        if path.startswith("/api/leads/") and path.endswith("/refresh"):
            parts = path.split("/")
            try:
                customer_id = int(parts[3])
            except (IndexError, ValueError):
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            try:
                updated = queue_customer_refresh(tenant_id, customer_id)
                if updated is None:
                    _json_response(self, 404, {"error": "Customer not found"})
                    return
                _print(f"Refresh queued for customer id={customer_id}")
                _json_response(self, 200, {"ok": True, "queued": True, "customer": updated})
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        if path.startswith("/api/leads/") and path.endswith("/merge"):
            parts = path.split("/")
            try:
                primary_id = int(parts[3])
            except (IndexError, ValueError):
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            secondary_id = body.get("secondary_id")
            if not secondary_id:
                _json_response(self, 400, {"error": "secondary_id required"})
                return
            try:
                secondary_id = int(secondary_id)
            except (TypeError, ValueError):
                _json_response(self, 400, {"error": "secondary_id must be integer"})
                return
            if primary_id == secondary_id:
                _json_response(self, 400, {"error": "Cannot merge customer with itself"})
                return
            try:
                primary = get_customer(tenant_id, primary_id)
                secondary = get_customer(tenant_id, secondary_id)
                if not primary:
                    _json_response(self, 404, {"error": "Primary customer not found"})
                    return
                if not secondary:
                    _json_response(self, 404, {"error": "Secondary customer not found"})
                    return
                if (primary.get("status") or "").lower() == "deleted":
                    _json_response(self, 400, {"error": "Primary customer is deleted"})
                    return
                if (secondary.get("status") or "").lower() == "deleted":
                    _json_response(self, 400, {"error": "Secondary customer is deleted"})
                    return
                merged = merge_customers(tenant_id, primary, secondary)
                _print(f"Merged customer id={secondary_id} into id={primary_id}")
                _json_response(self, 200, {"ok": True, "customer": merged})
            except Exception as exc:
                _print(f"Merge failed primary={primary_id} secondary={secondary_id}: {exc}")
                _json_response(self, 500, {"error": f"Merge failed: {exc}"})
            return

        # POST /api/feedback
        if path == "/api/feedback":
            category = (body.get("category") or "").strip()
            message = (body.get("message") or "").strip()
            if not category:
                _json_response(self, 400, {"error": "category required"})
                return
            try:
                row = create_feedback(tenant_id, category, message)
                _print(f"Feedback submitted tenant={tenant_id} category={category}")
                _json_response(self, 201, {"ok": True, "feedback": row})
            except Exception as exc:
                _print(f"Feedback submit failed: {exc}")
                _json_response(self, 500, {"error": f"Failed: {exc}"})
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

        if path.startswith("/api/leads/") and path.endswith("/voice-note"):
            parts = path.split("/")
            try:
                customer_id = int(parts[3])
            except (IndexError, ValueError):
                _json_response(self, 400, {"error": "Invalid customer id"})
                return
            try:
                import base64, tempfile, threading as _threading
                audio_bytes = base64.b64decode(body["audio_b64"])
                with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
                    tmp.write(audio_bytes)
                    tmp_path = tmp.name
            except Exception as exc:
                _json_response(self, 400, {"error": f"Bad request: {exc}"})
                return

            # Respond immediately — all processing happens in background
            _json_response(self, 200, {"ok": True})

            def _bg(tmp_path=tmp_path, customer_id=customer_id, tenant_id=tenant_id):
                import os
                try:
                    from transcribe import transcribe_audio
                    from datetime import datetime, timezone

                    transcription = transcribe_audio(tmp_path)
                    if not transcription:
                        return

                    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                    tenant = get_tenant(tenant_id) or {}
                    if tenant.get("voice_note_append_to_notes", True):
                        existing = get_customer(tenant_id, customer_id) or {}
                        old_notes = (existing.get("notes") or "").rstrip()
                        new_notes = (old_notes + "\n\n" if old_notes else "") + f"[Voice note {ts}]: {transcription}"
                        update_customer(tenant_id, customer_id, {"notes": new_notes})

                    # Queue LLM processing alongside regular messages
                    batch_id = insert_raw_message_batch(
                        tenant_id=tenant_id,
                        customer_id=customer_id,
                        messages=[{"sender": "Team note", "text": transcription}],
                        latest_message_id=f"voice-note-{ts}-{customer_id}",
                    )
                    _print(f"Voice note queued as batch_id={batch_id} for customer id={customer_id}")
                except Exception as exc:
                    _print(f"Voice note background processing failed: {exc}")
                finally:
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

            _threading.Thread(target=_bg, daemon=True).start()
            return

        _json_response(self, 404, {"error": "Not found"})


def main() -> None:
    db_info = initialize_database()

    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    _print(f"Serving ATTRA app at http://{HOST}:{PORT}")
    if db_info.get("created_default_tenant"):
        _print(f"Default tenant API key: {db_info['default_tenant_api_key']}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
