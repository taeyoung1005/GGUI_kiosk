from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path


AIHUBSHELL_URL = "https://api.aihub.or.kr/api/aihubshell.do"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True)


def ensure_aihubshell(bin_path: Path) -> Path:
    if bin_path.exists():
        return bin_path
    bin_path.parent.mkdir(parents=True, exist_ok=True)
    run(["curl", "-L", "-o", str(bin_path), AIHUBSHELL_URL])
    bin_path.chmod(0o755)
    return bin_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="./data/aihub/raw")
    parser.add_argument("--dataset-key", default=os.getenv("AIHUB_DATASET_KEY", ""))
    parser.add_argument("--file-keys", default=os.getenv("AIHUB_FILE_KEYS", ""))
    parser.add_argument("--query", default=os.getenv("AIHUB_QUERY", "연령대별 특징적 발화"))
    parser.add_argument("--api-key", default=os.getenv("AIHUB_API_KEY", ""))
    parser.add_argument("--list-only", action="store_true")
    parser.add_argument("--bin", default="./bin/aihubshell")
    args = parser.parse_args()

    shell = ensure_aihubshell(Path(args.bin))
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.list_only:
        list_cmd = [str(shell), "-mode", "l"]
        if args.dataset_key:
            list_cmd.extend(["-datasetkey", args.dataset_key])
        result = subprocess.run(list_cmd, text=True, capture_output=True, check=True)
        lines = [line for line in result.stdout.splitlines() if args.query in line] if not args.dataset_key else []
        print("\n".join(lines) if lines else result.stdout)
        return

    if not args.dataset_key:
        list_cmd = [str(shell), "-mode", "l"]
        result = subprocess.run(list_cmd, text=True, capture_output=True, check=True)
        lines = [line for line in result.stdout.splitlines() if args.query in line]
        print("\n".join(lines) if lines else result.stdout)
        raise SystemExit("Set --dataset-key or AIHUB_DATASET_KEY after confirming the dataset key.")

    if not args.api_key:
        raise SystemExit("AIHUB_API_KEY is required for download mode.")

    cmd = [str(shell), "-mode", "d", "-datasetkey", args.dataset_key, "-aihubapikey", args.api_key]
    if args.file_keys:
        cmd.extend(["-filekey", args.file_keys])
    run(cmd, cwd=output_dir)

    marker = output_dir / ".download_complete"
    marker.write_text("ok\n", encoding="utf-8")

    if shutil.which("du"):
        run(["du", "-sh", str(output_dir)])


if __name__ == "__main__":
    main()
