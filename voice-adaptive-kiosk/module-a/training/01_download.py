"""01_download.py — AIHub 71320 "연령대별 특징적 발화" 다운로드·병합.

원격 GPU 전용. 실행 결과: $DATA_ROOT/raw/ 아래에 압축 해제된 오디오 + 라벨(JSON).

전제:
- AIHub 71320 다운로드 승인 완료(데이터셋 sn=71320).
- AIHub CLI(aihubshell) 또는 계정 토큰 기반 다운로드 권한.

라벨 구조(요지):
- Speakers[].Agegroup  : 화자 연령대 라벨 → 이진 "50+ vs under50" 변환의 근거.
- Dialogs[].StartTime/EndTime : 발화 구간(클립 추출에 사용, 03_clips.py).

실행:
    python training/01_download.py

코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

DATASET_SN = os.getenv("AIHUB_DATASET_SN", "71320")
DATA_ROOT = Path(os.getenv("DATA_ROOT", "./training/data"))
RAW_DIR = DATA_ROOT / "raw"


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    aihub_id = os.getenv("AIHUB_ID")
    aihub_key = os.getenv("AIHUB_KEY")

    # ──────────────────────────────────────────────────────────
    # TODO(다운로드): AIHub 공식 다운로드 방식 택1
    #
    # (A) aihubshell CLI (권장):
    #     설치: pip install aihubshell  (또는 AIHub 제공 스크립트)
    #     인증: aihubshell -mode l -id $AIHUB_ID -pass $AIHUB_KEY
    #     목록: aihubshell -mode d -datasetkey 71320 -filekey all
    #     예시:
    #         cmd = ["aihubshell", "-mode", "d",
    #                "-datasetkey", DATASET_SN, "-filekey", "all"]
    #         subprocess.run(cmd, cwd=RAW_DIR, check=True)
    #
    # (B) AIHub Open API (HTTP):
    #     토큰 발급 후 file manifest 순회 → requests 로 청크 다운로드.
    #     대용량(3,000h)이므로 resume(이어받기) + 체크섬 검증 필수.
    #
    # 주의:
    # - 71320 은 매우 큼(수백 GB). 디스크/네트워크 사전 점검.
    # - 50+ 슬라이스만 우선 받고(샘플), 균형 맞춰 under50 추가 → 빠른 1차 학습.
    # ──────────────────────────────────────────────────────────
    if not (aihub_id and aihub_key):
        print(
            "[01_download] AIHUB_ID/AIHUB_KEY 미설정 — TODO 구현 후 실행하세요.\n"
            "  .env 에 AIHUB_ID, AIHUB_KEY, AIHUB_DATASET_SN=71320 설정.",
            file=sys.stderr,
        )
        return

    # TODO: 위 (A)/(B) 중 하나를 구현하여 RAW_DIR 채우기.
    #       아래는 자리표시자(실제 명령으로 교체).
    print(f"[01_download] (TODO) dataset sn={DATASET_SN} → {RAW_DIR}")

    # ──────────────────────────────────────────────────────────
    # TODO(병합): 분할 압축(zip.001, .z01 …) 병합 + 해제.
    #     예: zip -s 0 split.zip --out merged.zip; unzip merged.zip
    # TODO(정리): 오디오(wav/pcm)와 라벨(json)을 일관된 트리로 정리:
    #     RAW_DIR/audio/*.wav , RAW_DIR/labels/*.json
    # ──────────────────────────────────────────────────────────


if __name__ == "__main__":
    main()
