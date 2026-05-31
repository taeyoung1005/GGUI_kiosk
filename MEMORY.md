# OBA_Weekenthon 작업 기록

## 2026-05-30

- 프로젝트 등록 문구 작성 요청 처리.
  - 스폰서 트랙은 **GGUI**로 확정.
  - 현재 프로젝트 맥락은 `voice-adaptive-kiosk`: 50+ 디지털 취약층을 위한 음성 기반 적응형 키오스크.
  - 등록명 후보 중 제출용 기본안은 **한마디 키오스크**로 제안. 핵심 메시지는 "말 한마디로 사용자의 도움 필요도를 감지하고 GGUI로 주문 화면을 즉시 바꿔 결제까지 완주시키는 키오스크".
  - GitHub URL은 현재 remote 기준 `https://github.com/taeyoung1005/GGUI_kiosk.git`.
  - 사용자 피드백: 핵심 킥은 "연령대에 맞는 UI를 보여주는 것"이므로 한줄 소개와 주요 문항에서 이 표현을 전면에 배치해야 함.
  - 추가 피드백: 프로젝트명도 "한마디"보다 연령대별 UI 자동 전환이 드러나는 이름으로 수정 필요. 후보는 **에이지핏 키오스크**, **세대맞춤 키오스크**, **나이핏 키오스크**.
  - 추가 피드백: Q1 "어떤 문제를 해결하나요?"는 일반 키오스크 불편함보다 **연령대별로 필요한 UI가 다른데 모든 사용자에게 같은 UI를 강요하는 문제**를 명확히 써야 함.

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

## 2026-05-30 — ElevenLabs 영어 100개 연령대 배치 결과

- 데모용 영어 배치 100개 완료: 입력 타깃은 0대~90대 각 10개, 성별 프롬프트는 male/female 각 50개.
- 저장 위치: `module-a/artifacts/age-demo-batch-en-v2/age_demo_batch_en_100.csv`, summary=`module-a/artifacts/age-demo-batch-en-v2/age_demo_batch_en_100_summary.json`.
- 실행 상태: 100/100 ok. 기존 중단 실행에서 생성된 MP3 66개를 재사용하고, 나머지 34개만 새로 생성하도록 `age_demo_batch.py`를 보강함.
- 예측 분포는 균등하지 않음: predicted_decade 40대=50, 50대=34, 30대=8, 20대=4, 60대=4. 정확히 target decade와 일치한 건 7/100.
- 해석: ElevenLabs 기본 voice ID는 실제 연령 통제력이 약하고, `tiantiaf/wavlm-large-age-sex`는 합성 음성에서 40~50대 쪽으로 강하게 몰림. 발표에서는 "target age voice generation"과 "model prediction"을 분리해서 보여주는 것이 안전함.

## 2026-05-30 — Module B 메뉴 데이터 명세 검수

- 범위는 `voice-adaptive-kiosk/module-b/data/menu.seed.json`과 `module-b/public/img/menu/*.svg`로 제한. `contracts/types.ts`와 `module-b/server.js`는 변경 금지로 유지.
- `MENU_DATA_SPEC.md`와 `contracts/types.ts` 기준으로 현재 seed를 검수. 항목 수 20개, latte 후보 7개, SVG 20개는 충족.
- 발견한 보완점: 음료 옵션 요구(`Temperature` Hot/Iced)에 비해 `espresso-002`, `peach-iced-tea-013`, `lemon-ade-014`, `grapefruit-ade-015`, `strawberry-smoothie-016`에 `Temperature`가 없었음.
- 조치: 위 5개 항목에 `Temperature` 옵션(Hot/Iced, price_delta 0)을 추가. SVG 파일명/경로는 기존 `image_url`과 모두 정합.

## 2026-05-30 — Module B 메뉴 SVG를 imagegen 기반 미디어로 교체

- 사용자 피드백: 이미지/미디어 산출은 단순 SVG placeholder 직접 작성이 아니라 `imagegen` 스킬을 사용해야 했음.
- `imagegen` built-in 모드로 20개 카페 메뉴 항목의 5x4 contact sheet bitmap을 생성. 원본은 Codex generated_images에 보존하고, 프로젝트 확인용 사본을 `voice-adaptive-kiosk/module-b/public/img/menu/_imagegen-contact-sheet.png`에 저장.
- 기존 20개 `module-b/public/img/menu/<id>.svg`를 모두 self-contained SVG로 재작성. 각 SVG는 contact sheet에서 해당 순서의 crop을 `data:image/png;base64,...`로 내장하고, 하단에 큰 항목명·카테고리·가격 텍스트를 deterministic/high-contrast로 오버레이.
- 계약은 유지: `menu.seed.json`의 `image_url`은 계속 `/img/menu/<id>.svg`, SVG 파일 수 20개, 외부 이미지 URL 0개.

## 2026-05-30 — Module B 메뉴 이미지 최종 방향: 1:1·상품만

- 사용자 피드백 반영: 메뉴 이미지는 1:1 비율이 더 적합하고, 가격/라벨은 UI에서 별도 구현하므로 이미지 내부에는 음료·디저트 상품만 보여야 함.
- `menu.seed.json`을 20개 유지하되 구성 조정: latte 후보 6개 유지, Dessert 8개로 확대(New York Cheesecake, Basque Cheesecake, Chocolate Brownie, Blueberry Muffin, Lemon Pound Cake, Butter Croffle, Tiramisu Cup, Macaron Set).
- `imagegen` built-in 모드로 새 5x4 square contact sheet를 생성하고, 20개 `<id>.svg`를 모두 640x640 self-contained SVG로 재작성. SVG 안에는 embedded bitmap `<image>`만 있고 visible `<text>`/KRW/가격/라벨은 없음.
- old menu id SVG는 삭제하고 현재 `menu.seed.json`의 20개 `image_url`에 대응하는 SVG만 남김. `_imagegen-contact-sheet.png`는 프로젝트 확인용 source sheet 사본.

## 2026-05-30 — Module A 경로 이동 변경 커밋 정리

- 요청 범위: top-level `module-a/`와 `contracts/analyze.schema.json`을 제거하고 `voice-adaptive-kiosk/module-a/`, `voice-adaptive-kiosk/contracts/` 기준으로 변경된 git 상태를 커밋.
- `voice-adaptive-kiosk/module-a/vendor/`는 외부 Vox-Profile clone이므로 새 경로 `.gitignore`에 제외 규칙을 추가해 커밋 대상에서 제외.
- 기존 누적 변경에는 Module B 메뉴 이미지/데이터, Module C/D UI·계약 정합 변경도 포함되어 있어, 최종 커밋 전 `git status`와 staged diff 기준으로 포함 범위를 확인.

## 2026-05-30 — VoxCeleb age/gender 메타데이터 샘플 manifest 추출

- `voice-adaptive-kiosk/module-a/scripts/voxceleb_age_gender_sample.py`를 추가해 `hechmik/voxceleb_enrichment_age_gender`의 `final_dataframe_extended.csv`를 스트리밍으로 읽고 decade×gender 셀당 1명씩 선택하도록 구현.
- 산출물: `voice-adaptive-kiosk/module-a/artifacts/voxceleb-age-gender-sample-v1/voxceleb_age_gender_sample.csv`, `voxceleb_age_gender_sample_summary.json`.
- 결과: 목표 20셀(`10s`~`100s` × female/male) 중 17개 선택. 누락은 원본 메타데이터에서 채울 수 없는 `90s/female`, `100s/female`, `100s/male`.
- 안전 경계: 이 manifest는 검증 샘플 계획용 메타데이터이며, 공개 데이터셋 화자를 ElevenLabs 등으로 voice cloning 하는 입력으로 사용하지 않는다.
- 검증: `PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v` 28개 통과, `.venv/bin/python -m py_compile app.py inference/*.py tests/*.py scripts/*.py` 통과.

## 2026-05-30 — Voice data 실제 wav 오디오 추출

- 메타데이터가 아니라 실제 들을 수 있는 음성 파일이 필요하다는 피드백을 받고 `voice-adaptive-kiosk/module-a/scripts/voice_data_export_audio.py` 추가.
- Voice data HF streaming row의 audio bytes를 디코딩해 16kHz wav로 저장하고 manifest/summary 생성.
- 산출물: `voice-adaptive-kiosk/module-a/artifacts/voice-data-audio-sample-v1/audio/*.wav`, `voice_data_audio_manifest.csv`, `voice_data_audio_summary.json`.
- 최초 결과: 80개 wav 생성. 이후 5초 미만 파일 27개 삭제. 현재 남은 wav/manifest row는 53개, age distribution은 `18-22` 12, `23-30` 12, `31-45` 14, `46-65` 15, gender distribution은 female 26, male 27.
- 확인: wav 파일 수 53개, manifest row 53개, 5초 미만 row 0개, manifest가 가리키는 missing audio file 0개.

## 2026-05-30 — 5초 이상 Voice data wav 53개 모델 평가

- `voice-adaptive-kiosk/module-a/scripts/evaluate_audio_manifest.py`로 남은 wav 53개만 `tiantiaf/wavlm-large-age-sex`에 입력해 재평가.
- 산출물: `voice-adaptive-kiosk/module-a/artifacts/voice-data-filtered-eval-v1/filtered_audio_eval.csv`, `filtered_audio_eval_summary.json`.
- 결과: 53/53 ok, exact age-bin match 16/53(30.19%). predicted distribution은 `18-22` 6, `23-30` 17, `31-45` 21, `46-65` 5, `outside` 4.
- target별 match: `18-22` 2/12, `23-30` 4/12, `31-45` 7/14, `46-65` 3/15. 짧은 음성을 제거해도 모델이 `23-30`/`31-45` 쪽으로 몰려, 정확한 연령대 분류기로 발표하기 어렵다는 결론.

## 2026-05-30 — GGUI pending 렌더 차단 및 LOCAL 적응 렌더러 실데모 경로 보강

