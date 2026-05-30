# voicegen — ElevenLabs 검증·실시간 랜덤 생성 (자립형 모듈 명세)

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙). 데모 언어 = 영어.
> 이 문서 하나만 보고 새 세션이 혼자서 voicegen을 빌드·실행·검증할 수 있도록 작성됨.
> 위치: `tools/voicegen/`. 포트 소유 없음(클라이언트 도구). 검증 대상 = Module A `/analyze`(:8000).

---

## 1. 목적·책임 (이 모듈 범위)

해커톤 현장에 실제 노인이 없어 연령대별 실음성 테스트가 어렵다. voicegen은 **ElevenLabs TTS로
영어 주문 발화를 합성**해 다음 두 용도로만 쓴다.

| 용도 | 가부 | 설명 |
|------|------|------|
| (a) `/analyze` **파이프라인 검증** | ✅ | 합성 wav → Module A `/analyze` 호출 → `age_group`/`assist_level` 결과 확인 (`generate.py --verify`) |
| (b) **데모용 실시간 랜덤 연령대 생성** | ✅ | 무대에서 노인/청년 발화를 즉석/리플레이로 재생해 적응 UI 대조 시연 |
| 나이 분류기 **학습 데이터** | ❌ **금지** | 합성↔실음성 **도메인 갭** → 일반화 실패. 학습은 실제 AIHub 71320(`module-a/training/`)으로만 |
| 특정 실존 인물(AIHub 화자) 목소리 복제 | ⚠️ | 동의·ToS 이슈 → 라이브러리/디자인 보이스 권장 |

**핵심 인사이트:** 합성 '노인 목소리'가 나이 분류기를 못 속여도 OK다. 우리 주 신호는
**행동신호(속도·머뭇거림 = `assist_level`)** 이고, `phrases.json`의 `...`·`uh/um/er`이
느림·채움말·침묵을 만들어 나이 모델과 무관하게 적응 UI를 검증한다.

책임 경계: voicegen은 **wav 생성 + `/analyze` 호출만** 한다. STT·나이·행동신호 산출은 Module A,
UI 생성은 Module C 소관이다. voicegen은 어떤 서버도 띄우지 않는 CLI 도구다(현재).

---

## 2. 소유 세션 / 누가 개발

- **owner = Codex** (module-a wavlm AI + voicegen + 메뉴데이터/영어전환 담당).
- Claude는 module-c(GGUI 실연결)·통합 담당이므로 이 모듈을 수정하지 않는다.

---

## 3. 입출력 계약 (병합 glue)

voicegen은 **새 타입을 생산하지 않는다.** 오직 Module A `/analyze`를 **소비(호출)** 하고,
그 응답인 `AnalyzeResult`(contracts/types.ts)를 사람이 읽기 좋게 요약 출력한다.
즉 voicegen의 유일한 계약 접점 = **`/analyze` 요청 형식 + `AnalyzeResult` 응답 형식**.

### 3.1 voicegen → A: `/analyze` 요청 (voicegen이 생산하는 것)

`generate.py`의 `verify()`는 wav를 base64로 인코딩해 **JSON 본문**으로 POST 한다.

```
POST http://localhost:8000/analyze
Content-Type: application/json

{ "audio_base64": "<base64(wav 16kHz mono PCM s16le)>" }
```

> Module A `/analyze`는 `multipart(file=audio.wav)` 와 `JSON({audio_base64})` 둘 다 받는다
> (module-a/app.py 확인). voicegen은 **JSON `audio_base64` 경로**를 사용한다.
> 생성 wav 포맷: 16kHz / mono / 16-bit PCM (ElevenLabs `output_format=pcm_16000` → `write_wav`).

### 3.2 A → voicegen: `AnalyzeResult` 응답 (voicegen이 소비하는 것)

contracts/types.ts의 `AnalyzeResult` 그대로. voicegen이 읽는 필드 = `transcript`,
`age.group`, `age.years_est`, `behavioral.assist_level`, `behavioral.speech_rate`,
`behavioral.filler_count`.

예시 JSON (어르신·느린 발화, 적응 강도 2):
```json
{
  "transcript": "can I get a latte",
  "language": "en",
  "age":        { "group": "50+", "years_est": 67, "confidence": 0.72, "child_prob": 0.02 },
  "behavioral": { "speech_rate": 2.8, "silence_ratio": 0.46, "filler_count": 2, "assist_level": 2 },
  "duration_ms": 4600
}
```

`verify()`가 출력하는 한 줄(검증 로그):
```
transcript='can I get a latte' age=50+(~67) assist_level=2 rate=2.8 fillers=2
```

