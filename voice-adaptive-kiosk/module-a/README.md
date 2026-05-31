# Module A - Voice Analyze API

Module A is the FastAPI service for the kiosk demo. It is API-only: no `/demo`
web page, no local fine-tuned checkpoint, and no AIHub training path.

Current runtime path:

- STT: OpenAI Audio Transcriptions API by default (`STT_MODEL=whisper-1`,
  `STT_LANGUAGE=ko`)
- order translation: OpenAI Responses API (`ORDER_TRANSLATION_MODEL`,
  default `gpt-4.1-mini`) for Korean senior proxy text
- age signal: public pretrained `tiantiaf/wavlm-large-age-sex`
- voice demo helpers: ElevenLabs preset generation and Korean senior proxy
- main product surface: Module D kiosk UI

## Setup

```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk/module-a
python3.11 -m venv .venv
.venv/bin/python -m pip install --upgrade pip wheel
.venv/bin/python -m pip install -r requirements-public-age.txt
git clone https://github.com/tiantiaf0627/vox-profile-release.git vendor/vox-profile-release
```

If `.venv` was moved from another path, avoid executing `.venv/bin/uvicorn`
directly because its shebang may still point to the old location. Use
`.venv/bin/python -m uvicorn ...` or `PYTHON=.venv/bin/python ./run_local.sh`.

## Run

```bash
export OPENAI_API_KEY='...'
export ELEVENLABS_API_KEY='...'
PYTHON=.venv/bin/python ./run_local.sh
```

Useful checks:

```bash
curl -s http://127.0.0.1:8000/health | .venv/bin/python -m json.tool
curl -s http://127.0.0.1:8000/demo/voice-presets | .venv/bin/python -m json.tool
```

## Demo APIs

Generate a preset voice payload:

```bash
curl -s -X POST http://127.0.0.1:8000/demo/random-age-voice \
  -H 'content-type: application/json' \
  -d '{"age_group":"senior_adult","gender":"female","language":"ko","seed":1}' \
  | .venv/bin/python -m json.tool
```

Generate audio and analyze it:

```bash
curl -s -X POST http://127.0.0.1:8000/demo/generate-and-analyze \
  -H 'content-type: application/json' \
  -d '{"age_group":"senior_adult","gender":"female","language":"ko","text":"아이스 라떼 하나랑 쿠키 하나 주문할게요.","seed":1}' \
  | .venv/bin/python -m json.tool
```

Analyze an existing audio file:

```bash
curl -s -F file=@sample.mp3 http://127.0.0.1:8000/analyze | .venv/bin/python -m json.tool
```

Korean senior proxy route used by the live kiosk flow:

This route translates the Korean text to English before ElevenLabs synthesis,
so `OPENAI_API_KEY` must be set for real-mode use.

```bash
curl -s -X POST http://127.0.0.1:8000/demo/korean-senior-proxy/analyze \
  -H 'content-type: application/json' \
  -d '{"text":"아이스 바닐라 라떼 큰 사이즈로 포장해주세요","gender":"female"}' \
  | .venv/bin/python -m json.tool
```

## Tests

```bash
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m py_compile app.py inference/*.py tests/*.py scripts/*.py
```