- GGUI live path는 `ggui_push`가 render URL을 반환해도 `codeReady=false`면 viewer가 `Generating UI...` placeholder에 머문다. Module C가 URL 존재만 성공으로 보던 것을 `codeReady !== true`면 실패 처리해 LOCAL fallback으로 전환하도록 수정.
- Module C LOCAL 렌더는 영어 데모 기준으로 정리하고 `_profile` metadata를 contract에 포함. `sixties/assist2`는 effective3/card2/font30/voice guide, `twenties/assist0`은 effective0/card3/font18/no voice guide로 검증.
- Module D는 `X-GGUI-Path: local*` 응답이면 embed URL을 비워 built-in renderer를 쓰고, GGUI embed가 3.5초 넘게 준비되지 않아도 built-in renderer로 전환한다. built-in renderer도 senior bucket 보조 가중을 적용해 카드 수가 Module C와 일치.
- 검증: Module C syntax checks, Module D typecheck/build 통과. `GGUI_MODE=ggui` direct POST는 `codeReady=false` 감지 후 `X-GGUI-Path: local-fallback`. `http://127.0.0.1:5174/` Playwright mock flow는 senior adaptive cards=2, payment complete, console error 0.

## 2026-05-30 — Age/Gender 모델 현황 및 외부 검증 후보

- 현재 실행 중인 Module A `/health` 기준 `AGE_MODEL_PROVIDER=wavlm_age_sex`, `STT_MODEL=none`; `audeering/wav2vec2-large-robust-24-ft-age-gender`는 런타임 사용 모델이 아니라 이전 후보/문서 잔재.
- 실제 코드 경로: `module-a/run_local.sh`가 기본 provider를 `wavlm_age_sex`로 지정하고, `inference/age.py`의 `VoxProfileWavLMAgeSexClassifier`가 `tiantiaf/wavlm-large-age-sex`를 로드한다.
- 후보 비교: audeering 24-layer wav2vec2는 논문 성능이 age MAE 7.1~10.8년, gender ACC 91.1%+로 명확하고 child/female/male을 출력하지만 CC-BY-NC-SA라 비상업 제한. tiantiaf WavLM은 현재 코드와 맞고 Vox-Profile 벤치마크에서 WavLM Large age Acc 67.6/F1 0.624, sex Acc 97.7/F1 0.971.
- 별도 검증 데이터 후보: Voice data가 독립 평가용으로 가장 적합. 593명/26,471 utterances, self-reported age/gender/ethnicity/L1 등을 포함하고 assistant command 도메인이라 키오스크 음성 데모와 가까움.

## 2026-05-30 — LOCAL 메인 / GGUI offline-prewarm 경로 고정

- `run.sh`, `.env.example`, root/module-c README를 갱신해 실시간 데모 메인은 `GGUI_MODE=local`이라고 명시. GGUI live generation은 `codeReady=true`일 때만 쓰는 offline/prewarm 실험 경로로 정리.
- stale `:8002` Module C 프로세스가 `X-GGUI-Path: ggui`를 반환하면서도 실제 embed는 HTTP 202 `Generating UI...`였음을 확인하고 종료. 현재 `:8002`는 새 코드 `GGUI_MODE=local`로 재기동.
- `module-c/tests/ggui-client.test.mjs` 추가: `codeReady=false` rejection, `codeReady=true` success를 node:test로 고정. 루트 `npm run verify`/`npm run probe:ggui` 스크립트 추가.
- `GGUI_FORCE_CREATE=1` 지원 추가. 강제 cold generation probe에서도 현재 GGUI는 `codeReady=false`라 `local-fallback`으로 안전하게 전환됨.
- `ggui serve` full mode도 별도 포트에서 확인: `--mcp-only` 없이도 현재 repo에는 `ggui.json`이 없어 agent disabled 상태이고, OpenAI generation binding은 잡히지만 `ggui_push`는 `codeReady=false`.
- 최종 검증: `npm run verify` 통과. `npm run probe:ggui` on `:8002` → `path:"local"`, effective3/card2/font30. `GGUI_MODE=ggui GGUI_FORCE_CREATE=1` test server는 `codeReady=false` 감지 후 `local-fallback`. Playwright로 Module C local iframe 2 cards/English/no Korean/30px 및 Module D senior mock flow payment complete 확인.

## 2026-05-30 — 연령대별 UI 데모 화면 강화

- 사용자가 현재 UI가 너무 간단하고 최선인지 지적. 기존 화면은 동작 검증용 최소 UI에 가까워 발표용 “연령대별 자동 전환” 시각 증거로 부족하다고 판단.
- `voice-adaptive-kiosk/module-c/src/local-render.js`: guided/comfort/express age mode, rank pill, step rail, coach panel, primary/secondary card 스타일을 추가. senior는 2-card guided, youth는 3-card express로 DOM 구조가 갈리도록 `module-c/tests/local-render.test.mjs` 추가.
- `voice-adaptive-kiosk/module-d/src/ui/AdaptiveKiosk.tsx` 및 `styles.css`: 실제 데모에서 보이는 built-in adaptive UI도 같은 모드 체계로 재구성. 추천/옵션/확인 단계에 큰 카드, 안내 패널, progress rail, 명확한 CTA를 추가하고 compare pane에서 카드가 눌리지 않게 CSS 조정.
- 검증: `npm --prefix module-c test`, `npm --prefix module-d run build`, `npm run probe:ggui` 통과. Playwright에서 senior는 `Guided senior mode`/2 cards/care panel/payment complete, youth는 `Express mode`/3 cards/no care panel 확인. Module C direct HTML도 `body.age-mode-guided`/2 cards/coach visible 확인.

## 2026-05-30 — 안내 음성 톤 정리

- 사용자가 안내 음성이 나이든 사람 목소리처럼 들리는 점을 지적하고, age-adaptive UI와 별개로 깔끔한 아나운서 목소리가 맞다고 정정.

## 2026-05-31 — Standard/Adaptive 비교 단계 정합 수정

- 사용자 피드백: GGUI adaptive UI 비교 화면에서 왼쪽 standard pane과 오른쪽 adaptive pane의 active 단계가 서로 다르면, UI 차이가 아니라 다른 주문 경로처럼 보인다. 발표용 비교는 **같은 단계, 다른 UI**로 보여야 한다.
- 원인: `StandardComparisonKiosk`가 `fulfillment`를 전통 키오스크 관점의 `Place` 1번 단계로 재매핑했고, `AdaptiveKiosk`는 실제 플로우 순서 `recommend -> options -> fulfillment` 기준 3번을 표시했다.
- 조치: Module D에 공통 progress 정의(`src/ui/kioskProgress.ts`)를 추가하고 standard/adaptive 양쪽 rail이 같은 순서 `Menu -> Options -> Place -> Points -> Pay -> Review`를 참조하도록 변경.
- 검증: Playwright E2E에 Place 단계 parity assertion을 추가해 기존 `1 vs 3` 실패를 재현한 뒤 수정 후 통과. `npm --prefix voice-adaptive-kiosk/module-d run build` 통과. 브라우저 확인에서 Place 단계 active가 왼쪽 `3 Place`, 오른쪽 `3`으로 일치.
- `voice-adaptive-kiosk/module-d/src/audio/tts.ts`: browser TTS 첫 `en-US` voice 사용 및 assist level별 저속 발화를 중단. preferred announcer-like English voice를 우선 선택하고, rate는 `1.0`, pitch는 `1.05`로 고정.
- `voice-adaptive-kiosk/module-c/src/local-render.js`: inline `speechSynthesis`도 preferred English voice 선택, `u.rate=1.0`, `u.pitch=1.05`로 맞춤.
- `voice-adaptive-kiosk/module-c/tests/local-render.test.mjs`: guided render가 노인처럼 느린 `0.9` rate를 쓰지 않는 회귀 테스트 추가. RED 실패 확인 후 수정, `npm run verify` 통과. Playwright stub으로 Module D 실제 발화 파라미터 `en-US/rate 1/pitch 1.05/Samantha` 확인.

## 2026-05-30 — 실제 키오스크형 before UI + 메뉴 48개 확장

- 사용자가 KFC 키오스크 사진을 제공하고 McDonald's식 결제/포인트/쿠폰/복잡한 메뉴 탐색을 참고하라고 요청. 목표를 “before는 실제 복잡한 키오스크, after는 노인 친화적으로 압축된 UI”로 재정렬.
- `imagegen` built-in으로 28개 추가 상품 contact sheet를 생성하고 crop/embed SVG asset을 제작. `voice-adaptive-kiosk/module-b/public/img/menu`와 `module-d/public/img/menu`에 반영.
- `module-b/data/menu.seed.json`과 `contracts/mocks.json` `sampleMenu`를 48개로 확장. Coffee 6, Latte 10, Tea 5, Ade 4, Beverage 5, Dessert 18.
- `module-d/src/ui/StaticKiosk.tsx`를 실제 키오스크형 흐름으로 개편: Eat In/Take Out, 좌측 category rail, 6개씩 paging, 우측 cart, add/options, review, coupon/points, payment method 선택, card reader 안내.
- `module-d/src/styles.css`에 red fast-food kiosk visual language, paging, cart, loyalty, payment UI 스타일 추가.
- mock에서도 실제 메뉴 사진을 보이게 `module-d/public/img/menu`를 사용. `Can I get a latte` 검색에서 `can`이 Americano에 매칭되는 문제를 stopword 처리해 첫 추천이 Caffe Latte가 되도록 수정.
- 검증: `npm run verify` 통과. Playwright로 before flow가 `Page 1 / 8`, 6 cards, cart/review/loyalty/payment 5 methods까지 동작함 확인. after flow는 `Guided senior mode`, `Age Group sixties`, 2 cards, first recommendation Caffe Latte 확인.

## 2026-05-30 — before/after 반반 비교 제거

- 사용자가 반반 compare 화면 대신 상단 토글로 전환하고 UI를 크게 쓰자고 요청.
- `voice-adaptive-kiosk/module-d/src/App.tsx`: `compare` 모드를 제거하고 `Standard Kiosk`/`Adaptive Voice` 두 토글만 유지. 기본은 standard, 음성 주문 시작 시 adaptive로 자동 전환.
- `voice-adaptive-kiosk/module-d/src/ui/StaticKiosk.tsx`: full-width 기준 menu page size를 8개로 확대.
- `voice-adaptive-kiosk/module-d/src/styles.css`: 전체 pane을 760px 이상 크게 쓰고, standard kiosk를 category rail/menu/cart 3-column + 4-column menu grid로 재배치.
- 검증: Playwright RED로 기존 compare UI 실패 확인 후 수정. 이후 single-pane toggle 검증 통과(`Compare` 없음, `.demo-pane` 1개). before full-width는 8 cards/`Page 1 / 6`, after full-width는 guided 2 cards 확인. `npm run verify` 통과.

## 2026-05-30 — Standard Kiosk 실제 복잡도 추가

