# OBA_Weekenthon 작업 기록

## 2026-05-30

- GitHub repo 연결 요청 확인: 예시 명령은 `taeyoung1005/GGUI_kiosk`에 `README.md` 첫 커밋 후 `main` push하는 흐름.
  - 현재 로컬은 이미 `git init` 되어 있으나 커밋과 remote는 없음.
  - `gh` active 계정은 회사 계정(`TaeyoungPark1005`)이고 개인 계정(`taeyoung1005`)도 로그인되어 있음. 개인 repo push에는 전역 계정 전환 없이 개인 토큰을 일회성으로 사용하기로 결정.
  - 사용자 확인 후 `ggui/`는 제외가 아니라 Git submodule로 기록하기로 변경. 생성 demo audio(`module-a/artifacts/`)는 재생성 가능 산출물로 제외.
  - `ggui` submodule gitlink는 `ggui-ai/ggui@619ae2ebbd6a55a5399edcca7935ec6b60275cc8`.
  - 검증: `module-a/.venv/bin/python -m unittest discover -s tests -v` 기준 15 tests OK. 시스템 Python/루트 실행은 import root 및 numpy 미설치로 실패하므로 module-a venv 기준 실행이 맞음.
  - 커밋 직후 추가 로컬 변경(`module-a` demo dashboard, `MENU_DATA_SPEC.md`) 발견. 생성 캐시가 아니라 현재 프로젝트 산출물이라 첫 push에 포함하기로 결정.

- AIHub `연령대별 특징적 발화(은어·속어 등) 음성 데이터(dataSetSn=71320)`를 이용한 오디오 기반 나이대별 음성 분류 요청 확인.
  - 데이터셋은 3,000시간 규모의 `*.wav` + JSON/SRT 라벨 구조이며, AIHub 페이지상 `Category`, `Speakers[].Agegroup`, `Dialogs[].StartTime/EndTime`, `Speakertext` 등을 포함.
  - 해커톤 데모에는 AIHub 승인/다운로드/전처리 시간이 부담이므로, 즉시 데모는 pretrained age/gender 모델 또는 rule fusion으로 만들고, AIHub 데이터는 후속 fine-tuning/evaluation 파이프라인으로 설계하는 방향이 적합.
  - 다음 결정 필요: 목표가 해커톤 데모용 빠른 프로토타입인지, 실제 AIHub 데이터 다운로드 후 fine-tuning까지 포함한 학습 파이프라인인지.
- 사용자가 목표를 "AIHub 데이터 다운로드 후 실제 학습해서 추론까지 가능하게 하는 것"으로 확정.
  - 학습 환경은 사용자 소유 4060 Ti 서버.
  - 하드웨어 추가 확인: 4060 Ti 16GB 카드 2장. 단일 모델 메모리가 자동으로 32GB가 되는 것은 아니므로, 단일 GPU 재현 가능한 학습 루프를 먼저 만들고 이후 `torchrun` DDP로 2 GPU 데이터 병렬 학습을 붙이는 방향이 적합.
  - 설계상 우선순위: AIHub 다운로드/병합 → 메타데이터 인덱싱 → 구간 클립 생성 → train/valid/test split → wav2vec2/HuBERT 계열 fine-tuning → 추론 API/CLI.
  - 4060 Ti VRAM(8GB/16GB)에 따라 모델 크기, batch size, gradient accumulation, freezing strategy가 달라짐.

- `https://github.com/Weizhena/Deep-Research-skills` 설치 요청 처리.
- Codex용 영어 스킬 세트(`skills/research-codex-en/*`)를 설치함. 중국어 세트는 같은 스킬 이름을 사용하므로 충돌 방지를 위해 설치하지 않음.
- 설치된 스킬:
  - `~/.codex/skills/research`
  - `~/.codex/skills/research-deep`
  - `~/.codex/skills/research-add-items`
  - `~/.codex/skills/research-add-fields`
  - `~/.codex/skills/research-report`
- Codex agent 파일 설치:
  - `~/.codex/agents/web-researcher.toml`
  - `~/.codex/agents/web-search-modules/*`
- `~/.codex/config.toml`에 기존 feature 설정을 보존하며 다음만 추가:
  - `suppress_unstable_features_warning = true`
  - `[features].multi_agent = true`
  - `[features].default_mode_request_user_input = true`
  - `[agents.web_researcher]`
- `pyyaml`은 이미 `6.0.3`으로 설치되어 있어 추가 설치하지 않음.
- 설치 소스 HEAD: `Weizhena/Deep-Research-skills@e5479f857f484cde13fe69d2f3ce8de7af193bc7`.
- 검증:
  - `~/.codex/config.toml` TOML 파싱 성공.
  - 5개 스킬 `SKILL.md` 존재 확인.
  - `web-researcher.toml` 및 5개 web-search module 파일 존재 확인.