> **계약 일치 책임:** voicegen은 위 필드명을 그대로 읽으므로, Module A가
> `age.group`/`behavioral.assist_level` 구조를 바꾸면 verify 출력이 깨진다.
> 이 구조의 정본은 contracts/types.ts (변경 금지, §8).

---

## 4. 기술 스택 + 파일 트리 (현재 실제)

- **언어/런타임:** Python 3, **stdlib만** (`urllib`·`wave`·`base64`·`json`·`argparse`). 외부 패키지·pip 설치 불필요.
- **외부 의존:** ElevenLabs TTS HTTP API (`https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=pcm_16000`).
- **env:** `ELEVENLABS_API_KEY`(필수, 생성 시), `ANALYZE_URL`(기본 `http://localhost:8000`). `.env.local` 자동 로드(셸 export 우선).

```
tools/voicegen/
├── generate.py      # CLI: 생성(synth→write_wav) + 검증(verify→/analyze). 진입점 main()
├── phrases.json     # 테스트/데모 영어 발화 6종 (persona·text·intent·expect)
├── voices.json      # persona(elder/youth) → ElevenLabs voice_id + voice_settings + model_id
├── .env.local       # ELEVENLABS_API_KEY(빈값), ANALYZE_URL=http://localhost:8000 (git 무시)
├── README.md        # 사용 안내 (이 명세의 축약본)
└── samples/         # 출력 디렉토리 — samples/<persona>/<id>.wav (현재 비어 있음, .gitkeep 없음)
```

### 4.1 generate.py 핵심 함수 (실제 시그니처)

| 함수 | 역할 |
|------|------|
| `synth(text, voice_id, settings, model_id, api_key)` | ElevenLabs TTS POST → raw PCM s16le 16kHz bytes |
| `write_wav(path, pcm, rate=16000)` | PCM → WAV(1ch/16-bit/16kHz) 파일 저장 |
| `verify(path)` | wav → base64 → `POST {ANALYZE_URL}/analyze` → 결과 한 줄 요약 문자열 |
| `_load_dotenv()` | `.env.local`/`.env` → `os.environ` (setdefault, 셸 export 우선) |
| `main()` | `--only`/`--verify`/`--verify-only` 인자 처리, phrases 순회 |

### 4.2 phrases.json — 발화 6종 (영어)

| id | persona | text | 기대(expect) |
|----|---------|------|--------------|
| `elder_latte_hesitant` | elder | `Uh... um... can I get... a latte?` | 50+, assist 2~3 (느림+채움말+침묵) |
| `elder_latte_plain` | elder | `Can I get a latte, please?` | 50+, assist 1~2 |
| `elder_ambiguous` | elder | `Um... I'd like something cold... anything is fine.` | 50+, assist 3 (추천 카드 2~3) |
| `youth_ice_americano_fast` | youth | `One iced americano, please.` | under50, assist 0 (압축/빠른 결제) |
| `youth_vanilla_latte` | youth | `A hot vanilla latte, please.` | under50, assist 0~1 |
| `elder_recovery` | youth(text=elder 시나리오) | `No... not that one... a different one.` | assist 2~3 (재발화 복구 데모) |

### 4.3 voices.json — persona 매핑 (현재 상태)

```json
{
  "model_id": "eleven_multilingual_v2",
  "personas": {
    "elder": { "voice_id": "REPLACE_WITH_ELDER_KO_VOICE_ID",
               "voice_settings": { "stability": 0.6, "similarity_boost": 0.7, "style": 0.2, "speed": 0.8 } },
    "youth": { "voice_id": "REPLACE_WITH_YOUTH_KO_VOICE_ID",
               "voice_settings": { "stability": 0.4, "similarity_boost": 0.7, "style": 0.3, "speed": 1.05 } }
  }
}
```
> `voice_id`가 `REPLACE_`로 시작하면 generate.py가 즉시 종료(에러)한다. 데모는 영어 발화이므로
> **영어 elderly / 영어 일반 보이스**를 ElevenLabs 라이브러리 또는 Voice Design에서 받아 채운다
> (키 이름의 `_KO_`는 무시 가능, 값만 영어 보이스 ID로 교체).

---

## 5. 독립 개발 (격리) — 다른 모듈 없이 도는 법

voicegen은 Module A `/analyze`에만 의존한다. A가 없을 때 **A를 mock**해서 검증 루프를 돌린다.

### 5.1 ElevenLabs 키가 없을 때 (생성 격리)