- 사용자가 full-width 전환 후에도 실제 키오스크처럼 사용이 복잡한 느낌이 부족하다고 피드백.
- `voice-adaptive-kiosk/module-d/src/ui/StaticKiosk.tsx`: browse에 promo tab, quick filter, utility bar, suggestion lane, sticky bottom order bar를 추가. option 화면에도 required/set/add-on progress, 상품 이미지/가격 요약, upsell/allergy panel을 추가.
- `voice-adaptive-kiosk/module-d/src/styles.css`: promo/filter/utility/bottom bar 및 option 3-column layout 스타일 추가.
- 검증: Playwright RED로 복잡도 요소 부재 실패 확인 후 수정. 이후 promo tabs 3개, filters 6개, utility buttons 5개, suggestion buttons 3개, bottom bar visible, option progress/upsell/image 확인. `npm run verify` 통과.

## 2026-05-30 — 현재 WavLM 나이 구분 신뢰도 리스크

- 사용자 피드백: 현재 쓰는 `tiantiaf/wavlm-large-age-sex`가 나이 구분을 잘 못하는 것 아니냐는 우려 제기.
- 현재 근거상 우려는 타당함. Voice data 5초 이상 실제 wav 53개에서 exact age-bin match 16/53(30.19%)이고, 예측이 `23-30`/`31-45` 쪽으로 몰렸다.
- 발표/데모에서는 "정확한 나이 판별기"가 아니라 "음성 기반 rough age signal + UI 적응"으로 표현해야 안전. 50+ senior trigger는 음성 모델 단독보다 행동신호/큰글씨 선호/느린 상호작용 등과 fusion하는 방향이 필요.
- 원인 가설: 모델 벤치마크의 age task는 대략적인 age bucket 성능이고, 우리 요구는 decade/50+ 판별이라 더 까다롭다. Voice data도 최고 age bin이 `46-65`라 50+ ground truth가 거칠고, 짧은 command 음성은 나이 단서가 부족하며, 영어/녹음환경/합성음성 분포 차이 때문에 예측이 중간 연령대로 회귀한다.

## 2026-05-30 — 유료 음성 age/gender API 후보 조사

- 즉시 붙여볼 후보: Inworld STT Voice Profiles. HTTP/WebSocket STT 응답에 `voiceProfile.age`(`young`, `adult`, `kid`, `old`, `unclear`)와 confidence를 제공. 공개 정확도 지표는 확인 못 했지만 API 통합 속도는 가장 빠름.
- 상용 정확도 후보: audEERING devAIce Web API/SDK. 기존 Hugging Face audeering 모델의 상업 제품군이며 speaker age/perceived gender를 제공. 공개 블로그 기준 open-source age model은 평균 10.9년 오차, commercial model은 더 높은 정확도/robustness를 주장.
- 엔터프라이즈/온프렘 후보: Phonexia Speech Platform Age Estimation. REST/gRPC로 age integer 0~100 반환, 공식 문서상 ±10년 precision, 3초 이상 net speech, language/text/channel independent. 가격은 문의형.
- 보류 후보: Voicegain Speech Analytics는 gender와 age/senior 라벨 언급 및 $0.35/hour pricing/$50 credit이 있으나 age 기능의 현재 GA 여부가 문서상 혼재. Smallest AI는 과거 age_detection 문서가 있으나 2026-05-06 changelog에서 age_detection 제거됨. VoiceREST/GenderRecognition.com은 쉬운 REST API와 free 100 requests를 내세우지만 검증/벤치마크 신뢰도 불명.

## 2026-05-30 — WavLM age 학습 라벨 확인

- `tiantiaf/wavlm-large-age-sex`는 10살 단위 class 분류기로 학습된 모델이 아님. HF config는 `apply_reg=true`이고, 로컬 vendored `wavlm_demographics.py`는 sigmoid 1-output age regression head를 사용한다. 모델카드/예제도 output 0-1에 100을 곱해 실제 나이로 해석.
- Vox-Profile 논문은 정확한 나이 회귀 결과를 그대로 보고하지 않고, age를 3개 그룹으로 매핑해 평가: young adults `<30`, adults `30-60`, senior adults `>60`. WavLM Large age 성능 67.6%/F1 0.624는 이 3-group 기준.
- 학습/평가 데이터는 TIMIT, VoxCeleb age-enriched, Common Voice. Common Voice는 self-reported age가 10년 단위 메타데이터지만, 최종 benchmark taxomony는 10년 단위가 아니라 3개 broad age group.
- 따라서 우리 코드의 `10대/20대/30대/40대/50+` 변환과 Voice data `18-22/23-30/31-45/46-65` 평가는 원래 모델이 최적화된 기준보다 훨씬 세분화되어 성능이 낮게 나오는 게 자연스럽다.

## 2026-05-30 — WavLM 원래 broad age taxonomy 기준 재평가

- `scripts/evaluate_audio_manifest.py`에 Vox-Profile broad age group 매핑을 추가: predicted years `<30` young_adult, `30-60` adult, `>60` senior_adult. Voice data target은 `18-22/23-30` young_adult, `31-45` adult, `46-65` adult_or_senior로 처리.
- 산출물: `module-a/artifacts/voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv`, `filtered_audio_eval_summary.json`.
- 결과: 10살 단위 exact age-bin은 기존과 동일하게 16/53(30.19%). Vox-Profile broad 기준은 39/53(73.58%). 단, `46-65` bin은 adult/senior가 섞인 애매한 target이라 adult 또는 senior 예측 모두 정답 처리.
- 애매한 `46-65`를 제외한 unambiguous rows(`18-22`, `23-30`, `31-45`)만 보면 25/38(65.79%). `46-65`만 보면 14/15(93.33%)이고 예측은 adult 9, senior_adult 5, young_adult 1.
- 해석: WavLM은 10년 단위 분류기로는 부적합하지만, 원래 학습/평가 의도인 broad age signal로는 70%대 지표가 나온다. 다만 Voice data에는 명확한 `>60` 라벨이 없어 senior_adult 독립 검증은 아직 불완전.

## 2026-05-30 — 런타임 age.group을 broad taxonomy로 전환

- 사용자 요청: 73.58%가 나온 Vox-Profile broad 기준으로 실제 데모를 쓰는 방향으로 전환.
- `module-a/inference/age.py`의 `age_years_to_group()`을 10년 단위 `10대/20대/.../50+` 대신 `young_adult(<30)`, `adult(30-60)`, `senior_adult(>60)`로 변경.
- `module-a/inference/behavioral.py`는 `senior_adult`를 기존 50+와 같은 보조 가중으로 인식. `contracts/types.ts`, `contracts/schemas.py`, mocks, Module C/D senior set도 `senior_adult`를 지원하도록 정리.
- Module A/Module C 런타임 재시작 완료. `POST :8002/generate-ui`에 `age_group=senior_adult, assist_level=2` 요청 시 `_profile.effective_level=3`, `card_count=2`, `base_font_px=30` 확인.
- 검증: Module A unittest 37개 통과, Module C node:test 5개 통과, Module D typecheck 및 루트 `npm run verify` 통과.

## 2026-05-30 — 불필요한 오디오 산출물 정리

- 사용자 요청으로 `module-a/artifacts` 내 재생용 원본 오디오 데이터를 삭제.
- 삭제 대상: `age-demo-balanced-en-v1/*.mp3`, `age-demo-batch-en-v2/*.mp3`, `age-demo-batch-en/*.mp3`, `voice-data-audio-sample-v1/audio/*.wav`.
- 정리 후 `module-a/artifacts` 내 wav/mp3/m4a/webm 파일 수 0개 확인.

## 2026-05-30 — Module A artifacts 폴더 축소 정리

- 사용자 피드백: `module-a/artifacts`에 폴더가 너무 많음.
- 현재 실제 쓰는 WavLM broad 평가 산출물만 남기고 나머지 실험/비교/대시보드 산출물은 삭제.
- 최종 artifacts: `voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv`, `filtered_audio_eval_summary.json`만 보존. 전체 용량 16K, 오디오/이미지 파일 수 0개.

## 2026-05-30 — 검증 데이터 명칭 generic voice data로 정리

- 사용자 요청: 현재 프로젝트 전반에서 특정 공개 데이터셋 이름을 드러내지 않고 `voice data` 계열 명칭으로 정리.
- Module A 평가 artifact 폴더를 `module-a/artifacts/voice-data-voxprofile-broad-eval-v1`로 변경하고 summary의 dataset/source_manifest도 generic 값으로 수정.
- `module-a/scripts/*`, `module-a/tests/*`, `module-a/app.py`, demo dashboard, README, 프로젝트 MEMORY에서 관련 파일명/상수/화면 문구를 `voice_data`/`Voice Data`/`voice-data-*`로 통일.
- 확인: 프로젝트 검색에서 이전 데이터셋 실명 문자열 0건, Module A unittest 37개 통과, 루트 `npm run verify` 통과.

## 2026-05-30 — voice data 실제 wav 복구

- 사용자 정정: 삭제 요청은 전혀 관련없는 오디오 제거였고, 검증용 voice data wav는 남겨야 했다.
- `module-a/artifacts/voice-data-audio-sample-v1/audio`에 평가용 실제 wav 53개를 재생성하고, `voice_data_audio_manifest.csv`/`voice_data_audio_summary.json`을 53개 기준으로 복구.
- `module-a/artifacts/voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv`가 참조하는 `audio_path` 53개와 복구된 wav 파일이 모두 일치함을 확인.
- 현재 Module A voice data artifacts: audio sample 폴더 14M(53 wav + manifest/summary), broad eval 폴더 16K(CSV/summary).

## 2026-05-30 — 10초 이상 voice data 통계

- `module-a/artifacts/voice-data-audio-sample-v1/voice_data_audio_manifest.csv`와 실제 wav 길이를 대조해 10초 이상 음성을 집계.
- 결과: 전체 53개 중 14개(26.42%)가 10초 이상. 10초 이상 subset 길이 min 10.000s, max 27.040s, mean 14.012s, median 12.519s, total 196.169s.
- age 분포: `18-22` 1, `23-30` 2, `31-45` 4, `46-65` 7. gender 분포: female 5, male 9. language는 English 14.

## 2026-05-30 — voice data 10초 이상 파일만 보존

