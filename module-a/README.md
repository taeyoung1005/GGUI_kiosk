# Module A — Voice Analysis and Age Classification

This module implements the portable `/analyze` service and the remote-only
AIHub 71320 age classifier training pipeline.

## Remote Setup

```bash
cd ~/oba-weekenthon/module-a
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements.txt
```

## AIHub Download

AIHub uses `aihubshell` and requires both dataset approval and an API key.

```bash
export AIHUB_API_KEY='...'
python training/01_download.py --list-only
python training/01_download.py --dataset-key 71320 --list-only
python training/01_download.py --dataset-key 71320
```

The script downloads the official `aihubshell` from
`https://api.aihub.or.kr/api/aihubshell.do`.

## Pipeline

```bash
python training/02_index.py --data-root ./data/aihub/raw --out ./data/manifests/raw_segments.jsonl
python training/03_clips.py --manifest ./data/manifests/raw_segments.jsonl --out-dir ./data/clips --out-manifest ./data/manifests/clips.jsonl
python training/04_split.py --manifest ./data/manifests/clips.jsonl --out-dir ./data/manifests
python training/05_train.py --train ./data/manifests/train.jsonl --valid ./data/manifests/valid.jsonl --output-dir ./runs/age-wav2vec2
python training/06_eval_export.py --test ./data/manifests/test.jsonl --checkpoint ./runs/age-wav2vec2 --export-dir ./models/age_model
```

For 2 GPU training:

```bash
torchrun --nproc_per_node=2 training/05_train.py --train ./data/manifests/train.jsonl --valid ./data/manifests/valid.jsonl --output-dir ./runs/age-wav2vec2
```

## API

```bash
source .venv/bin/activate
export AGE_MODEL_PROVIDER=wavlm_age_sex
uvicorn app:app --host 0.0.0.0 --port 8000
curl -H "Authorization: Bearer $API_KEY" -F file=@sample.wav http://localhost:8000/analyze
```

## Local Public Age Model Mode

For the demo fallback, use the public Vox-Profile model
`tiantiaf/wavlm-large-age-sex` instead of a locally trained AIHub checkpoint:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements-public-age.txt
git clone https://github.com/tiantiaf0627/vox-profile-release.git vendor/vox-profile-release
AGE_MODEL_PROVIDER=wavlm_age_sex ./run_local.sh
```

The first request downloads the model weights. The model expects 16kHz mono
audio and internally caps input to 15 seconds, matching the upstream example.

## ElevenLabs Demo Voice Generation

The live demo can generate random preset TTS samples by age bucket:

```bash
export ELEVENLABS_API_KEY='...'
AGE_MODEL_PROVIDER=wavlm_age_sex STT_MODEL=none ./run_local.sh

curl -X POST http://127.0.0.1:8000/demo/random-age-voice \
  -H 'content-type: application/json' \
  -d '{"age_group":"50+","language":"en","seed":1}'

curl -X POST http://127.0.0.1:8000/demo/random-age-voice/audio \
  -H 'content-type: application/json' \
  -d '{"age_group":"50+","language":"en","seed":1,"text":"Latte, please."}' \
  -o sample.mp3
```

API key permissions:

- Required: Text to Speech access.
- Useful: Voices read access, if you want to inspect account voice IDs.
- Not required for this fallback: Voice Generation or Voices write access.

For stronger age impressions, override the default voice map with account voice
IDs:

```bash
export ELEVENLABS_AGE_VOICE_MAP_JSON='{"10대":["..."],"20대":["..."],"30대":["..."],"40대":["..."],"50+":["..."]}'
```

Smoke test Korean and English samples:

```bash
scripts/test_elevenlabs_age_demo.sh
```
