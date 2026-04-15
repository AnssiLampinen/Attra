# ATTRA CRM

ATTRA is a lightweight CRM that reads chats from Beeper Desktop, summarizes them with a local LLM via Ollama, stores leads in Supabase, and shows them in a simple web UI.

The pipeline is split into two parts that can run on separate machines:

- **Beeper machine** — has Beeper Desktop installed; runs `ingest_beeper_messages.py` to pull chats and stage them in Supabase
- **Backend machine** — has Ollama installed; runs `process_raw_messages.py` (LLM worker) and `app_server.py` (web UI)

Both parts can run on the same machine if preferred.

---

## Part 1 — Beeper ingest script

### What it does

`ingest_beeper_messages.py` polls Beeper Desktop for new private-chat messages and writes them to the `raw_messages` staging table in Supabase. No LLM is involved.

### Files needed on the Beeper machine

Copy these from the repo:

```
ingest_beeper_messages.py
beeper_client.py
database.py
supabase_client.py
config.py
.env
```

### Install dependencies

```powershell
pip install supabase beeper-desktop-api
```

### Configure `.env`

```env
BEEPER_ACCESS_TOKEN=your_beeper_access_token_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CRM_TENANT_ID=your_tenant_id
```

Optional settings (shown with defaults):

```env
BEEPER_BASE_URL=http://localhost:23373
INBOX_POLL_INTERVAL_SECONDS=20
INBOX_NEW_CUSTOMER_MESSAGE_LIMIT=50
INBOX_EXISTING_CUSTOMER_MESSAGE_LIMIT=10
INBOX_SCAN_CHAT_LIMIT=100
INBOX_MONITORED_CONVERSATIONS=5
ATTRA_USER_NAME=you
```

### Run

Make sure Beeper Desktop is open and signed in, then:

```powershell
python ingest_beeper_messages.py
```

The script polls on a loop. Stop it with `Ctrl+C`.

### How to get your Beeper access token

The `BEEPER_ACCESS_TOKEN` is read from the Beeper Desktop app data. Use the `beeper_desktop_api` package to retrieve it, or copy it from the app's local config files. Refer to the `beeper-desktop-api` package documentation for details.

---

## Part 2 — Backend (LLM worker + web UI)

### What it does

- `process_raw_messages.py` polls the `raw_messages` staging table, calls Ollama to generate customer summaries and action items, and updates the customer records in Supabase.
- `app_server.py` serves the web UI and provides the REST API consumed by the frontend.

### Requirements

- Python 3.11 or newer
- Ollama installed and running
- All repo files

### Install Python

Install Python from python.org. During setup, check **Add python.exe to PATH**.

Verify:

```powershell
python --version
pip --version
```

### Install Ollama

Install Ollama for Windows from ollama.com.

Verify:

```powershell
ollama --version
```

Ollama runs locally at `http://localhost:11434` by default.

### Clone the repo

```powershell
git clone <your-repo-url>
cd Attra
```

### Create a virtual environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, run once:

```powershell
Set-ExecutionPolicy -Scope Process RemoteSigned
```

Then activate again.

### Install Python dependencies

```powershell
pip install supabase beeper-desktop-api
```

### Configure `.env`

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CRM_TENANT_ID=your_tenant_id
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT_SECONDS=300
ATTRA_USER_NAME=Anssi
```

`BEEPER_ACCESS_TOKEN` is not needed here if this machine does not run the ingest script.

### Pull the Ollama model

```powershell
ollama pull qwen2.5:7b
```

Larger models give better summaries but are slower. Options from smallest to largest:

- `llama3.2:3b` — fast, lightweight
- `qwen2.5:7b` — good balance (recommended starting point)
- `qwen2.5:14b`
- `qwen2.5:32b` — best quality, needs strong hardware

If the model is slow, increase `OLLAMA_TIMEOUT_SECONDS` or switch to a smaller model.

### Run the LLM worker

```powershell
python process_raw_messages.py
```

This polls Supabase for unprocessed message batches and generates summaries. Stop with `Ctrl+C`.

### Run the web server

In a separate terminal:

```powershell
python app_server.py
```

Open the UI at:

```
http://127.0.0.1:8000
```

---

## Typical daily workflow

1. Start Beeper Desktop (signed in)
2. Start `ingest_beeper_messages.py` on the Beeper machine
3. Start Ollama on the backend machine
4. Start `process_raw_messages.py`
5. Start `app_server.py`
6. Open `http://127.0.0.1:8000`

---

## Database notes

- All data is stored in Supabase — no local database file needed.
- Schema migrations are applied via the Supabase SQL editor.
- To reset data, truncate the relevant tables in Supabase.

---

## Files you should not commit

```
.env
__pycache__/
```

---

## Troubleshooting

**Python cannot import the Beeper package**
```powershell
pip install beeper-desktop-api
```

**Ollama connection fails**
Check that Ollama is running at `http://localhost:11434`.

**Model too slow or runs out of memory**
Switch to a smaller `OLLAMA_MODEL` in `.env` and pull it with `ollama pull <model>`.

**Web page loads but shows no data**
- Confirm `app_server.py` is running.
- Confirm `ingest_beeper_messages.py` has run and staged messages.
- Confirm `process_raw_messages.py` has processed them.

**PowerShell blocks script activation**
```powershell
Set-ExecutionPolicy -Scope Process RemoteSigned
```