- 사용자 요청으로 `module-a/artifacts/voice-data-audio-sample-v1/audio`에서 10초 미만 wav 39개를 삭제하고 10초 이상 wav 14개만 보존.
- `voice_data_audio_manifest.csv`, `voice_data_audio_summary.json`, `voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv`, `filtered_audio_eval_summary.json`도 14개 기준으로 갱신.
- 검증: wav 파일 수 14개, 최소 길이 10.000s, 10초 미만 0개. audio sample 폴더 6.0M, broad eval 폴더 8.0K.

## 2026-05-30 — ElevenLabs voice ID 2개 생성 후 age classification

- 사용자 제공 voice ID `ZUNnNd4Dvs0ZStMchHAS`, `CwU9JS9865QvUvq5PqPl`로 동일 문장 TTS 생성 후 현재 `wavlm_age_sex` classifier에 입력.
- 생성 문장: `I would like to order a latte. Please guide me slowly with large text.`
- 결과: `ZUNnNd4Dvs0ZStMchHAS`는 `adult`, years_est 39.78, duration 3.483s. `CwU9JS9865QvUvq5PqPl`는 `senior_adult`, years_est 86.49, duration 7.430s.
- 산출물: `module-a/artifacts/voice-id-classification-v1/*.mp3`, `summary.json`.

## 2026-05-31 — senior demo/test voice ID 고정

- 사용자 결정: 앞으로 테스트/데모에서 `CwU9JS9865QvUvq5PqPl` voice ID를 사용.
- `module-a/inference/elevenlabs_voice.py`의 기본 `50+` female/male voice pool을 `CwU9JS9865QvUvq5PqPl` 하나로 고정.
- 회귀 테스트 `test_default_senior_test_voice_uses_validated_voice_id` 추가. RED에서 기존 voice들이 선택되는 실패를 확인한 뒤 수정했고, Module A unittest 38개 통과.

## 2026-05-31 — 50+ demo/test voice 성별 매핑 정정

- 사용자 정정: `CwU9JS9865QvUvq5PqPl`는 남자 음성, 이전 비교 voice `ZUNnNd4Dvs0ZStMchHAS`는 여자 음성.
- `module-a/inference/elevenlabs_voice.py`의 기본 `50+` voice pool을 female=`ZUNnNd4Dvs0ZStMchHAS`, male=`CwU9JS9865QvUvq5PqPl`로 수정.
- 회귀 테스트를 gender-specific voice ID 확인으로 변경. 직접 선택 확인 결과 female/male 매핑 정상, Module A unittest 38개 통과.
- 런타임 age group 구분은 WavLM broad taxonomy: `<30 young_adult`, `30~60 adult`, `>60 senior_adult`. 데모 voice 선택 버킷은 legacy `10대/20대/30대/40대/50+`를 유지.

## 2026-05-31 — voice data 파일명 age/gender 매핑 검증

- `module-a/artifacts/voice-data-audio-sample-v1/audio`의 14개 wav 파일명 age/gender를 `voice_data_audio_manifest.csv` 및 `voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv` target label과 전수 대조.
- 결과: wav 14개, manifest 14행, eval 14행 모두 1:1 일치. filename vs manifest/eval mismatch 0건, wav 없는 manifest/eval row 0건.
- 분포: 파일명 기준 age `18-22` 1, `23-30` 2, `31-45` 4, `46-65` 7; gender female 5, male 9.
- 주의: 파일명 age는 원본 voice data target label이고 WavLM 예측값이 아니다. 예: `0033_31-45_female.wav`는 target `31-45`지만 모델 exact prediction은 `46-65`, broad group은 `adult`.

## 2026-05-31 — ElevenLabs voice ID 추가 age classification

- 사용자 제공 voice ID `uTRFmCkXgUDH7i0lmt7U`로 동일 문장 TTS 생성 후 현재 `wavlm_age_sex` classifier에 입력.
- 생성 문장: `I would like to order a latte. Please guide me slowly with large text.`
- 결과: `adult`, years_est 51.78, duration 5.201s, confidence 0.99949.
- 산출물: `module-a/artifacts/voice-id-classification-v1/uTRFmCkXgUDH7i0lmt7U.mp3`, `summary.json`.

## 2026-05-31 — senior female demo/test voice ID 교체

- 사용자 결정: `uTRFmCkXgUDH7i0lmt7U`는 여성 음성이므로 여성 시니어 테스트/데모 voice로 사용. 남성 시니어는 `CwU9JS9865QvUvq5PqPl` 유지.
- `module-a/inference/elevenlabs_voice.py`의 기본 `50+` voice pool을 female=`uTRFmCkXgUDH7i0lmt7U`, male=`CwU9JS9865QvUvq5PqPl`로 수정.
- 회귀 테스트 기대값도 수정. RED에서 기존 female=`ZUNnNd4Dvs0ZStMchHAS` 매핑 실패 확인 후 수정했고, Module A unittest 38개 통과.

## 2026-05-31 — Standard Kiosk 복잡도 방향 전환

- 사용자 피드백: before UI가 단순한 것은 문제지만, utility/filter/promo/suggestion 버튼을 많이 넣는 방식의 복잡도는 과하고 쓸데없는 요소처럼 보임.
- 결정: before의 복잡도는 버튼 clutter가 아니라 실제 키오스크 사용 흐름의 결정 부담으로 표현한다. 메뉴 탐색 → 옵션 → 주문 확인 → 포인트/쿠폰 → 결제수단으로 화면을 분리하고, 옵션 선택 중 가격이 바뀌는 구조를 강조.
- 변경: `module-d/src/ui/StaticKiosk.tsx`에서 utility bar, promo tabs, quick filter, suggestion lane, sticky bottom order bar를 제거하고 6단계 `decision-rail` 및 옵션 가격 변동 안내를 추가. `module-d/src/styles.css`에 관련 스타일과 반응형 rail을 추가.
- 검증: Playwright RED/GREEN으로 clutter DOM 제거와 decision rail/price note 표시 확인. `npm --prefix module-d run typecheck`, `npm run verify` 통과.

## 2026-05-31 — Optional upgrades 선택/가격 반영 복구

- 사용자 피드백: options 화면의 `Optional upgrades`가 선택되지 않음.
- 원인: 이전 복잡도 정리에서 upsell CTA를 가격 표시용 `.upgrade-row` div로 바꾸면서 click handler, selected state, price delta 계산이 사라짐.
- 변경: `module-d/src/ui/StaticKiosk.tsx`에서 optional upgrades를 button toggle로 바꾸고 `unitTotal()`에 optional upgrade delta를 합산. `module-d/src/api/client.ts` mock 주문 합계와 `module-b/server.js` live 주문 합계도 동일 규칙으로 맞춤. `module-d/src/styles.css`에 selected/hover 스타일 추가.
- 검증: Playwright RED/GREEN으로 Extra shot 선택 시 total 변경/selected 표시/해제 복귀 확인. Add to Order → checkout → payment complete까지 option total과 결제 total 일치 확인. `npm --prefix module-d run typecheck`, `npm run verify` 통과.

## 2026-05-31 — UI 기능 스모크 점검 + ElevenLabs 아나운서 나레이션 전환

- 사용자 요청: Optional upgrades 외에도 동작하지 않는 기능이 있는지 테스트/검토/수정. 추가로 현재 음성 나레이션이 AI 같으니 ElevenLabs의 자연스러운 아나운서 톤으로 나오게 변경.
- Playwright로 Standard browse/category/page, Back to Menu, cart qty +/-/remove, checkout disable, loyalty/payment back navigation, payment method 선택을 실제 클릭 검증.
- Playwright로 Adaptive senior/youth, option price change, No Change It, Choose Again, Yes Pay, Start Over를 실제 클릭 검증.
- 발견/수정: Adaptive `Choose Again`이 `flow.reset(false)`로 candidates/analyze를 잃고 빈 adaptive 화면을 만들던 문제를 `Orchestrator.backToRecommendations()`로 수정.
- ElevenLabs 나레이션:
  - Module A에 `POST /demo/announcer-voice/audio` 추가, CORS 허용, announcer voice 기본값 `21m00Tcm4TlvDq8ikWAM`, 안정적인 뉴스리더 톤 settings 적용.
  - Module D `tts.ts`와 Module C LOCAL HTML이 ElevenLabs announcer mp3를 먼저 재생하고 실패 시 browser TTS로 폴백.
  - `.env.example`에 `ELEVENLABS_ANNOUNCER_*`, `VITE_ELEVENLABS_NARRATION`, `CORS_ORIGINS` 추가.
- 검증: Playwright RED/GREEN으로 ElevenLabs endpoint 호출 확인. 전체 UI 스모크 통과. Module A unittest 40개, Module C node:test 5개, Module D typecheck/build, `npm run verify` 통과. Module A 재기동 후 실제 announcer endpoint가 200 mp3(36,824 bytes)를 반환하고 CORS preflight 200 확인.

## 2026-05-31 — `0020_46-65_female.wav` 매핑 의심 검증

- 사용자 피드백: `0020_46-65_female.wav`가 청감상 46-65처럼 들리지 않고 발화도 `open text to mom...`이라 매핑 오류 의심.
- manifest/eval 대조: 파일명 `46-65/female`, `voice_data_audio_manifest.csv` target `46-65/female`, eval CSV target `46-65/female` 모두 일치.
- 원본 스트림을 같은 balanced sampling 조건으로 재현한 sample_idx 20도 raw age `46 - 65`, gender `female`, transcription `open text to mom ask her what color a ripe watermelon should be and send text`, duration 11.946s.
- 재생성 wav sha256이 현재 파일 sha256과 동일하고 sample diff 0.0이라 파일 swap/매핑 오류는 아님. 다만 WavLM 예측은 years_est 33.94, `adult`라 source label 자체가 청감/모델 기준으로 의심스러운 noisy label일 수 있음.

## 2026-05-31 — ElevenLabs age/gender labeled voice 후보 12개 검증

- 사용자 아이디어: ElevenLabs 자체 voice metadata의 `age`(`young`, `middle_aged`, `old`)와 `gender` 라벨을 후보 pool로 쓰는 방향 검토.
- 계정 `/v1/voices`에서 라벨 있는 후보 12개(young/middle_aged/old x female/male)를 골라 동일 문장 TTS 후 현재 `wavlm_age_sex` classifier로 검증.
- 결과 요약: young 4개 중 WavLM `young_adult`는 1개, middle_aged 4개 중 `adult` 3개/senior 1개, old 4개 중 `senior_adult` 2개/adult 2개.
- senior_adult로 잘 나온 후보: old male `pqHfZKP75CvOlQylNhV4`/Bill years_est 84.21, old female `wGcFBfKz5yUQqhqr0mVy`/Maria Moody years_est 76.32. middle_aged male `CwhRBWXzGAHq8TQ4Fs17`/Roger도 66.79로 senior false-positive.
- 산출물: `module-a/artifacts/elevenlabs-label-validation-v1/audio/*.mp3`, `summary.csv`, `summary.json`.

