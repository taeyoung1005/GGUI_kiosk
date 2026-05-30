from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="./data/smoke")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    raw_dir = out_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    sr = 16000
    duration = 2.0
    samples = np.linspace(0, duration, int(sr * duration), endpoint=False)

    speakers = [
        ("spk10", "10대", 220.0),
        ("spk20", "20대", 260.0),
        ("spk30", "30대", 300.0),
        ("spk40", "40대", 340.0),
        ("spk50", "50대", 180.0),
    ]
    for idx, (speaker_id, age_group, freq) in enumerate(speakers):
        wav = 0.1 * np.sin(2 * np.pi * freq * samples)
        audio_path = raw_dir / f"sample_{idx}.wav"
        json_path = raw_dir / f"sample_{idx}.json"
        sf.write(audio_path, wav, sr)
        payload = {
            "MediaUrl": audio_path.name,
            "Speakers": [{"SpeakerID": speaker_id, "Agegroup": age_group}],
            "Dialogs": [
                {
                    "SpeakerID": speaker_id,
                    "StartTime": 0.0,
                    "EndTime": duration,
                    "SpeakerText": "라떼 하나 주세요",
                }
            ],
        }
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(raw_dir)


if __name__ == "__main__":
    main()
