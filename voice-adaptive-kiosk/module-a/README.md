# Module A - Realtime Token API

Module A is the small FastAPI backend used by the kiosk frontend.

Current runtime surface:

- `GET /health`
- `POST /realtime/session`: issues a short-lived OpenAI Realtime client secret with audio output enabled

Module A no longer provides audio upload STT. The browser connects to OpenAI
Realtime with the ephemeral token from `/realtime/session`. The Realtime model
listens, speaks through the WebRTC audio track, and calls frontend tools that
drive the kiosk state machine.

## Setup

```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk/module-a
python3.11 -m venv .venv
.venv/bin/python -m pip install --upgrade pip wheel
.venv/bin/python -m pip install -r requirements.txt
```

If `.venv` was moved from another path, avoid executing `.venv/bin/uvicorn`
directly because its shebang may still point to the old location. Use
`.venv/bin/python -m uvicorn ...` or `PYTHON=.venv/bin/python ./run_local.sh`.

## Run

The API reads `OPENAI_API_KEY` and Realtime settings from the project root
`.env` / `.env.local`, or from shell exports.

```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk
cp .env.example .env
# fill OPENAI_API_KEY in .env
cd module-a
PYTHON=.venv/bin/python ./run_local.sh
```

Optional OpenAI Realtime assistant voice:

```bash
export OPENAI_REALTIME_VOICE='alloy'
```

Useful checks:

```bash
curl -s http://127.0.0.1:8000/health | .venv/bin/python -m json.tool
curl -s -X POST http://127.0.0.1:8000/realtime/session | .venv/bin/python -m json.tool
```

## Tests

```bash
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m py_compile app.py tests/*.py
```