## 2026-05-31 — senior demo/test voice 최종 2개로 고정

- 사용자 결정: senior voice는 ElevenLabs old label + WavLM senior_adult 검증을 통과한 2개로 사용.
- `module-a/inference/elevenlabs_voice.py` 기본 `50+` voice pool을 female=`wGcFBfKz5yUQqhqr0mVy`, male=`pqHfZKP75CvOlQylNhV4`로 변경.
- 회귀 테스트 기대값도 같은 2개로 수정. RED에서 기존 female=`uTRFmCkXgUDH7i0lmt7U` 매핑 실패 확인 후 수정했고, Module A unittest 38개 통과.

## 2026-05-31 — Module A demo broad age group 기준 정리

- `/demo`의 target 선택지를 WavLM broad taxonomy 기준 `young adult (<30)`, `adult (30-60)`, `senior adult (>60)`로 변경.
- validation panel은 10살 단위 exact age-bin이 아니라 broad age-group match를 주 지표로 표시하도록 수정. 현재 voice data 14개 기준 broad match `12/14 (85.71%)`, exact age-bin `1/14 (7.14%)`.
- `/demo/batch-summary`는 `broad_match`, `broad_match_rate`, target/predicted broad distribution을 내려주며, real voice data 검증 note가 ElevenLabs proxy label 문구로 보이지 않게 보정.
- `generate-and-analyze` 화면은 broad target과 broad prediction을 비교하고, 로그/라벨에는 내부값 `senior_adult` 대신 `senior adult` 같은 사용자용 문구를 표시.
- 검증: Module A unittest 40개 통과. live API에서 senior female=`wGcFBfKz5yUQqhqr0mVy`, senior male=`pqHfZKP75CvOlQylNhV4` 선택 확인. 실제 생성 분석 결과 female 73.26세/senior_adult, male 88.94세/senior_adult, assist_level 1 확인.

## 2026-05-31 — 낮은 연령대 포함 broad demo/test voice set 확장

- 사용자 피드백: senior 2개만 있으면 낮은 연령대 테스트가 부족하므로 young/adult voice도 필요.
- ElevenLabs label 후보를 추가 TTS 생성 후 현재 WavLM `wavlm_age_sex`로 분류. 산출물: `module-a/artifacts/elevenlabs-low-age-validation-v1/summary.json`, `summary.csv`, `audio/*.mp3`.
- 검증 통과 voice: young female `cl7Lq9M5lHPrBM5kbtI6` -> `young_adult` 24.28세, young male `hbD9jyvjaK5U03Bx24wj` -> 3회 안정성 테스트 모두 `young_adult`(29.75/27.63/24.94세), adult female `InBZ3nD3eaYhPkNfAsGL` -> `adult` 36.51세, adult male `cjVigY5qzO86Huf0OWal` -> `adult` 46.58세.
- `module-a/inference/elevenlabs_voice.py` 기본 voice map을 broad 테스트 기준으로 고정: `young_adult`, `adult`, `senior_adult` 각각 female/male 1개씩 총 6개.
- 회귀 테스트 `test_default_broad_age_test_voices_use_validated_gender_specific_voice_ids` 추가. RED에서 young female이 기존 `FGY2WhTYpPnrIDTdsKH5`로 선택되는 실패 확인 후 수정.
- live `generate-and-analyze` 검증 중 demographic hint prefix가 young male을 adult로 밀 수 있어 `/demo` 기본 문장은 자연 주문문만 쓰도록 수정.
- 최종 live `generate-and-analyze` 검증: young female 24.69/young_adult, young male 24.09/young_adult, adult female 38.36/adult, adult male 44.20/adult, senior female 89.14/senior_adult, senior male 89.61/senior_adult.

## 2026-05-31 — Demo validation 성능 기준을 생성 voice set으로 전환

- 사용자 지적: `Broad age accuracy 86%`는 모델 자체 성능처럼 보이므로, 데모에서 실제 사용하는 ElevenLabs 선택 voice로 생성한 음성 validation 성능을 메인으로 보여줘야 함.
- 새 artifact 생성: `module-a/artifacts/elevenlabs-demo-voice-set-validation-v1/`에 선택된 6개 voice의 mp3, `results.csv`, `summary.json` 저장.
- 결과: generated demo voice set 기준 broad age accuracy `5/6 (83.33%)`. young male `hbD9jyvjaK5U03Bx24wj`가 이번 생성 샘플에서는 30.15세 `adult`로 경계선 miss. predicted distribution은 young_adult 1, adult 3, senior_adult 2.
- `/demo/batch-summary` 기본 우선순위를 demo voice set artifact로 변경하고, real voice data 14개 결과 `12/14 (85.71%)`는 `real voice reference` 보조 지표로 표시.
- `/demo` UI 문구를 `Demo Voice Set Validation`, `Broad age accuracy`, `real voice reference`, `Predicted group distribution`로 변경해 vendor/model benchmark처럼 보이지 않게 정리.

## 2026-05-31 — GGUI 멀티턴 주문 플로우 확장

- 사용자 요구: GGUI가 최초 추천 화면만 바꾸는 것이 아니라, 연령대와 주문 상태를 들고 매 턴 UI를 다시 생성해야 함. 라이브 데모에서도 partial utterance를 단계별로 처리할 수 있어야 함.
- 계약: `AdaptiveStep`을 `recommend/options/fulfillment/loyalty/payment/confirm`으로 확장하고 `AdaptiveOrderState`, `possible_actions`를 D→C `/generate-ui` 요청에 추가.
- Module D: rule+fuzzy `voiceIntent`를 추가해 `vanilla latte`, `iced large`, `take out`, `skip points`, `credit card`, `yes` 같은 발화를 현재 단계별 intent로 해석. Adaptive UI는 추천/옵션/매장·포장/포인트/결제/최종확인 전부 mixed-mode로 동작.
- Module C/GGUI: prompt/props/local fallback이 `current step`, `order_state`, `possible_actions`를 반영하고 6단계 actionSpec/local renderer를 지원.
- 검증: Module C node:test 13개, Module D typecheck/build, 루트 `npm run verify` 통과. Playwright로 `vanilla latte → iced large → take out → skip points → credit card → yes` 시나리오가 `Payment Complete!`까지 통과.

## 2026-05-31 — Adaptive demo age selector 제거

- 사용자 피드백: Younger는 일반 키오스크를 쓰면 되므로 데모에서 Senior/Younger를 사용자가 직접 고르는 방식은 제품 논리를 해침.
- 결정: Adaptive demo의 visible age selector를 제거하고, mock 기본값은 senior_adult slower speech로 고정. youth mock은 개발용 hidden query `?variant=youth`로만 유지.
- 검증: Module D typecheck/build 통과.

## 2026-05-31 — Module A 데모 한국어 전환 + 한국어 voice set validation 재생성

- 사용자 피드백: 데모 관객이 한국인이므로 Module A `/demo` 주문 문장과 UI copy를 영어보다 한국어로 작성하는 것이 맞음.
- 변경: `module-a/static/demo.html`의 주요 라벨/버튼/상태/로그/검증 패널을 한국어로 전환하고 기본 언어/프롬프트도 한국어 주문문으로 고정. 로그의 성별/언어/match 표시도 `여성/남성`, `한국어`, `일치/불일치`로 표시.
- 검증 artifact 재생성: `module-a/artifacts/elevenlabs-demo-voice-set-validation-v1/`의 선택된 6개 ElevenLabs demo voice를 한국어 주문문 `아이스 라떼 하나랑 쿠키 하나 주문할게요.`로 다시 생성해 WavLM 분류 검증.
- 결과: demo voice set broad age accuracy `6/6 (100%)`, predicted distribution `young_adult 2 / adult 2 / senior_adult 2`. 실제 음성 참고 지표는 기존 `12/14 (86%)`.
- 검증: Module A 전체 unittest 45개 통과. `/demo/batch-summary` live 응답이 한국어 note와 `6/6 (100%)` demo voice set validation을 반환함.

## 2026-05-31 — Module A `/demo` 실시간 UI 제거 + 성능 이미지 생성

- 사용자 결정: `http://127.0.0.1:8000/demo`에서 음성 생성 UI와 성능 대시보드를 보여줄 필요가 없음. 단, 연령대별 음성 생성 API는 이후에도 쓰이므로 백엔드 코드는 삭제하지 않음.
- 변경: `module-a/static/demo.html`을 실시간 컨트롤/오디오 플레이어/검증 차트가 없는 가벼운 안내 페이지로 교체. 한국어 글꼴 stack은 `Pretendard`, `Apple SD Gothic Neo`, `Noto Sans KR`, `Malgun Gothic`, system sans-serif.
- 보존: `/demo/random-age-voice`, `/demo/random-age-voice/audio`, `/demo/generate-and-analyze`, `/demo/batch-summary`, `/demo/announcer-voice/audio` 코드는 유지.
- 성능 표시: imagegen built-in으로 발표용 정적 PNG 생성 후 `module-a/static/generated/voice-age-validation-performance.png`에 저장. 내용은 demo voice set `6/6 (100%)`, 실제 음성 참고 `86%`, broad age group 기준.
- 검증: `tests/test_demo_static.py`에 `/demo`가 live voice/validation UI를 노출하지 않는 회귀 테스트 추가. Module A unittest 46개 통과. live `/demo/random-age-voice`가 senior female Korean voice ID를 계속 반환함을 확인.

## 2026-05-31 — Module A `/demo` 웹 페이지 서빙 중단

- 사용자 결정: `/demo`를 안내 페이지로라도 서버에서 띄울 필요가 없음. Module A는 API 서버 역할만 유지.
- 변경: `GET /demo` FastAPI route와 `module-a/static/demo.html`을 제거. 정적 성능 PNG와 `/static` mount는 asset 보관용으로 유지.
- 보존 API: `/demo/random-age-voice`, `/demo/random-age-voice/audio`, `/demo/generate-and-analyze`, `/demo/batch-summary`, `/demo/announcer-voice/audio`.
- 회귀 테스트: `module-a/tests/test_demo_routes.py` 추가. `GET /demo`는 404, `/demo/random-age-voice`는 senior female Korean voice ID `wGcFBfKz5yUQqhqr0mVy`를 반환해야 함.
- 검증: Module A unittest 45개 통과. Module A tmux 재기동 후 live `GET /demo`가 404, live `/demo/random-age-voice`가 정상 JSON 반환 확인.