## 2026-05-30 — 카트라이더 오픈월드 레이싱 기술조사 (중단·삭제)

- 카트라이더 드리프트 × 구글맵/어스 오픈월드 레이싱 아이디어를 `/research-deep`로 20항목 조사했으나, **사용자가 프로젝트를 포기**하여 산출물(`kartrider_openworld_research/` 전체)을 삭제함.
- 포기에 영향을 준 핵심 결론(향후 재검토 시 참고): ① 구글 Photorealistic 3D Tiles는 캐싱·추출·오프라인 베이크 전면 금지(ToS) → 사전생성 불가, 런타임 스트리밍은 GPU 부담 큼. ② 구글 Street View 자동 3D 복원도 ToS 위반. ③ 합법·경량 경로는 OSM 사전생성(실제 지리구조 기반 스타일라이즈드)이지만 "실사 사진" 비주얼은 안 나옴(포토리얼·경량·자동 중 둘만 가능). 사용자는 실사 수준 비주얼을 원해 포기 결정.

## 2026-05-30 — /research: 음성 기반 적응형 AI 키오스크 (GGUI + EXAONE Voice, OBA Weekend-thon S1)

- **아이디어**: "목소리 한 마디"로 사용자(어르신·아이·외국인·청년)를 인식해 UI가 자동 적응하는 AI 음성 키오스크. 사용자가 모드를 고르지 않아도 말 한마디로 큰글씨/그림중심/모국어/빠른결제 UI가 자동 전환. 타깃 트랙=GGUI(100만) + LG U+(100만, "Voice AI+EXAONE 필수").
- **파이프라인**: 마이크 → Silero VAD → STT(언어식별+전사) → 음성 연령·성별 추정 → EXAONE(의도해석·UI프롬프트) → GGUI MCP(blueprint UI 생성/렌더) → TTS(음성안내).
- **웹검증 핵심 보정 3가지**:
  1. **GGUI 실재**: `github.com/ggui-ai/ggui`(Apache 2.0), 사이트 ggui.ai, MCP `mcp.ggui.ai`/`npx ggui serve`, 출력=**blueprint**(typed data contract 바인딩 UI), React/RN 렌더러, BYOK. (추정 URL과 달랐음 → 보정)
  2. **EXAONE은 text-only(음성 모델 아님)**. 4.0=텍스트, 4.5-33B(2026-04)=비전 VLM이나 둘 다 native 오디오/STT/TTS 없음 → "Voice AI" 조건은 **외부 STT/TTS + EXAONE LLM 조합**으로 충족. LG U+ "Voice AI"=**ixi/익시오(ixi-O)** 제품군(안티딥보이스·화자식별), 공개 음성 오픈모델 제공은 미확인.
  3. **라이선스 함정**: EXAONE(1.2-NC)·audeering(CC-BY-NC-SA) 둘 다 비상업. 해커톤 데모 OK, 사업화 시 EXAONE은 **FriendliAI 상업 API**(2025-07 파트너십) 경로.
- **연령추정**: audeering/wav2vec2-large-robust-24-ft-age-gender → **zero-shot 즉시 사용(fine-tuning 불필요)**, 단 영어학습·아동/한국어 미검증(MAE 7.1~10.8년). 보정=STT 텍스트 어휘·속도 휴리스틱 룰 fusion. AIHub(노인/소아)=휴대폰 본인인증·승인지연 → 1박2일 비현실적, 사후 개선용으로만 포지셔닝.
- **누락 식별**: Silero VAD("한 마디" 발화 트리거)가 원안에 없었음 → 추가. Whisper large-v3가 LID+STT 동시라 lingua/fastText 별도 LID는 중복.
- **outline/fields**: `voice-adaptive-kiosk/outline.yaml`(14항목), `fields.yaml`(14필드: 라이선스 NC vs 상업 분기, latency_budget, 타깃 인구별 정확도, data_access_barrier, track_requirement_mapping, fallback_degradation, privacy_ondevice 등). 실행=batch_size 7 / items_per_agent 2.
- **미해결(uncertain, 주최 확인 필요)**: LG U+가 행사에서 별도 STT/TTS API 제공하는지, GGUI/LG U+ 트랙 상금·필수조건 원문(oba.run 미게시 → Telegram @oba_run/등록페이지 확인), EXAONE 한국어 UI 프롬프트 품질, audeering 한국어/아동 실측 정확도.
- **상태**: Step 1~5 완료(프레임워크 확정 → 웹검색 보강 → outline/fields 생성). 다음 단계는 `/research-deep`(14항목 심층 조사) 또는 바로 빌딩.
- SSH 서버 확인: taeyoung4060ti@192.168.123.104, key=/Users/taeyoungpark/.ssh/my-key.pem. 패스워드는 MEMORY.md에 기록하지 않음.
  - 현재 로컬에는 `/Users/taeyoungpark/.ssh/my-key.pem` 파일이 없고, `192.168.123.104:22` 접속은 timeout 발생. 같은 네트워크/VPN 또는 올바른 키 경로 확인 필요.
  - 새 전용 SSH 키 생성: `/Users/taeyoungpark/.ssh/oba_4060ti_ed25519` (`ed25519`, comment `oba-weekenthon-4060ti-2026-05-30`).
  - `~/.ssh/config`에 `Host oba-4060ti` 추가: Tailscale IP `100.117.133.18`, user `taeyoung4060ti`, identity file `~/.ssh/oba_4060ti_ed25519`.
  - Tailscale status/ping은 서버 `100.117.133.18`에 정상(`pong`, 약 8-9ms)이나 `22/tcp`는 timeout. 2222/2022/8022도 timeout. `tailscale nc` proxy도 SSH banner exchange timeout.
  - `sshpass`는 로컬에 설치돼 있으나, 현재는 인증 실패가 아니라 TCP timeout이므로 password 방식으로도 접속 불가. 새 public key를 서버 `authorized_keys`에 아직 등록하지 못함.
  - ※ 이 서버(`taeyoung4060ti`, RTX 4060 Ti 추정)가 **Module A(AI 추론 서버)** 가 돌 원격 개인 GPU 서버로 보임.
