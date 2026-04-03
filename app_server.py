import json
import os
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


HOST = "127.0.0.1"
PORT = 8000
DB_PATH = "crm.db"


def _json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _load_leads(db_path: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        rows = cursor.execute(
            """
            SELECT
                id,
                name,
                phone,
                email,
                status,
                summary,
                last_updated_at,
                customer_profile,
                whatsapp_id,
                instagram_id,
                messenger_id,
                telegram_id,
                signal_id,
                twitter_id,
                linkedin_id,
                slack_id,
                discord_id,
                google_messages_id,
                google_chat_id,
                google_voice_id,
                last_processed_message_id,
                profile_notes
            FROM customers
            ORDER BY COALESCE(last_updated_at, '') DESC, id DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/leads":
            try:
                leads = _load_leads(DB_PATH)
                _json_response(self, 200, {"leads": leads})
            except Exception as exc:
                _json_response(self, 500, {"error": f"Failed to load leads: {exc}"})
            return

        if path == "/" or path == "/index.html":
            self.path = "/index.html"
            return super().do_GET()

        return super().do_GET()


def main() -> None:
    if not os.path.exists(DB_PATH):
        raise SystemExit(f"Database not found: {os.path.abspath(DB_PATH)}")

    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Serving ATTRA app at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