## 2026-05-31 — Module A 정적 이미지/미사용 artifacts 최종 정리

- 사용자 요청: 성능 이미지와 폴더를 삭제하고 `module-a/artifacts`에서 현재 안 쓰는 산출물을 정리.
- 삭제: `module-a/static/` 전체, `voice-age-validation-performance.png`, 정적 `/static` mount 코드. 삭제한 artifact 폴더는 `elevenlabs-label-validation-v1`, `elevenlabs-low-age-validation-v1`, `voice-id-classification-v1`, `voice-data-audio-sample-v1`, `elevenlabs-demo-voice-set-validation-v1/audio`, `.DS_Store`.
- 보존: 런타임 `/demo/batch-summary`가 읽는 `elevenlabs-demo-voice-set-validation-v1/results.csv`, `summary.json`, 참고 지표용 `voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv`, `filtered_audio_eval_summary.json`.
- 코드 정리: `app.py`에서 `StaticFiles`, `STATIC_DIR`, old synthetic batch fallback 경로를 제거. README도 현재 보존 artifact 4개 기준으로 정리.
- 검증: Module A unittest 48개 통과. live 재기동 후 `/demo` 404, `/static/generated/voice-age-validation-performance.png` 404, `/demo/batch-summary`는 demo voice set `6/6`, `/demo/random-age-voice`는 senior female voice ID 반환 확인.

## 2026-05-31 — Korean senior proxy bridge + comparison demo resumed

- 목표: `voice-adaptive-kiosk`에서 기존 키오스크 결제 방식만 먼저 보여주고, 한국어 주문을 영어 senior proxy voice로 bridge해 현재 영어 age model 데모 환경에서 분석한 뒤 좌우 비교 adaptive flow로 전환하는 해커톤 데모 완성.
- 시작 상태: 워크트리는 다수 변경이 섞여 있어 보존. `build_english_order_proxy()` 관련 prior-session 변경은 이미 있고 지정된 ElevenLabs voice test는 통과.
- 다음 작업: Module A proxy analyze API, Module D mock/live client 연결, proxy audio playback/trace, standard-only/adaptive-compare UI, multi-turn Payment Complete까지 검증.
- 구현:
  - Module A에 `POST /demo/korean-senior-proxy/analyze` 추가. 한국어 주문 -> 영어 senior proxy utterance -> ElevenLabs senior mp3 -> age model/behavioral 분석 -> trace/audio_base64 반환.
  - ElevenLabs 미설정은 503으로 반환하고, Module D mock mode는 route/mock fallback으로 브라우저 테스트가 깨지지 않게 구성.
  - Module D 시작 흐름은 standard-only 화면에서 시작해 Start Voice Order 후 adaptive-compare로 전환. proxy trace를 보여주고, proxy mp3가 있으면 실제 재생한다.
  - 좌우 비교 왼쪽은 `StandardComparisonKiosk`로 adaptive 단계에 대응하는 기존 키오스크의 복잡한 단계 흐름을 보여주고, 오른쪽 adaptive multi-turn은 Payment Complete까지 유지.
  - visible Senior/Younger selector는 계속 제거 상태 유지.
- 검증:
  - Module A unittest discover 48개, Module C node:test 13개, Module D typecheck/build, `npm run verify` 통과.
  - Playwright story 통과: 초기 adaptive pane 없음, proxy route 호출/trace 표시, 좌우 pane 표시, frame size 기준, `vanilla latte -> iced large -> take out -> skip points -> credit card -> yes` 결제 완료.

## 2026-05-31 — 데모 표면의 bridge/proxy/model 설명 제거

- 사용자 피드백: 데모에서 한국어를 영어로 바꾸는 bridge/proxy/age model 설명이나 나레이션은 관객에게 보여줄 필요가 없고, 실제 키오스크에서 나올 법한 안내만 남겨야 함.
- 변경: Module D의 proxy trace, technical footer, mock badge, module step label, debug signal banner, English proxy transcript 노출, bridge 설명 음성 안내를 제거. 내부 proxy route 호출은 유지하되 데모 표면은 메뉴 추천/옵션/포장/포인트/결제 안내만 보이게 정리.
- 검증: Playwright에서 bridge/proxy/model/debug copy 미노출과 전체 multi-turn Payment Complete 통과 확인. Module D typecheck와 `npm run verify` 통과.

## 2026-05-31 — Module A 학습/모델/artifacts 디렉터리 사용 여부 확인

- 확인 대상: `voice-adaptive-kiosk/module-a/training`, `voice-adaptive-kiosk/module-a/models/age_model`, `voice-adaptive-kiosk/module-a/artifacts`.
- 현재 런타임 기본값은 `run_local.sh` 기준 `AGE_MODEL_PROVIDER=wavlm_age_sex`, `STT_MODEL=none`; 실제 age 추론은 `inference/age.py`의 `VoxProfileWavLMAgeSexClassifier`가 `tiantiaf/wavlm-large-age-sex` pretrained model을 로드한다.
- `training/`은 AIHub 한국어 학습 파이프라인 잔재로, 현재 데모/런타임 경로에서는 호출되지 않는다. 단, git tracked 상태이며 `tests/test_manifest_pipeline.py`와 README legacy 학습 절차가 이를 참조하므로 삭제 시 테스트/문서 정리도 같이 필요하다.
- `models/age_model/`은 현재 비어 있고, `wavlm_age_sex` provider에서는 사용되지 않는다. `local/trained/age_model` provider로 되돌릴 때만 `config.json`이 있는 checkpoint가 필요하다.
- `artifacts/`는 대용량 원본 산출물이 아니라 현재 `/demo/batch-summary`가 읽는 4개 CSV/JSON만 남아 있다. demo voice set validation과 real voice reference summary 표시용이라, API 기능 자체에는 필수는 아니지만 현재 검증 패널/summary endpoint의 근거 데이터로는 쓰인다.
- 검증: `PYTHONPATH=. .venv/bin/python -m unittest tests.test_demo_batch_summary tests.test_age_public_model -v` 10개 통과.

## 2026-05-31 — 학습/검증/생성 산출물 정리

- 사용자 결정: AIHub 직접 학습 경로와 `models/age_model`, `module-a/artifacts`는 현재 데모에서 쓰지 않으므로 삭제.
- 삭제 범위: `module-a/training`, `module-a/models`, `module-a/artifacts`, `remote/`, standalone `tools/voicegen`, `specs/VOICEGEN.md`, Module A batch/eval/voice-data/VoxCeleb scripts와 대응 테스트, menu imagegen contact sheet PNG, `dist`/`tmp`/`test-results`/`.run-logs`/`__pycache__`/`.DS_Store`.
- 코드 정리: `/demo/batch-summary` route와 artifact CSV/JSON loader 제거. `create_age_model("local")` fallback 제거. `AGE_MODEL_PATH` env 제거. 현재 provider는 `wavlm_age_sex`만 지원.
- 문서 정리: root README, Module A README, SPEC, PIPELINE, specs/MODULE_A, specs/README, specs/INTEGRATION을 현재 runtime-only 방향으로 갱신.
- 검증: Module A unittest 32개 통과, `py_compile` 통과, `npm run verify` 통과. 메뉴 seed 48개 image_url은 module-b/module-d public asset 모두 missing 0개 확인.

## 2026-05-31 — voice-adaptive-kiosk 실제 한국어 STT와 선택형 proxy voice

- 사용자 피드백: 데모에서 고정 입력처럼 보이면 안 되고, 사용자의 한국어 음성을 먼저 인식한 뒤 영어 senior proxy TTS를 만들어 관객에게 재생하고 그 오디오 기반 분석/adaptive flow로 들어가야 함. 단, 화면에는 bridge/proxy/model 같은 기술 설명은 숨기고 키오스크 안내만 보여야 함.
- Module D 변경: Start Voice Order는 실제 mic 녹음을 시작하고 Stop 시 Blob을 Module A `/analyze`로 전송한다. 반환된 한국어 transcript를 Korean senior proxy analyze route에 넘기고, 받은 mp3 base64를 재생한 뒤 기존 multi-turn adaptive flow를 이어간다.
- Voice 선택: 데모 상단에 `Voice 1`/`Voice 2` 선택을 추가. 검증된 senior female/male ElevenLabs voice id만 Module A가 허용하도록 route validation도 추가.
- STT 결정: 로컬 `faster-whisper` 기본값 대신 OpenAI Audio Transcriptions API를 사용하기로 변경. Module A 기본 `STT_MODEL=whisper-1`, `STT_LANGUAGE=ko`; 로컬 경로는 `STT_MODEL=local:small`처럼 명시할 때만 사용.
- 환경: `module-a/requirements.txt`에 `openai>=1.93.0` 추가, `.env.example`/README/run_local.sh 갱신, 현재 `.venv`에는 `ensurepip` 후 `openai 2.38.0` 설치.
- 검증: `test_stt_config.py` 6개 통과, `py_compile` 통과, `npm run verify` 통과, Playwright 한국어 proxy demo 시나리오 통과. 기존 `test_demo_routes.py`의 `/demo/batch-summary` 404 기대는 현재 200 endpoint와 불일치해 별도 정리 필요.

## 2026-05-31 — voice-adaptive-kiosk GGUI live generation 상태 확인

- 사용자 의심: adaptive UI가 실제 GGUI 생성 결과가 아니라 이미 있는 UI처럼 보인다고 지적.
- 확인 결과: 기존 상태는 Module C `mode=local`, Module D mock으로 실제 GGUI 경로가 아니었다.
- 조치: tmux로 A/B/C/D/GGUI를 재기동. 현재 A=`whisper-1`, B=up, C=`GGUI_MODE=ggui`, D=`VITE_USE_MOCK=false`, GGUI CLI=6781 up.
- 검증: C `/generate-ui`는 GGUI MCP `ggui_new_session`/`ggui_handshake`/`ggui_push`까지 success로 호출하지만, `ggui_push`가 `codeReady=false`를 반환해 C가 local fallback을 반환한다. `GGUI_FORCE_CREATE=1` 및 GGUI CLI에 `OPENAI_API_KEY` 주입 후에도 동일.
- 결론: 현재 화면의 adaptive UI는 아직 실제 GGUI-generated UI가 아니라 local fallback이다. GGUI 호출은 들어가지만 렌더 가능한 코드가 준비되지 않는 상태라 추가 GGUI 서버/admin/blueprint 설정 점검이 필요하다.