- 원격 AIHub 학습 파이프라인 진행:
  - `ssh oba-4060ti` 키 인증 복구 완료. 비밀번호는 파일에 기록하지 않음.
  - `module-a/` 생성: FastAPI `/analyze`, STT 래퍼, age classifier, behavioral scoring, AIHub download/index/clip/split/train/eval-export 스크립트.
  - `contracts/analyze.schema.json` 생성. `module-a` 로컬/원격 `py_compile` 통과.
  - 서버 `nvidia-smi` 실패 원인 확인: 부팅 커널 `6.17.0-23-generic`과 설치된 NVIDIA 모듈 `6.17.0-22` 불일치.
  - `apt-get update` 후 `6.17.0-29-generic` 커널 및 `nvidia-driver-580-open 580.159.03`, `linux-modules-nvidia-580-open-6.17.0-29-generic` 설치 완료.
  - 서버 reboot 수행. reboot 후 Tailscale node가 offline 상태라 원격 Python 환경 설치, AIHub 다운로드, 학습 실행은 SSH 복귀 대기 중.
  - `training/02_index.py`, `training/04_split.py`를 synthetic AIHub-shaped JSON으로 로컬 검증 완료.
  - speaker-level split을 강화하고 `training/validate_manifest.py` 추가. split manifest의 missing audio, 최소 row 수, speaker leakage를 학습 전 검증.
  - `module-a/tests/test_manifest_pipeline.py` 추가. `python3 -m unittest discover -s module-a/tests -v` 통과.
  - AIHub shell 공식 흐름에 맞춰 `training/01_download.py`를 `--dataset-key 71320 --list-only` 파일목록 조회와 `-mode d -datasetkey 71320 -aihubapikey` 다운로드에 맞게 정리.
  - 서버 복귀 후 재개용 스크립트 추가: `voice-adaptive-kiosk/remote/resume_module_a.sh`.
  - 재확인: Tailscale status는 서버를 `offline, last seen 9m ago`로 표시. `tailscale ping 100.117.133.18` no reply, `ssh oba-4060ti` timeout. 물리 서버 부팅/콘솔 확인 전에는 원격 다운로드·학습 진행 불가.
  - 진행 상태 문서: `voice-adaptive-kiosk/remote/REMOTE_STATUS.md`.
- 로컬 API 서버 전환:
  - `tiantiaf/wavlm-large-age-sex`를 `AGE_MODEL_PROVIDER=wavlm_age_sex`로 쓰는 public age model provider 구현.
  - Vox-Profile 공식 예제처럼 16kHz mono audio를 15초 cap 후 `WavLMWrapper.from_pretrained("tiantiaf/wavlm-large-age-sex")`로 추론, `age_output * 100`을 10/20/30/40/50+로 매핑.
  - Python 3.11 venv `module-a/.venv` 구성, public age dependencies 설치, Vox-Profile repo는 `module-a/vendor/vox-profile-release`에 clone해 import path 연결.
  - `STT_MODEL=none` no-op STT mode 추가. 발표용 나이/assist demo에서 Whisper 다운로드 없이 `/analyze` 가능.
  - 로컬 서버 실행 확인: `http://127.0.0.1:8000`, `/health` OK, `/analyze` synthetic wav 응답 OK. warm path latency 약 0.18s(MPS, synthetic 3초 wav).
