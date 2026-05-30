# voicegen — ElevenLabs 테스트/데모 음성 생성

해커톤 현장에 노인이 없어 실제 발화 테스트가 어렵다 → **ElevenLabs TTS로 연령대별·상황별 주문 발화를 합성**해 파이프라인 테스트와 데모 리플레이에 사용한다.

## ⚠️ 용도 (중요)

| 용도 | 가부 | 이유 |
|------|------|------|
| 파이프라인(`/analyze`) 테스트 오디오 | ✅ | 노인 없이 행동신호·나이 경로 점검 |
| 무대 사고 대비 **리플레이 데모** | ✅ | 마이크·소음 사고에도 결정적 시연 |
| 나이 분류기 **학습 데이터** | ❌ | 합성↔실음성 **도메인 갭** → 일반화 실패. 학습은 실제 AIHub 71320(`module-a/training/`)으로 |
| 특정 실존 인물(AIHub 화자) 목소리 **복제** | ⚠️ | 동의·ToS 이슈 → 라이브러리/디자인 보이스 권장 |

## 핵심 인사이트

- **합성 '노인 목소리'가 나이 분류기를 못 속여도 OK.** 우리 주 신호는 *행동신호(속도·머뭇)* 다. `phrases.json`의 `…`·`어/음/그`가 **느림·채움말·침묵**을 만들어 `assist_level`을 올린다 → 나이 모델과 무관하게 적응 UI가 검증된다.
- `--verify`로 **생성 → /analyze → 결과 확인** 루프를 돌려, 합성 발화가 실제로 어떤 `age_group`/`assist_level`로 잡히는지 즉시 본다.

## 사용법

```bash
# 1) 키 + 보이스 설정
export ELEVENLABS_API_KEY=sk_...
#    voices.json 의 REPLACE_WITH_*_VOICE_ID 를 본인 ElevenLabs 한국어 보이스 ID로 교체
#    (대시보드 > Voices > 보이스의 ID 복사. 모델은 eleven_multilingual_v2)

# 2) 생성 (phrases.json 전부 → samples/<persona>/<id>.wav, 16kHz mono)
python generate.py
python generate.py --only elder_latte_hesitant     # 하나만

# 3) 검증 (Module A 가 :8000 에 떠 있어야 함)
python generate.py --verify         # 생성 + 검증
python generate.py --verify-only    # 기존 wav만 검증
```

- 의존성 없음(파이썬 stdlib만). Module A `/analyze`는 `{audio_base64}` JSON 입력을 받는다.
- 출력 `samples/elder/*.wav`, `samples/youth/*.wav` → 데모 리플레이 또는 `/analyze` 입력으로 사용.

## 데모 리플레이 활용

`samples/`의 wav를 Module D에 "리플레이 버튼"으로 연결하면, 마이크 없이도 **느린 어르신 발화 → 적응 UI / 빠른 청년 발화 → 압축 UI** 대조를 무대에서 결정적으로 보여줄 수 있다(라이브 마이크는 폴백으로 병행).