`samples/`에 이미 생성된 wav가 있으면 **생성을 건너뛰고 검증만** 한다 → ElevenLabs 키 불필요:
```bash
python generate.py --verify-only      # 기존 samples/*.wav 만 /analyze로 검증
```
키도 없고 wav도 없을 때 빠르게 테스트 wav를 만들려면 stdlib만으로 무음/사인파 wav 1개 생성:
```bash
python -c "import wave,struct,math; w=wave.open('tools/voicegen/samples/elder/elder_latte_plain.wav','wb'); \
w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); \
w.writeframes(b''.join(struct.pack('<h',int(3000*math.sin(2*math.pi*180*t/16000))) for t in range(16000*2))); w.close()"
```
> 이 합성 사인파는 STT가 빈 transcript를 내겠지만 **`/analyze` 왕복·duration·필드 구조 검증**에는 충분하다.

### 5.2 Module A `/analyze`를 mock하는 법 (검증 격리)

`ANALYZE_URL`을 mock 서버로 돌려, A 없이 `verify()` 경로(요청 포맷·응답 파싱)를 단독 검증한다.
contracts/types.ts의 `AnalyzeResult` 형태를 그대로 돌려주는 10줄짜리 stdlib mock:

```bash
# 터미널 1 — A 대역 mock (:8000), AnalyzeResult 고정 JSON 반환
python -c "
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length',0)))
        body = json.dumps({
          'transcript':'can I get a latte','language':'en',
          'age':{'group':'50+','years_est':67,'confidence':0.72,'child_prob':0.02},
          'behavioral':{'speech_rate':2.8,'silence_ratio':0.46,'filler_count':2,'assist_level':2},
          'duration_ms':4600}).encode()
        self.send_response(200); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self,*a): pass
HTTPServer(('127.0.0.1',8000),H).serve_forever()
"

# 터미널 2 — voicegen 검증 (mock A 상대)
ANALYZE_URL=http://localhost:8000 python tools/voicegen/generate.py --verify-only
# 기대 출력: [chk] <id>  transcript='can I get a latte' age=50+(~67) assist_level=2 rate=2.8 fillers=2
```
> 이 mock 모드로 ElevenLabs 키·실제 Module A 둘 다 없이 voicegen 검증 코드 경로를 100% 단독 검증한다.

---

## 6. 실행 — 격리 기동 명령 (env 포함)

작업 디렉토리는 `tools/voicegen/` 기준(상대 경로 phrases.json/voices.json 로드).

```bash
cd tools/voicegen

# 0) 키 + 보이스 설정 (실제 생성 시)
export ELEVENLABS_API_KEY=sk_...           # 또는 .env.local 에 기입
#    voices.json 의 REPLACE_WITH_*_VOICE_ID → 영어 보이스 ID 로 교체

# 1) 생성 (phrases.json 전부 → samples/<persona>/<id>.wav, 16kHz mono)
python generate.py
python generate.py --only elder_latte_hesitant      # 하나만

# 2) 검증 — Module A(:8000) 가 떠 있어야 함 (또는 §5.2 mock A)
python generate.py --verify                          # 생성 + 검증
python generate.py --verify-only                     # 기존 wav 만 검증
ANALYZE_URL=http://localhost:8000 python generate.py --verify

# (참고) 실제 Module A 기동:  cd module-a && uvicorn app:app --port 8000
#        MOCK_MODE=1 로 띄우면 오디오 없이도 고정 AnalyzeResult 반환
```

---

## 7. 테스트·검증 기준 — 이 모듈 단독 통과 항목 (명령 포함)

다음을 **외부 키 없이** 통과해야 한다(§5의 mock 모드 활용).

1. **JSON 유효성** — phrases/voices 파싱:
   ```bash
   python -c "import json; json.load(open('tools/voicegen/phrases.json')); json.load(open('tools/voicegen/voices.json')); print('json ok')"
   ```
2. **CLI 구동** — 인자 파싱·도움말이 죽지 않음:
   ```bash
   python tools/voicegen/generate.py -h
   ```
3. **wav I/O** — `write_wav`가 16kHz/mono/16-bit wav를 쓰고 `wave`로 다시 읽힘 (§5.1 사인파 생성 후):
   ```bash
   python -c "import wave; w=wave.open('tools/voicegen/samples/elder/elder_latte_plain.wav','rb'); \
   assert (w.getframerate(),w.getnchannels(),w.getsampwidth())==(16000,1,2); print('wav ok', w.getnframes())"
   ```
4. **검증 왕복 (mock A)** — §5.2 mock 서버 띄우고 `--verify-only` 실행 →
   `transcript=... age=50+(~67) assist_level=2 ...` 한 줄이 각 phrase마다 출력되면 PASS.