- ElevenLabs demo voice 생성 추가:
  - `/demo/random-age-voice`, `/demo/random-age-voice/audio` 추가. age_group(10/20/30/40/50+)과 language(ko/en) 기반으로 preset voice/text 선택 후 ElevenLabs TTS 생성.
  - API key 권한은 Text to Speech Access가 필수, Voices Read는 account voice ID 확인 시 유용. Voice Generation/Voices Write는 현재 fallback에는 불필요.
  - 현재 키 quota가 46 credits 남아 긴 영어 문장은 quota_exceeded 발생. 짧은 `"Latte, please."`는 생성 성공.
  - 50+ preset voice `pNInz6obpgDQGcFmaJgB` 테스트: 한국어 문장 → `/analyze` 40대(44.84y), 영어 짧은 문장 → 50+(65.24y). 영어 기반 모델이라 한국어 합성 음성은 흔들림 확인.
  - 재현 스크립트: `module-a/scripts/test_elevenlabs_age_demo.sh`.

## 2026-05-30 — 음성 적응형 키오스크: 컨셉·모듈 아키텍처 확정 (대화 누적)

- **타깃**: 한국인 디지털 취약층(50대+, 데모는 어르신 시연). 외국인·아이 제외(아이=키높이/하드웨어 문제라 SW로 못 풂).
- **메리트 헤드라인 재정의**: "음성으로 나이 감지"(약한 다리)가 아니라 **"말 한마디 → 추천 → 적응 UI → 결제 완료까지 작동하는 완결 시스템"**. 베이스("GGUI로 화자 맞춤 UI")는 GGUI 개발자가 제시한 뻔한 빌드라 차별화 필수. **일반 키오스크 UI + GGUI 적응 UI 이중구조의 before/after 대조**가 메리트 증명.
- **EXAONE 제거**: LG U+ 트랙 포기, GGUI 트랙 집중. 두뇌는 GGUI가 쓰는 **Claude가 겸임**(라떼 매칭·추천+UI생성 한 번에) → 단순화.
- **적응 신호**: 행동신호(속도·침묵·채움말 → assist_level 0~3)가 **주**(학습/데이터 0이라 스파인), 나이분류는 보조. "느림·머뭇"은 파일길이가 아니라 VAD+STT타임스탬프 기반.
- **나이 모델**: audeering wav2vec2(zero-shot, 영어기반) + **AIHub dataSetSn=71320 "연령대별 특징적 발화"로 한국어 probe**(데이터 승인 완료). 단 최상단이 "50대 이상"이라 60+ 분리 불가 → 타깃 "50+"로 재정의해 정합. probe=frozen 백본+이진("50+ vs 이하"), 수십 분.
- **메뉴 데이터**: 캐치테이블(API Fuse)=예약·리뷰 중심이라 부적합 → **직접 시드 JSON(실제 식당 1곳)** 으로 시작, 시간되면 API Fuse 요기요. 크롤링 비추.
- **모듈 분리** (→ `voice-adaptive-kiosk/PLAN.md`, API 계약 중심 병렬 개발):
  - **A: AI 추론 서버(★원격 GPU=taeyoung4060ti)** — FastAPI, STT(faster-whisper)+나이분류+행동신호, `POST /analyze`. 오프라인 probe 학습도 여기.
  - B: 메뉴/주문 백엔드 — SQLite/JSON, `GET /menu`·`POST /orders`(mock 결제).
  - C: GGUI 적응 UI 생성 — Node+@ggui-ai+Claude, `POST /generate-ui`→embed_url.
  - D: 웹 프론트 — React+@ggui-ai/react, 일반UI+GGUI UI 2종, 마이크, 흐름 제어.
- **빌드 순서**: D+mock → C단독(프롬프트→UI) → A(/analyze 원격) → 결선 → 완결(옵션·mock결제·TTS·멀티턴).
- **상태**: 아키텍처/모듈 계약 확정. 다음 = 각 모듈 스캐폴딩 착수.

## 2026-05-30 — 음성 적응형 키오스크 파이프라인 이미지 생성

- `voice-adaptive-kiosk/PIPELINE.md`를 기반으로 imagegen 스킬/내장 이미지 생성 도구를 사용해 파이프라인 인포그래픽을 생성.
- 이미지 구성: 중앙 런타임 흐름(발화→캡처→Module A 분석→Module C GGUI→Module D 렌더/TTS→mock 결제), 좌측 오프라인 학습 파이프라인, 우측 배포 경계.
- 저장 경로: `voice-adaptive-kiosk/assets/voice-adaptive-kiosk-pipeline.png`.
- 생성 이미지 검증: PNG 1672×941, 런타임/오프라인 학습/배포 경계가 분리되어 표시됨.
