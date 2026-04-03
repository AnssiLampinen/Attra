# ATTRA CRM

ATTRA is a small local CRM that pulls chats from Beeper, summarizes conversations with a local LLM through Ollama, stores leads in SQLite, and shows them in a simple web UI.

## What this project uses

- Python scripts for ingestion, updates, and the local web server
- SQLite database in `crm.db`
- Beeper Desktop API via `beeper_desktop_api`
- Ollama for local LLM summaries
- A static frontend in `index.html` served by `app_server.py`

## Before you start

You need:

- Windows 10 or 11
- Administrator access for software installation
- Internet access to download tools and models
- A Beeper account signed in on Beeper Desktop
- Enough RAM and disk space for the Ollama model you choose

## 1. Install the base tools

### 1.1 Install Git

Install Git for Windows from the official Git website.

During setup, enable the option to use Git from the command line.

### 1.2 Install Python 3.11 or newer

Install Python from python.org.

During setup:

- check Add python.exe to PATH
- install for all users if possible

After installation, open PowerShell and confirm Python works:

```powershell
python --version
pip --version
```

If Python is not found, restart PowerShell or use the full path to the Python executable.

### 1.3 Install Ollama

Install Ollama for Windows from ollama.com.

After installation, open a new terminal and verify it responds:

```powershell
ollama --version
```

Ollama usually runs locally on:

```text
http://localhost:11434
```

### 1.4 Install Beeper Desktop

Install and sign in to the Beeper Desktop app.

This project does not use a public Beeper cloud API. It uses the local Beeper Desktop client through the `beeper_desktop_api` Python package.

## 2. Get the project onto the computer

Clone the repository into a local folder:

```powershell
git clone <your-repo-url>
cd Attra
```

If you already copied the folder, just open a terminal in the project directory.

## 3. Create a Python environment

Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, run this once for the current window:

```powershell
Set-ExecutionPolicy -Scope Process RemoteSigned
```

Then activate the environment again.

## 4. Install Python dependencies

Install the package used by the Beeper integration:

```powershell
pip install beeper-desktop-api
```

The rest of the project mainly uses Python standard library modules.

## 5. Create the local secrets file

Create a file named `.env` in the project root.

Use this template and fill in your own values:

```env
BEEPER_ACCESS_TOKEN=your_beeper_access_token_here
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:32b
OLLAMA_TIMEOUT_SECONDS=300
GEMINI_API_KEY=optional_future_use_only
```

### Important notes about `.env`

- Do not commit `.env` to GitHub.
- The project loads `.env` automatically.
- `GEMINI_API_KEY` is currently not used by the active scripts, but it is safe to keep here for future features.

## 6. Download and test the LLM model

The project uses Ollama for all summary generation.

The default model is:

```text
qwen2.5:32b
```

That model is large and may be too slow or memory-heavy on weaker PCs.

### 6.1 Pull the default model

```powershell
ollama pull qwen2.5:32b
```

### 6.2 Test the model

Run the smoke test script:

```powershell
python test_ollama_model.py
```

If Ollama is working, the script should print a short response and complete successfully.

## 7. If the model is too slow, switch to a smaller one

If the default model does not run well on your computer, edit `.env` and change `OLLAMA_MODEL` to a smaller model.

Good smaller options are:

- `qwen2.5:14b`
- `qwen2.5:7b`
- `llama3.2:3b`
- `phi3:mini`

Example:

```env
OLLAMA_MODEL=qwen2.5:7b
```

Then pull the model:

```powershell
ollama pull qwen2.5:7b
```

Then test again:

```powershell
python test_ollama_model.py
```

### Tips for weak hardware

- Start with a smaller model first
- Keep only one heavy app open while testing
- Increase `OLLAMA_TIMEOUT_SECONDS` if the model is slow but still working
- Lower model size before trying to tune code

## 8. Understand the main project files

- `test.py` connects to Beeper Desktop and exposes the shared chat client
- `fetch_latest_private_chat_messages.py` pulls chat messages and asks Ollama for a summary
- `create_crm_entry_from_latest_chat.py` creates a new CRM record from the latest unlogged chat
- `watch_inbox_and_update_crm.py` keeps polling chats and updates existing CRM rows
- `app_server.py` serves the UI and provides the `/api/leads` endpoint
- `index.html` is the frontend
- `crm.db` is the SQLite database

## 9. Run the app the first time

You usually want three things running:

1. Ollama
2. The local web server
3. The inbox watcher

### 9.1 Make sure Ollama is running

If Ollama did not start automatically, open it or run it from another terminal.

### 9.2 Start the web server

In a terminal inside the project folder:

```powershell
python app_server.py
```

This serves the app at:

```text
http://127.0.0.1:8000
```

### 9.3 Start the inbox watcher

Open a second terminal in the same project folder and run:

```powershell
python watch_inbox_and_update_crm.py
```

This script checks chats on a schedule and updates the database with new summaries.

### 9.4 Create the first CRM entry

If your database is empty, run the one-shot ingestion script once:

```powershell
python create_crm_entry_from_latest_chat.py
```

That adds a new CRM row for the newest unlogged private chat.

## 10. Open the UI

In a browser, open:

```text
http://127.0.0.1:8000
```

You should see the dashboard and clients list populated from the SQLite database through `/api/leads`.

## 11. How Beeper integration works

The project uses the Beeper Desktop Python client, not a remote REST service.

In practice:

- Beeper Desktop must be installed and signed in
- The local access token must be stored in `.env`
- `test.py` creates the shared `client` object
- All chat-reading scripts import that shared client

If Beeper data stops loading:

- confirm Beeper Desktop is still signed in
- confirm `BEEPER_ACCESS_TOKEN` is correct
- restart the Python script

## 12. Database notes

- The database is SQLite, so no separate database server is required
- `crm.db` is created and updated locally
- The scripts automatically add missing columns when needed
- If you want a completely fresh start, delete `crm.db` and run the ingestion script again

## 13. Local files you should not commit

Keep these out of GitHub unless you intentionally want to share them:

- `.env`
- `crm.db`
- `inbox_listener_state.json`
- `latest_private_chat_summary.txt`
- `__pycache__` folders

## 14. Troubleshooting

### Python cannot import the Beeper package

Run:

```powershell
pip install beeper-desktop-api
```

### Ollama connection fails

Check that Ollama is running and reachable at `http://localhost:11434`.

### The model is too slow or fails on weak hardware

Use a smaller `OLLAMA_MODEL` value in `.env` and pull that model with Ollama.

### The web page loads but shows no data

Make sure:

- `app_server.py` is running
- the database exists
- `watch_inbox_and_update_crm.py` or `create_crm_entry_from_latest_chat.py` has already added rows

### PowerShell blocks script activation

Run this for the current terminal session:

```powershell
Set-ExecutionPolicy -Scope Process RemoteSigned
```

## 15. Typical daily workflow

1. Start Ollama
2. Start `app_server.py`
3. Start `watch_inbox_and_update_crm.py`
4. Open `http://127.0.0.1:8000`
5. Let Beeper chats sync into `crm.db`

## 16. Optional maintenance scripts

- `test_ollama_model.py` — checks if the selected model is usable
- `clear_database_entries.py` — clears local data from the database
- `reorder_customers_columns.py` — rebuilds the customers table in a consistent column order

## 17. Recommended first setup values

If you want the easiest first run on a normal laptop:

- `OLLAMA_MODEL=qwen2.5:7b`
- `OLLAMA_TIMEOUT_SECONDS=300`
- one browser window open
- Beeper Desktop already signed in

That is usually a better starting point than the default 32B model on weaker hardware.
