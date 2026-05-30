from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from common import normalize_age_group, read_json, to_seconds, write_jsonl


AUDIO_SUFFIXES = {".wav", ".mp3", ".flac", ".m4a", ".ogg"}


def first_value(data: dict[str, Any], keys: tuple[str, ...]) -> Any:
    lowered = {str(k).lower(): v for k, v in data.items()}
    for key in keys:
        if key in data:
            return data[key]
        if key.lower() in lowered:
            return lowered[key.lower()]
    return None


def build_audio_index(root: Path) -> dict[str, Path]:
    index: dict[str, Path] = {}
    for path in root.rglob("*"):
        if path.suffix.lower() in AUDIO_SUFFIXES:
            index[path.name] = path
            index[path.stem] = path
    return index


def speakers_by_id(data: dict[str, Any], class_mode: str) -> dict[str, str]:
    speakers = first_value(data, ("Speakers", "Speaker", "speakers", "speaker")) or []
    if isinstance(speakers, dict):
        speakers = list(speakers.values())
    result: dict[str, str] = {}
    for speaker in speakers:
        if not isinstance(speaker, dict):
            continue
        speaker_id = first_value(speaker, ("SpeakerID", "SpeakerId", "Speaker", "ID", "id", "name"))
        age = first_value(speaker, ("Agegroup", "AgeGroup", "agegroup", "화자연령대", "연령대", "age"))
        label = normalize_age_group(age, class_mode)
        if speaker_id is not None and label:
            result[str(speaker_id)] = label
    return result


def resolve_audio(data: dict[str, Any], json_path: Path, audio_index: dict[str, Path]) -> Path | None:
    candidates: list[str] = []
    for key in ("MediaUrl", "mediaUrl", "AudioPath", "audioPath", "FileName", "filename", "Wav", "wav"):
        value = first_value(data, (key,))
        if value:
            candidates.append(str(value))
    candidates.append(json_path.with_suffix(".wav").name)
    candidates.append(json_path.stem)

    for candidate in candidates:
        name = Path(candidate).name
        stem = Path(candidate).stem
        if name in audio_index:
            return audio_index[name]
        if stem in audio_index:
            return audio_index[stem]
    return None


def index_json(json_path: Path, audio_index: dict[str, Path], class_mode: str) -> list[dict[str, Any]]:
    data = read_json(json_path)
    if not isinstance(data, dict):
        return []
    audio_path = resolve_audio(data, json_path, audio_index)
    if audio_path is None:
        return []

    speaker_labels = speakers_by_id(data, class_mode)
    dialogs = first_value(data, ("Dialogs", "dialogs", "Utterances", "utterances", "segments")) or []
    if isinstance(dialogs, dict):
        dialogs = list(dialogs.values())

    rows: list[dict[str, Any]] = []
    for idx, dialog in enumerate(dialogs):
        if not isinstance(dialog, dict):
            continue
        speaker_id = first_value(dialog, ("SpeakerID", "SpeakerId", "Speaker", "speaker", "speaker_id"))
        label = speaker_labels.get(str(speaker_id)) if speaker_id is not None else None
        if not label and len(set(speaker_labels.values())) == 1:
            label = next(iter(speaker_labels.values()))
        start = to_seconds(first_value(dialog, ("StartTime", "startTime", "start", "begin", "시작시간")))
        end = to_seconds(first_value(dialog, ("EndTime", "endTime", "end", "finish", "종료시간")))
        text = first_value(dialog, ("SpeakerText", "Speakertext", "text", "Text", "발화", "전사"))
        if not label or start is None or end is None or end <= start:
            continue
        rows.append(
            {
                "id": f"{json_path.stem}_{idx:05d}",
                "json_path": str(json_path),
                "audio_path": str(audio_path),
                "speaker_id": str(speaker_id) if speaker_id is not None else "",
                "age_group": label,
                "start": round(float(start), 3),
                "end": round(float(end), 3),
                "duration": round(float(end - start), 3),
                "text": str(text or ""),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", default="./data/aihub/raw")
    parser.add_argument("--out", default="./data/manifests/raw_segments.jsonl")
    parser.add_argument("--class-mode", default="multiclass", choices=["multiclass", "binary_50plus"])
    parser.add_argument("--limit-json", type=int, default=0)
    args = parser.parse_args()

    data_root = Path(args.data_root)
    audio_index = build_audio_index(data_root)
    json_paths = list(data_root.rglob("*.json"))
    if args.limit_json:
        json_paths = json_paths[: args.limit_json]

    rows: list[dict[str, Any]] = []
    for idx, json_path in enumerate(json_paths, start=1):
        rows.extend(index_json(json_path, audio_index, args.class_mode))
        if idx % 1000 == 0:
            print(f"indexed {idx}/{len(json_paths)} json files; rows={len(rows)}")

    write_jsonl(Path(args.out), rows)
    print(f"wrote {len(rows)} rows to {args.out}")


if __name__ == "__main__":
    main()
