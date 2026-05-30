#!/usr/bin/env python3
"""ElevenLabs 기반 테스트/데모 음성 생성기 (stdlib만 사용).

용도:
  - ✅ 노인 없이 파이프라인(Module A /analyze)을 테스트할 합성 발화 생성
  - ✅ 무대 사고 대비 '리플레이' 데모 오디오 (결정적 시연)
  - ⚠️ 나이 분류기 '학습' 데이터로는 쓰지 말 것 (합성↔실음성 도메인 갭).
        학습은 실제 AIHub 71320으로 (module-a/training/).

출력: samples/<persona>/<id>.wav  (16kHz mono PCM → WAV)

사용:
  export ELEVENLABS_API_KEY=sk_...
  # voices.json 의 voice_id 채우기
  python generate.py                 # phrases.json 전부 생성
  python generate.py --only elder_latte_hesitant
  python generate.py --verify        # 생성 후 각 wav를 /analyze에 넣어 결과 확인
  python generate.py --verify-only    # 이미 생성된 wav만 검증
  ANALYZE_URL=http://localhost:8000 python generate.py --verify
"""
import argparse
import base64
import json
import os
import sys
import wave
from pathlib import Path
from urllib import request, error

HERE = Path(__file__).parent


def _load_dotenv() -> None:
    """tools/voicegen/.env.local → .env 를 os.environ 에 로드(이미 set 된 값 우선)."""
    for _name in (".env.local", ".env"):
        _path = HERE / _name
        if not _path.exists():
            continue
        for _raw in _path.read_text(encoding="utf-8").splitlines():
            _line = _raw.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _v = _line.split("=", 1)
            _k, _v = _k.strip(), _v.strip()
            if (_v[:1] == '"' and _v[-1:] == '"') or (_v[:1] == "'" and _v[-1:] == "'"):
                _v = _v[1:-1]
            os.environ.setdefault(_k, _v)


_load_dotenv()

ELEVEN_URL = "https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=pcm_16000"
ANALYZE_URL = os.environ.get("ANALYZE_URL", "http://localhost:8000")


def load(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def synth(text, voice_id, settings, model_id, api_key):
    """ElevenLabs TTS → raw PCM s16le 16kHz mono bytes."""
    body = json.dumps({
        "text": text,
        "model_id": model_id,
        "voice_settings": settings,
    }).encode("utf-8")
    req = request.Request(
        ELEVEN_URL.format(vid=voice_id),
        data=body,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/pcm",
        },
        method="POST",
    )
    with request.urlopen(req, timeout=120) as resp:
        return resp.read()


def write_wav(path, pcm, rate=16000):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)        # s16
        w.setframerate(rate)
        w.writeframes(pcm)


def verify(path):
    """생성된 wav를 Module A /analyze(JSON audio_base64)에 넣어 결과 출력."""
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    body = json.dumps({"audio_base64": b64}).encode("utf-8")
    req = request.Request(
        f"{ANALYZE_URL}/analyze",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=60) as resp:
            r = json.loads(resp.read())
        age = r.get("age", {})
        beh = r.get("behavioral", {})
        return (f"transcript='{r.get('transcript','')}' "
                f"age={age.get('group')}(~{age.get('years_est')}) "
                f"assist_level={beh.get('assist_level')} "
                f"rate={beh.get('speech_rate')} fillers={beh.get('filler_count')}")
    except error.URLError as e:
        return f"[/analyze 호출 실패: {e}. Module A가 떠 있는지 확인 (uvicorn :8000)]"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="특정 phrase id만")
    ap.add_argument("--verify", action="store_true", help="생성 후 /analyze 검증")
    ap.add_argument("--verify-only", action="store_true", help="생성 생략, 기존 wav만 검증")
    args = ap.parse_args()

    phrases = load("phrases.json")["phrases"]
    vcfg = load("voices.json")
    model_id = vcfg["model_id"]
    personas = vcfg["personas"]
    api_key = os.environ.get("ELEVENLABS_API_KEY")

    if args.only:
        phrases = [p for p in phrases if p["id"] == args.only]
        if not phrases:
            sys.exit(f"phrase id '{args.only}' 없음")

    for p in phrases:
        out = HERE / "samples" / p["persona"] / f"{p['id']}.wav"
        if not args.verify_only:
            if not api_key:
                sys.exit("ELEVENLABS_API_KEY 미설정")
            pv = personas.get(p["persona"])
            if not pv or pv["voice_id"].startswith("REPLACE_"):
                sys.exit(f"voices.json 의 '{p['persona']}' voice_id 를 채우세요")
            print(f"[gen] {p['id']:28s} ({p['persona']:5s}) ← \"{p['text']}\"")
            pcm = synth(p["text"], pv["voice_id"], pv["voice_settings"], model_id, api_key)
            write_wav(out, pcm)
            print(f"      → {out.relative_to(HERE)}  ({len(pcm)//2} samples)")
        if args.verify or args.verify_only:
            if out.exists():
                print(f"[chk] {p['id']:28s} {verify(out)}")
                print(f"      expect: {p.get('expect')}")
            else:
                print(f"[chk] {p['id']:28s} (wav 없음 — 먼저 생성)")

    print("\n완료. samples/ 의 wav를 Module A /analyze나 데모 리플레이에 사용하세요.")


if __name__ == "__main__":
    main()