## 2026-05-31 — GGUI alpha 최신 경로 전환 및 live render 성공

- 사용자 정정: 최신 GGUI 기준은 `npx @ggui-ai/create-agentic-app@alpha`이며, 기존 `@ggui-ai/cli@latest` rc 경로가 아니라 alpha 흐름으로 맞추기로 함.
- 원인: 기존 `@ggui-ai/cli@latest`는 `0.1.0-rc.1`이고 OpenAI 기본 모델을 `openai/gpt-5.5-2026-04-23`처럼 OpenAI API에 그대로 보내 invalid model 400을 만들었다. alpha는 `0.2.0-alpha.4`이며 도구 흐름이 `ggui_new_session`/`ggui_push`가 아니라 `ggui_handshake` -> `ggui_render`다.
- 조치: `voice-adaptive-kiosk/servers/ggui/ggui.json`을 추가하고 `oba-ggui`를 `npm exec --package @ggui-ai/cli@alpha -- ggui serve --mcp-only --dev-allow-all --port 6781 --public-base-url http://127.0.0.1:6781`로 재기동.
- Module C 변경: `ggui_render`를 우선 호출하고 session tool은 optional로 처리. alpha 응답은 `codeReady`가 없고 `_meta["ai.ggui/render"].codeUrl/codeHash`, `resourceUri`로 준비 상태를 판단하도록 변경. `resources/read`로 MCP App HTML을 읽어 `contract._ggui.{html,meta,resource_uri}`로 반환하고, `GET /consume/:renderId`로 `ggui_consume` long-poll을 프록시한다.
- Module D 변경: `contract._ggui.html`이 있으면 iframe `srcDoc`로 렌더하고 `ui/initialize`에 `protocolVersion/hostInfo/hostCapabilities/hostContext/toolOutput._meta`를 돌려준다. GGUI action은 Module C `/consume/:renderId`를 polling해서 기존 Orchestrator action으로 라우팅한다.
- 검증: Module C node:test 17개 통과, Module D typecheck/build 통과. `node voice-adaptive-kiosk/scripts/probe-ggui-generation.mjs`가 `path:"ggui", mode:"live-ggui"`를 반환. 직접 브라우저 iframe 부트스트랩 검증에서 GGUI 생성 HTML이 실제 메뉴 카드 UI 텍스트를 렌더하고 WS connected 상태까지 확인.

## 2026-05-31 — `라떼 주문해줘` 실제 pipeline 검증

- 확인 요청: 사용자가 방금 말한 한국어 음성이 `한국어 STT -> 영어 proxy 번역 -> senior voice 영어 오디오 생성 -> GGUI 생성`으로 실제 연결되는지 확인.
- 로그 판정: 요청 직후 서버 로그에는 예전 `OPTIONS /demo/korean-senior-proxy/analyze`만 있었고, 사용자의 실제 브라우저 시도라고 단정할 수 있는 완료 로그는 없었다. 이후 통제 검증에서는 `/analyze`, `/demo/korean-senior-proxy/analyze`, GGUI `ggui_handshake`/`ggui_render`, WS subscribe가 모두 확인됨.
- 통제 오디오 검증: macOS `Yuna` 음성으로 `라떼 주문해줘` WAV를 만들어 Module A `/analyze`에 넣었고 Whisper 결과는 `라떼 주문해줘`, `age_group=adult`, `assist_level=1`, `duration_ms=20581`.
- proxy 검증: 같은 텍스트를 `/demo/korean-senior-proxy/analyze`에 넣었고 `english_proxy_text="I would like a latte, please. Please guide me slowly with large text."`, voice_id=`wGcFBfKz5yUQqhqr0mVy`, `age_group=senior_adult`, `assist_level=2`, `audio_base64_len=123220`.
- GGUI 검증: proxy 결과로 Module C `/generate-ui` 호출 시 `X-GGUI-Path=ggui`, render_id 생성, `contract._ggui.resource_uri/meta/html` 존재, HTML length 약 2982.
- 브라우저 경로 검증: Chromium fake microphone에 같은 Korean WAV를 넣고 실제 `Start Voice Order -> Stop Speaking`을 실행. 화면은 GGUI iframe 1개를 띄웠고 iframe 내부에 `SENIOR_ADULT 맞춤 추천 · 도움 단계 2`, `Caffe Latte`, `Caramel Latte` 등 GGUI-generated UI가 렌더됨.

## 2026-05-31 — proxy 문장 UI 지시 제거 + adaptive 후속 음성 수리

- 사용자 피드백: 음성 중 `large text` 같은 UI 지시 문구가 들어가는 것은 잘못이며, 나이/보조 수준은 목소리 분석 결과로 GGUI input에 들어가야 한다고 정정. 또한 첫 주문 뒤 다음 단계 음성이 동작하지 않는 문제를 지적.
- 변경:
  - Module A `build_english_order_proxy()`는 주문 의미만 영어로 만든다. 예: `라떼 주문해줘` -> `I would like a latte, please.`; `large text`, `guide me`, `slowly` 같은 UI 지시 문구 제거.
  - senior default TTS 문구에서도 `large text`/`guide me` 제거.
  - `/demo/korean-senior-proxy/analyze`의 `assist_level>=2` 보장은 proxy 문구가 아니라 `age.group == "senior_adult"` 결과에만 묶도록 변경.
  - Module D mock proxy도 같은 문장 정책으로 맞춤.
  - Module D 상단 마이크는 adaptive 상태에서 `Start Voice Order`가 아니라 `Speak Next`로 표시되고 `flow.respeak()`를 호출한다.
  - `Orchestrator`에 `recordingTurn` 플래그를 추가해 Stop 시 최초 주문 녹음은 proxy pipeline, 후속 녹음은 `/analyze` + `applyVoiceTranscript()`로 분기한다. 이전에는 follow-up 녹음도 `phase=recording`이라 다시 첫 주문 proxy pipeline으로 떨어졌다.
- 검증:
  - TDD RED: Module A tests에서 `large text` 제거 기대가 기존 코드에서 실패함을 확인.
  - GREEN: `PYTHONPATH=voice-adaptive-kiosk/module-a voice-adaptive-kiosk/module-a/.venv/bin/python -m unittest voice-adaptive-kiosk/module-a/tests/test_elevenlabs_voice.py voice-adaptive-kiosk/module-a/tests/test_demo_routes.py -v` 19개 통과.
  - `npm --prefix voice-adaptive-kiosk/module-d run build` 통과.
  - Playwright `module-d/tests/korean-proxy-demo.spec.mjs` 통과. 테스트는 `/generate-ui`를 local-test로 stub해 built-in multi-turn payment flow를 안정적으로 검증한다.
  - live Module A 재시작 후 `/demo/korean-senior-proxy/analyze`에 `라떼 주문해줘`를 넣어 `english_proxy_text="I would like a latte, please."`, `age_group=senior_adult`, `assist_level=2`, `audio_base64_len=45200` 확인.
  - live 브라우저 검증: 첫 Stop 후 proxy 1회, 상단 `Speak Next` 후 Stop 시 `/analyze`는 총 2회지만 proxy는 1회 유지. 화면은 GGUI iframe 1개, 메시지는 `Please choose your options.`, body에 `large text` 노출 없음.

## 2026-05-31 — GGUI recommend 단계 전체 메뉴 catalog 전달

- 사용자 결정: 한국어 -> 영어 번역 결과가 `yuzu/yuza/citron`처럼 메뉴 DB 표기와 어긋날 수 있으므로, 해커톤에서는 검색 후보만 넘기지 말고 GGUI 입력에 메뉴 전체를 한 번에 넣기로 함.
- 변경:
  - Module D `generateForStep()`은 recommend 단계에서 `selectedItem`이 없으면 `this.menu.items` 전체를 `menu_context`로 전달한다. 후속 options/fulfillment/payment 단계는 기존처럼 선택된 메뉴 1개 또는 현재 후보만 전달.
  - Module C GGUI 경로는 recommend 단계에서 `menu_context` 전체를 `candidates/items`로 유지한다.
  - GGUI seed prompt에 `Menu catalog JSON`을 넣고, “catalog 안의 메뉴만 사용하고 hallucination하지 말 것”, “recommend에서는 catalog에서 best N만 카드로 보여줄 것”을 명시.
  - `buildGguiProps()`를 export해 전체 catalog가 props에 유지되는지 테스트 가능하게 함.
  - LOCAL fallback은 기존 안전 동작을 유지한다. D의 built-in fallback은 state candidates 기반이고, C local render는 자체 `pickCandidates()`로 줄여 렌더한다.
- 검증:
  - TDD RED: `buildGguiProps` export 부재로 full catalog 테스트 실패 확인.
  - GREEN: `npm --prefix voice-adaptive-kiosk/module-c test` 18개 통과.
  - Module D Playwright `module-d/tests/korean-proxy-demo.spec.mjs` 통과. 첫 `/generate-ui` body의 `menu_context.length > 40` 검증 추가.
  - `npm --prefix voice-adaptive-kiosk/module-d run typecheck` 및 `run build` 통과.
  - live Module C tmux 재시작 후 `/health`에서 `mode=ggui`, `ggui_url=http://localhost:6781`, `has_openai_key=true` 확인.

## 2026-05-31 — `build_english_order_proxy`를 OpenAI 번역기로 교체

- 목표: 기존 키워드 룰(`라떼` fallback)이 한국어 자유 발화를 못 번역하므로, `build_english_order_proxy()`를 실제 한국어→영어 번역 경로로 교체.
- 변경:
  - Module A `inference/elevenlabs_voice.py`에서 라떼/아메리카노/바닐라/카푸치노 하드코딩 파서를 제거.
  - `translate_korean_order_to_english()` 추가: OpenAI Responses API를 호출해 한국어 카페 주문 발화를 자연스러운 영어 주문 1문장으로 번역. 기본 모델은 `ORDER_TRANSLATION_MODEL=gpt-4.1-mini`.
  - 번역 프롬프트는 메뉴명·수량·온도·사이즈·포장/매장 의도를 보존하고, `large text`/`guide me` 같은 UI 지시나 나이 단서를 추가하지 않도록 고정.
  - `OPENAI_API_KEY`가 없거나 번역 실패/빈 응답이면 `OrderTranslationError`(503 경로)로 명확히 실패.
  - `.env.example`, `module-a/.env.example`, README/spec에 `OPENAI_API_KEY`가 Module A 번역에도 필요하고 `ORDER_TRANSLATION_MODEL`을 쓴다는 점을 반영.
