# Module A - English Voice Age Demo

Module A is the local FastAPI service for the voice-adaptive kiosk demo.
The current demo path uses:

- public age model: `tiantiaf/wavlm-large-age-sex`
- Fair-Speech real recordings for validation
- English ElevenLabs TTS for synthetic voice generation
- no AIHub Korean training in the demo path
- `STT_MODEL=none` for fast age-only demo inference

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
export ELEVENLABS_API_KEY='...'
PYTHON=.venv/bin/python ./run_local.sh
```

Open the live demo dashboard:

```text
http://127.0.0.1:8000/demo
```

Useful health checks:

```bash
curl -s http://127.0.0.1:8000/health | .venv/bin/python -m json.tool
curl -s http://127.0.0.1:8000/demo/voice-presets | .venv/bin/python -m json.tool
```

## Live Demo API

Generate an English voice preset:

```bash
curl -s -X POST http://127.0.0.1:8000/demo/random-age-voice \
  -H 'content-type: application/json' \
  -d '{"age_group":"50+","gender":"female","language":"en","seed":1}' \
  | .venv/bin/python -m json.tool
```

Generate audio and analyze it in one request:

```bash
curl -s -X POST http://127.0.0.1:8000/demo/generate-and-analyze \
  -H 'content-type: application/json' \
  -d '{"target_decade":"50+","age_group":"50+","gender":"female","language":"en","text":"This is a female speaker in their 50s and older. I would like a latte, please.","seed":1}' \
  | .venv/bin/python -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ["voice_bucket","gender","voice_id","age","duration_ms"]})'
```

Analyze an existing audio file:

```bash
curl -s -F file=@sample.mp3 http://127.0.0.1:8000/analyze | .venv/bin/python -m json.tool
```

## Fair-Speech Validation

Use Fair-Speech real recordings to validate the public age model. The dataset
labels available for this path are four age bins and two genders:

- age bins: `18-22`, `23-30`, `31-45`, `46-65`
- genders: `female`, `male`
- current presentation sample: 80 = 4 age bins x 2 genders x 10

Run:

```bash
PYTHONPATH=. .venv/bin/python scripts/fairspeech_eval.py \
  --out-dir ./artifacts/fairspeech-eval-v1 \
  --per-cell 10 \
  --max-scan 6000 \
  --device cpu
```

Current verified output:

```text
artifacts/fairspeech-eval-v1/fairspeech_eval.csv
artifacts/fairspeech-eval-v1/fairspeech_eval_summary.json
```

Latest summary:

- real recordings analyzed: 80/80
- target age distribution: 20 samples per age bin
- gender distribution: female 40, male 40
- age-bin match: 29/80 (36.25%)
- predicted distribution: `18-22` 11, `23-30` 26, `31-45` 27, `46-65` 7, `outside` 9

Interpretation for the demo: this is a real-recording validation panel. The
current public model is useful as a demo signal, but the measured age-bin
accuracy is not strong enough to present as a reliable age classifier.

## Synthetic English Batch

The presentation batch is balanced by age bucket and gender:

- age buckets: `10대`, `20대`, `30대`, `40대`, `50+`
- genders: `female`, `male`
- default sample count: 100 = 5 age buckets x 2 genders x 10

Run:

```bash
.venv/bin/python scripts/age_demo_batch.py \
  --samples 100 \
  --language en \
  --out-dir ./artifacts/age-demo-balanced-en-v1 \
  --sleep-sec 0.05
```

Current verified output:

```text
artifacts/age-demo-balanced-en-v1/age_demo_batch_en_100.csv
artifacts/age-demo-balanced-en-v1/age_demo_batch_en_100_summary.json
```

Latest summary:

- generated/analyzed: 100/100
- target age distribution: 20 samples per bucket
- gender distribution: female 50, male 50
- exact target match: 42/100
- predicted decade distribution: 10대 2, 20대 18, 30대 37, 40대 14, 50대 14, 60대 4, 70대 2, 80대 9

Interpretation for the demo: this batch is only a synthetic voice metadata
probe. It should not be treated as ground-truth speaker age validation.

## Tests

```bash
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m py_compile app.py inference/*.py tests/*.py scripts/*.py
```

## Legacy AIHub Pipeline

The AIHub Korean training scripts remain in `training/` for later follow-up, but
they are not part of the current English demo path.
