from __future__ import annotations

import argparse
import csv
import json
import random
import time
from pathlib import Path
from typing import Any

import requests


DECADES = [f"{decade}대" for decade in range(0, 100, 10)]
GENDERS = ["female", "male"]
LANGUAGES = ["en", "ko"]

EN_PROMPTS = [
    "I would like a latte, please.",
    "Can you help me choose a drink?",
    "One hot coffee, please.",
    "I need a simple recommendation.",
    "Please show me the menu slowly.",
    "I want something not too sweet.",
    "Can I order this one?",
    "Please make it iced.",
    "I would like to pay now.",
    "Can you repeat that for me?",
]

KO_PROMPTS = [
    "라떼 하나 주세요.",
    "음료 추천해 주세요.",
    "따뜻한 커피 한 잔 주세요.",
    "간단하게 추천해 주세요.",
    "메뉴를 천천히 보여 주세요.",
    "너무 달지 않은 걸로 주세요.",
    "이걸로 주문할게요.",
    "차가운 걸로 해 주세요.",
    "이제 결제할게요.",
    "다시 한 번 말해 주세요.",
]


def make_prompt(decade: str, language: str, index: int, gender: str = "female") -> str:
    prompts = KO_PROMPTS if language == "ko" else EN_PROMPTS
    base = prompts[index % len(prompts)]
    if language == "ko":
        return f"{decade} {gender} 테스트 음성입니다. {base}"
    return f"This is a {gender} speaker in their {decade.replace('대', 's')}. {base}"


def age_to_decade(years_est: float | None) -> str:
    if years_est is None:
        return "unknown"
    years = max(0, min(99, int(float(years_est))))
    return f"{years // 10 * 10}대"


def expected_match(expected_decade: str, predicted_decade: str) -> bool:
    return expected_decade == predicted_decade


def post_json(base_url: str, path: str, payload: dict[str, Any]) -> requests.Response:
    return requests.post(f"{base_url}{path}", json=payload, timeout=90)


def run_batch(base_url: str, out_dir: Path, samples: int, language: str, seed: int, sleep_sec: float) -> Path:
    rng = random.Random(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    per_decade = max(1, samples // len(DECADES))
    planned = []
    for decade in DECADES:
        for idx in range(per_decade):
            planned.append((decade, idx))
    planned = planned[:samples]

    for sample_idx, (decade, prompt_idx) in enumerate(planned, start=1):
        gender = GENDERS[(sample_idx + seed) % len(GENDERS)]
        text = make_prompt(decade, language, prompt_idx, gender)
        if decade == "0대":
            age_group_for_voice = "10대"
        elif decade in {"50대", "60대", "70대", "80대", "90대"}:
            age_group_for_voice = "50+"
        else:
            age_group_for_voice = decade
        payload = {
            "age_group": age_group_for_voice,
            "language": language,
            "seed": rng.randint(0, 1_000_000),
            "text": text,
        }
        audio_path = out_dir / f"{sample_idx:03d}_{language}_{decade}_{gender}.mp3"
        row = {
            "sample_idx": sample_idx,
            "language": language,
            "expected_decade": decade,
            "gender_prompt": gender,
            "text": text,
            "audio_path": str(audio_path),
            "status": "pending",
        }
        try:
            tts = post_json(base_url, "/demo/random-age-voice/audio", payload)
            if tts.status_code != 200:
                row.update({"status": "tts_error", "error": tts.text[:500]})
                rows.append(row)
                continue
            audio_path.write_bytes(tts.content)
            analyze = requests.post(f"{base_url}/analyze", files={"file": audio_path.open("rb")}, timeout=120)
            if analyze.status_code != 200:
                row.update({"status": "analyze_error", "error": analyze.text[:500]})
                rows.append(row)
                continue
            result = analyze.json()
            years_est = result.get("age", {}).get("years_est")
            predicted_decade = age_to_decade(years_est)
            row.update(
                {
                    "status": "ok",
                    "voice_id": tts.headers.get("x-voice-id", ""),
                    "predicted_group": result.get("age", {}).get("group", ""),
                    "years_est": years_est,
                    "confidence": result.get("age", {}).get("confidence", ""),
                    "predicted_decade": predicted_decade,
                    "match": expected_match(decade, predicted_decade),
                    "duration_ms": result.get("duration_ms", ""),
                }
            )
        except Exception as exc:
            row.update({"status": "exception", "error": repr(exc)})
        rows.append(row)
        print(f"[{sample_idx}/{len(planned)}] {row['status']} {decade} {gender} -> {row.get('predicted_decade', '-')}")
        if sleep_sec:
            time.sleep(sleep_sec)

    csv_path = out_dir / f"age_demo_batch_{language}_{samples}.csv"
    fieldnames = sorted({key for row in rows for key in row.keys()})
    with csv_path.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    ok_rows = [row for row in rows if row["status"] == "ok"]
    summary = {
        "total": len(rows),
        "ok": len(ok_rows),
        "match": sum(1 for row in ok_rows if row.get("match") is True),
        "by_expected_decade": {},
    }
    for decade in DECADES:
        decade_rows = [row for row in ok_rows if row["expected_decade"] == decade]
        summary["by_expected_decade"][decade] = {
            "ok": len(decade_rows),
            "match": sum(1 for row in decade_rows if row.get("match") is True),
            "avg_years_est": (
                round(sum(float(row["years_est"]) for row in decade_rows if row.get("years_est") != "") / len(decade_rows), 2)
                if decade_rows
                else None
            ),
        }
    (out_dir / f"age_demo_batch_{language}_{samples}_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return csv_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--out-dir", default="./artifacts/age-demo-batch")
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--language", choices=LANGUAGES, default="en")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--sleep-sec", type=float, default=0.0)
    args = parser.parse_args()
    run_batch(args.base_url, Path(args.out_dir), args.samples, args.language, args.seed, args.sleep_sec)


if __name__ == "__main__":
    main()