- 테스트/검증:
  - TDD RED: `유자차 하나랑 소금빵도 같이 부탁드려요`가 기존 코드에서 `I would like a latte, please.`로 실패하는 것을 확인.
  - Unit: fake OpenAI client로 자유 발화가 `yuzu tea`/`salt bread`를 포함하고 `latte` fallback이 사라지는지 검증.
  - Route tests는 번역을 mock 처리해 네트워크 없이 `/demo/korean-senior-proxy/analyze`의 TTS/age 흐름만 검증하도록 분리.
  - `PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v` 35개 통과.
  - `.venv/bin/python -m py_compile app.py inference/*.py tests/*.py` 통과.
  - live smoke(현재 dotenv 로드 순서 기준): `유자차 하나랑 소금빵도 같이 부탁드려요` -> `One yuzu tea and one salt bread, please.` 확인.

## 2026-05-31 — non-latte 메뉴 live GGUI 검증 및 catalog 정렬 보강

- 사용자 확인: 라떼 외 유자차/케이크 등도 실제로 테스트했는지 질문.
- 최초 live 검증 결과: `유자차 -> yuza tea`, `소금빵 -> salt bread`, `딸기 케이크 -> strawberry cake` 모두 실패. 전체 catalog 48개는 들어갔지만 GGUI 생성 화면이 props의 첫 3개인 `Americano`, `Espresso`, `Caffe Latte`를 그대로 추천 카드로 렌더했다.
- 원인: “전체 catalog를 넣는다”만으로는 GGUI가 catalog를 재정렬/선택한다고 보장되지 않는다. 생성 UI가 props.items 앞쪽을 그대로 쓰는 경우를 대비해, 전체 catalog는 유지하되 intent에 맞는 항목을 앞쪽으로 정렬해야 한다.
- 변경:
  - Module D `rankMenuCatalog()` 추가. recommend 단계 `menu_context`는 여전히 전체 메뉴 48개를 전달하되, `result.transcript`, `proxyTrace.korean_text`, `proxyTrace.english_proxy_text`를 합친 intent text로 stable sort한다.
  - 우선 alias 보강: `yuzu-tea-032`는 `유자/유자차/yuzu/yuza/yuja/citron`, `salt-bread-041`은 `소금빵/salt bread`, `strawberry-shortcake-046`은 `딸기/딸기 케이크/strawberry cake/shortcake/cake`.
  - Playwright regression 추가: `유자차 + yuza tea`에서도 첫 `/generate-ui` body가 full catalog(`>40`)를 유지하며 `menu_context[0].id === "yuzu-tea-032"`인지 확인.
- 검증:
  - RED: 새 Playwright test가 기존 코드에서 `americano-001`이 첫 항목이라 실패.
  - GREEN: 새 정렬 로직 후 해당 테스트 통과.
  - live GGUI 앱 경로 재검증: `유자차/yuza tea` -> 화면 추천 1 `Yuzu Tea`, `소금빵/salt bread` -> 추천 1 `Salt Bread`, `딸기 케이크/strawberry cake` -> 추천 1 `Strawberry Shortcake`.
  - 전체 회귀: `npx playwright test module-d/tests/korean-proxy-demo.spec.mjs --reporter=line` 2개 통과, `npm --prefix voice-adaptive-kiosk/module-d run build` 통과, `npm --prefix voice-adaptive-kiosk/module-c test` 18개 통과.

## 2026-05-31 — step-aware menu grounding 레이어 도입

- 목표: GGUI가 메뉴/옵션 추론까지 떠안지 않게 하고, GGUI 앞단에서 현재 step + 한국어 원문/영어 proxy + 메뉴/옵션 DB + order_state를 구조화해 검증된 값만 `/generate-ui`에 넘기도록 변경.
- 변경:
  - `contracts/types.ts`와 `contracts/schemas.py`에 `GroundIntentRequest/Response`, `GroundIntentName`, `GroundItemCandidate` 계약 추가.
  - Module C `src/ground-intent.js` 추가. OpenAI structured output을 사용하되, 반환 item_id/option label은 코드에서 메뉴 DB 기준으로 재검증한다. OpenAI key 없음/실패 시 deterministic fallback으로 데모를 유지한다.
  - Module C `POST /ground-intent` 추가.
  - Module D `groundIntent()` client와 Orchestrator 통합. recommend/options/fulfillment/loyalty/payment/confirm 각 단계에서 현재 step 기준으로 grounding을 먼저 수행하고, 성공 시 state를 반영한 뒤 `/generate-ui`를 호출한다.
  - recommend 단계는 grounding용으로 전체 메뉴 48개를 보내지만, GGUI `/generate-ui`에는 grounding된 top 후보 1~5개만 전달한다. options 이후에는 선택된 메뉴와 order_state 중심으로 전달한다.
  - 후속 step에는 최초 proxy 문장을 계속 넣지 않도록 수정. confirm/payment 단계에서 오래된 `라떼 주문해줘` 문맥이 현재 발화를 오염시키지 않게 했다.
  - live GGUI iframe event polling은 기본 off. 음성 기반 state transition은 Orchestrator grounding이 소유하고, GGUI는 기본적으로 renderer 역할만 한다.
  - 최신 GGUI contract 검증에 맞춰 fulfillment/loyalty/payment propsSpec에 `total`을 선언. GGUI hang 시 Module C가 8초 후 local fallback으로 내려가도록 timeout 추가.
  - Module D의 optional `@ggui-ai/react` runtime import 제거. 해당 패키지의 `zod` peer dependency 누락이 Vite overlay를 만들 수 있어, live GGUI는 `srcDoc`/iframe 경로로 렌더한다.
- 검증:
  - `npm --prefix voice-adaptive-kiosk/module-c test` 26개 통과.
  - `npm --prefix voice-adaptive-kiosk/module-d run typecheck` 통과.
  - `npm --prefix voice-adaptive-kiosk/module-d run build` 통과.
  - `npx playwright test module-d/tests/korean-proxy-demo.spec.mjs --reporter=line` 2개 통과.
  - live `/ground-intent`: `유자차 주문해줘` -> `yuzu-tea-032`, `오트밀크로 덜 달게` -> `{ Milk:"Oat Milk", Sweetness:"Less Sweet" }`, `카드로 결제` -> `Credit Card`.
  - live 데모 URL `http://127.0.0.1:5173/`: 유자차/소금빵/딸기 케이크/라떼 4개 recommend 케이스에서 grounding input은 메뉴 48개, GGUI input은 1~5개 후보, 모두 `X-GGUI-Path=ggui`.
  - live 전체 라떼 주문 플로우: `라떼 주문해줘 -> caffe latte -> iced large -> take out -> skip points -> credit card -> yes`가 recommend/options/fulfillment/loyalty/payment/confirm 전 단계를 거쳐 `Payment Complete!`까지 성공. 기록상 6번의 `/generate-ui` 모두 `X-GGUI-Path=ggui`, fallback 0회.

## 2026-05-31 — 루트 `ggui/` submodule 제거 가능성 점검

- 사용자 질문: 로컬 `ggui/` repo는 더 이상 쓰지 않고 published package/npx 기반으로만 쓰는 것 아니냐는 확인.
- 확인 결과:
  - 루트 `ggui/`는 `.gitmodules`에 등록된 submodule이며 index상 `160000 619ae2e... ggui` gitlink다.
  - 현재 실행 경로는 `voice-adaptive-kiosk/run.sh`가 `npx -y @ggui-ai/cli@${GGUI_CLI_VERSION:-0.2.0-alpha.4} serve ...`로 GGUI MCP 서버를 띄운다.
  - Module D는 optional dependency `@ggui-ai/react`를 package 설치 대상으로만 갖고 있고, 최근 구현은 `srcDoc`/iframe 렌더를 사용한다.
  - `rg` 기준 앱 코드/스크립트에서 `../ggui` 또는 루트 `ggui/` 로컬 경로를 직접 참조하는 실행 경로는 발견되지 않았다.
  - `git -C ggui status --short`는 clean.
- 결론: 현재 기준 로컬 `ggui/` submodule은 삭제해도 동작 경로에는 영향이 없어 보인다. 삭제 시에는 단순 폴더 삭제가 아니라 `git submodule deinit -f ggui`, `git rm -f ggui`, `.gitmodules` 제거/정리, 필요 시 `.git/modules/ggui` 정리까지 함께 해야 한다.
- 후속 조치: 사용자 확인 후 `git submodule deinit -f ggui`, `git rm -f ggui`, `rm -rf .git/modules/ggui`, `git rm -f .gitmodules`로 로컬 GGUI submodule과 빈 `.gitmodules`를 제거했다.
- 제거 후 확인: `ggui/` 폴더 없음, `.git/modules/ggui` 없음, `git config --get-regexp '^submodule\.ggui\.'` 결과 없음. 현재 실행은 계속 `npx @ggui-ai/cli@0.2.0-alpha.4` 기반이다.

## 2026-05-31 — Whisper/upload STT 레거시 제거

- 사용자 지적: 이전 Whisper 기반 STT 결정을 되돌렸는데 관련 레거시가 남아 있을 가능성이 있어 제거 필요.
- 변경:
  - Module A에서 `POST /analyze` multipart audio STT endpoint 제거. 현재 A 역할은 `/realtime/session`, `/tts`, `/health`만.
  - `module-a/inference/stt.py`, `tests/test_stt_config.py`, `requirements-public-age.txt` 삭제.
  - `requirements.txt`에서 `librosa`, `numpy`, `python-multipart`, `soundfile` 제거.
  - `.env.example`, `module-a/.env.example`, `run.sh`, Module A/D README, SPEC/PIPELINE/PLAN/NEXT_TASKS/specs 문서를 Realtime 중심 구조로 갱신.
  - 로컬 ignored `module-a/vendor/` Vox-Profile clone 제거.
  - Module D `analyze()`는 Realtime transcript wrapper만 남기고 live audio upload fallback 호출을 제거.
- TDD: `tests/test_no_legacy_stt.py` 추가. 기존 코드에서 `/analyze` 등록과 health `stt_model` 노출 때문에 RED 실패 확인 후 제거.
