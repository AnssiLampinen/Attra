import json
import os
import sys
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import USER_NAME
from test import _fetch_last_messages, _find_latest_private_chat, _chat_title


MESSAGE_LIMIT = 30
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:32b")
OLLAMA_TIMEOUT_SECONDS = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "300"))
SUMMARY_MAX_TOKENS = 1200
SUMMARY_OUTPUT_PATH = "latest_private_chat_summary.txt"


def _load_env_file(path=".env"):
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_env_file()

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def _format_messages(messages):
    lines = []
    for message in messages:
        sender = getattr(message, "sender_name", None) or getattr(message, "sender", None) or "Unknown"
        text = getattr(message, "text", None) or getattr(message, "body", None) or getattr(message, "content", None) or "[Attachment]"
        lines.append(f"{sender}: {text}")
    return "\n".join(lines)


def _call_ollama(prompt):
    url = f"{OLLAMA_URL}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": SUMMARY_MAX_TOKENS,
        },
    }
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=OLLAMA_TIMEOUT_SECONDS) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama request failed: {exc.code} {exc.reason}\n{error_body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Ollama request failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError(
            f"Ollama request timed out after {OLLAMA_TIMEOUT_SECONDS}s while using model '{OLLAMA_MODEL}'. "
            "Set OLLAMA_TIMEOUT_SECONDS to a higher value if needed."
        ) from exc
    except socket.timeout as exc:
        raise RuntimeError(
            f"Ollama request timed out after {OLLAMA_TIMEOUT_SECONDS}s while using model '{OLLAMA_MODEL}'. "
            "Set OLLAMA_TIMEOUT_SECONDS to a higher value if needed."
        ) from exc

    text = data.get("response", "").strip()
    done_reason = data.get("done_reason", "")

    if not text:
        raise RuntimeError(f"Ollama returned an empty summary: {data}")

    return text, done_reason


def summarize_with_ollama(messages):
    chat_text = _format_messages(messages)

    prompt = (
        "Create a short, structured note from these chat messages for a service provider. "
        "Only include details that are explicitly stated in the messages. Ignore call events and missed-call notifications. "
        f"Address {USER_NAME} as 'you'.\n\n"
        "Output format (exactly these four lines):\n"
        "1. Situation: <one sentence on overall context>\n"
        "2. Customer Needs: <one sentence on what the customer needs/wants>\n"
        "3. Latest Requests: <one sentence on latest actionable requests/questions>\n"
        "4. Recommended Next Step: <one sentence on what you should do next>\n\n"
        "Constraints: maximum 4 sentences total, plain text only, no extra headings, no bullets, no invented facts.\n\n"
        f"Messages:\n{chat_text}"
    )

    summary, done_reason = _call_ollama(prompt)

    # Continue if Ollama reports truncation due to token cap.
    for _ in range(3):
        if done_reason != "length":
            break

        continuation_prompt = (
            "Continue the summary exactly from where it stopped. "
            "Do not repeat previous text. Complete any unfinished sentence and all missing sections.\n\n"
            f"Current summary:\n{summary}\n\n"
            f"Original messages:\n{chat_text}"
        )
        continuation_text, done_reason = _call_ollama(continuation_prompt)
        if continuation_text:
            summary = f"{summary}\n\n{continuation_text}".strip()

    return summary


def main():
    latest_private_chat = _find_latest_private_chat()
    messages = _fetch_last_messages(latest_private_chat, limit=MESSAGE_LIMIT)

    print(f"Latest private chat: {_chat_title(latest_private_chat)}")
    print(f"Showing the last {len(messages)} messages:\n")

    for message in messages:
        sender = getattr(message, "sender_name", None) or getattr(message, "sender", None) or "Unknown"
        text = getattr(message, "text", None) or getattr(message, "body", None) or getattr(message, "content", None) or "[Attachment]"
        print(f"{sender}: {text}")

    print("\nSummary:\n")
    summary = summarize_with_ollama(messages)
    print(summary)

    with open(SUMMARY_OUTPUT_PATH, "w", encoding="utf-8") as handle:
        handle.write(summary)
    print(f"\nSaved full summary to {SUMMARY_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
