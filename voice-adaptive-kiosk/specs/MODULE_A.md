# MODULE_A - Voice Analyze API

Module A is the FastAPI API server on port `8000`.

Current scope:

- `POST /analyze`: audio file -> transcript, rough age group, behavioral assist signal
- `GET /health`: runtime readiness
- `/demo/random-age-voice`, `/demo/random-age-voice/audio`,
  `/demo/generate-and-analyze`, `/demo/announcer-voice/audio`: internal demo
  helpers
- `/demo/korean-senior-proxy/analyze`: Korean order text -> validated senior
  OpenAI English translation -> validated senior English proxy voice ->
  age/behavioral analysis for the live kiosk flow

Removed scope:

- no `/demo` web page
- no `/demo/batch-summary` artifact endpoint
- no `artifacts/` validation dashboard data
- no AIHub training scripts
- no local fine-tuned checkpoint directory
- no standalone `tools/voicegen`

## Runtime

```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk/module-a
PYTHON=.venv/bin/python ./run_local.sh
```

Environment:

```bash
AGE_MODEL_PROVIDER=wavlm_age_sex
AGE_DEVICE=
STT_MODEL=whisper-1
STT_LANGUAGE=ko
STT_DEVICE=cpu
STT_COMPUTE_TYPE=int8
API_KEY=
OPENAI_API_KEY=
ORDER_TRANSLATION_MODEL=gpt-4.1-mini
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

`AGE_MODEL_PROVIDER=wavlm_age_sex` loads the public pretrained
`tiantiaf/wavlm-large-age-sex` model through the vendored Vox-Profile repo at
`module-a/vendor/vox-profile-release`.

## Contract

`POST /analyze` returns the shared `AnalyzeResult` shape from
`contracts/types.ts` and `contracts/schemas.py`.

Age groups are broad Vox-Profile groups:

- `young_adult`: under 30
- `adult`: 30-60
- `senior_adult`: over 60

`behavioral.assist_level` remains the primary adaptive signal. Age is a rough
secondary signal, not a precise classifier.

## Verification

```bash
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m py_compile app.py inference/*.py tests/*.py scripts/*.py
```