5. **(키 있을 때, 선택) 실제 생성** — `python generate.py --only youth_ice_americano_fast` →
   `samples/youth/youth_ice_americano_fast.wav` 생성, `len(pcm)//2` samples 로그 출력.

> 통과 정의: 1~4가 키·실제 A 없이 그린이면 voicegen은 **단독 검증 완료**. 5는 ElevenLabs 키 확보 시 추가.

---

## 8. 변경 금지

- **contracts/types.ts**(정본) 및 contracts/schemas.py·mocks.* — voicegen이 소비하는 `AnalyzeResult`
  구조의 SSoT. 절대 수정 금지.
- **다른 모듈 코드**(module-a/b/c/d) — voicegen 작업 중 건드리지 않는다. 특히 module-a `/analyze`의
  요청/응답 형식에 의존만 하고 변경하지 않는다.
- voicegen 작업 범위 = `tools/voicegen/` 내부 파일뿐.

---

## 9. 현재 상태 (코드 읽고 사실)

- ✅ `generate.py` 완성·동작 가능: stdlib만으로 ElevenLabs TTS→PCM→WAV, `/analyze` JSON `audio_base64`
  검증 루프(`--verify`/`--verify-only`/`--only`) 구현됨. `.env.local` 자동 로드 포함.
- ✅ phrases.json: 영어 발화 6종 확정(elder 4 / youth 2). `...`·`uh/um/er`로 행동신호 유도 설계 반영.
- ⚠️ **voices.json의 `voice_id` 2개 모두 `REPLACE_*` 플레이스홀더** → ElevenLabs 키+보이스 ID를 채우기
  전에는 실제 wav 생성 불가(generate.py가 즉시 종료). 검증 코드 경로는 §5 mock으로 단독 가능.
- ⚠️ **`samples/` 비어 있음** — 아직 생성된 wav 없음. `--verify-only`는 wav가 생긴 뒤에야 의미.
- ⚠️ `.env.local`의 `ELEVENLABS_API_KEY` 빈값.
- ❗ **"데모용 실시간 랜덤 연령대 생성" 전용 서버는 아직 없음.** 현재는 CLI 일괄 생성(generate.py)뿐.
  실시간 랜덤 데모가 필요하면 별도 도구(예: `server.py` 또는 Module D 리플레이 버튼이 `samples/` wav를
  무작위 선택 재생)로 충족하며, 이때도 §3 `/analyze` 계약은 그대로 유지한다.

남은 것(요약): (1) ElevenLabs 키·영어 보이스 ID 확보 → voices.json 채우기, (2) `python generate.py`로
samples/ 채우기, (3) 실제 Module A 상대 `--verify`로 `assist_level` 대조 확인.

---

## 10. 병합 체크포인트 — 합칠 때 voicegen이 만족해야 할 계약·검증

1. **계약 일치:** voicegen이 부르는 `POST /analyze` 요청 형식(`{audio_base64}` JSON)과 읽는
   응답 필드(`transcript`, `age.group`, `age.years_est`, `behavioral.assist_level`,
   `behavioral.speech_rate`, `behavioral.filler_count`)가 **통합된 Module A 실제 응답과 1:1 일치**.
   (정본 = contracts/types.ts `AnalyzeResult`.)
2. **엔드포인트 일치:** `ANALYZE_URL`이 통합 환경의 Module A 주소(로컬 `:8000` 또는 원격 터널)를 가리킨다.
   원격이면 Module A `API_KEY` 설정 시 voicegen 요청에 인증 헤더가 필요할 수 있음(현재 verify는 Bearer
   미첨부 → 통합 시 A가 `API_KEY` 미설정이거나 voicegen이 localhost 호출일 때만 통과).
3. **대조 시연 검증:** elder 계열 phrase(예 `elder_latte_hesitant`) → `assist_level ≥ 2`,
   youth 계열(예 `youth_ice_americano_fast`) → `assist_level ≤ 1` 로 잡히면 적응 UI 대조가 성립.
   (실제 wav·실제 A로 `python generate.py --verify` 1회 통과를 병합 게이트로 둔다.)
4. **학습 데이터 격리 재확인:** 합성 wav가 module-a `training/` 데이터셋에 **유입되지 않았음** 확인
   (도메인 갭 — 학습은 AIHub 71320만). voicegen 산출물은 테스트/데모 경로에서만 소비된다.
5. **불변식:** voicegen은 통합 시에도 contracts·다른 모듈 코드를 수정하지 않는다(§8).
