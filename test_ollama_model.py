import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:32b")


def ollama_generate(prompt, model=DEFAULT_MODEL, timeout=180):
    url = f"{OLLAMA_URL}/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2},
    }

    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    started = time.perf_counter()
    with urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    elapsed = time.perf_counter() - started

    text = data.get("response", "").strip()
    return text, elapsed, data


def main():
    model = DEFAULT_MODEL
    print(f"Testing Ollama model: {model}")
    print(f"Using endpoint: {OLLAMA_URL}")

    prompt = (
        "Summarize this in 3 bullet points: "
        "Alice planned the launch, Bob fixed the payment bug, and the team postponed release to Friday "
        "because QA found two critical issues."
    )

    try:
        text, elapsed, raw = ollama_generate(prompt, model=model)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP error from Ollama: {exc.code} {exc.reason}")
        print(body)
        sys.exit(1)
    except URLError as exc:
        print("Could not connect to Ollama. Is Ollama running?")
        print(f"Connection error: {exc.reason}")
        sys.exit(1)
    except Exception as exc:
        print(f"Unexpected error: {exc}")
        sys.exit(1)

    if not text:
        print("Model returned an empty response.")
        print(raw)
        sys.exit(1)

    print(f"Response received in {elapsed:.2f}s")
    print("\nModel output:\n")
    print(text)
    print("\nSmoke test passed.")


if __name__ == "__main__":
    main()
