from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


MULTICLASS_LABELS = ["10대", "20대", "30대", "40대", "50+"]
BINARY_LABELS = ["under50", "50+"]


def read_json(path: Path) -> Any:
    for encoding in ("utf-8", "utf-8-sig", "cp949"):
        try:
            return json.loads(path.read_text(encoding=encoding))
        except UnicodeDecodeError:
            continue
    return json.loads(path.read_text())


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fp:
        for row in rows:
            fp.write(json.dumps(row, ensure_ascii=False) + "\n")


def iter_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if line:
                yield json.loads(line)


def normalize_age_group(value: Any, class_mode: str = "multiclass") -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    text = text.replace(" ", "")
    if not text:
        return None

    if re.search(r"50|60|70|80|90|노년|고령|장년", text):
        return "50+"
    for label in ("10대", "20대", "30대", "40대"):
        if label in text:
            return "under50" if class_mode == "binary_50plus" else label
    match = re.search(r"([1-9][0-9])", text)
    if match:
        age = int(match.group(1))
        if age >= 50:
            return "50+"
        decade = f"{age // 10}0대"
        return "under50" if class_mode == "binary_50plus" else decade
    return None


def label_list(class_mode: str) -> list[str]:
    return BINARY_LABELS if class_mode == "binary_50plus" else MULTICLASS_LABELS


def to_seconds(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number / 1000.0 if number > 10000 else number
    text = str(value).strip()
    if not text:
        return None
    if ":" in text:
        parts = [float(part.replace(",", ".")) for part in text.split(":")]
        total = 0.0
        for part in parts:
            total = total * 60 + part
        return total
    try:
        number = float(text.replace(",", "."))
        return number / 1000.0 if number > 10000 else number
    except ValueError:
        return None
