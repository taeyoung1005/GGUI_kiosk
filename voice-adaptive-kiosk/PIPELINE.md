# Voice-Adaptive Kiosk Pipeline

Current pipeline is runtime-only. The old AIHub/offline training pipeline was
removed because the demo now uses a public pretrained WavLM age model.

```mermaid
flowchart TD
    MIC["Korean senior voice order (proxy demo input)"] --> D1["Module D<br/>capture / demo trigger"]
    D1 --> A["Module A<br/>STT + rough age + behavioral assist signal"]
    A --> B["Module B<br/>menu/search/order data"]
    B --> C["Module C<br/>local adaptive UI contract/render"]
    C --> D2["Module D<br/>standard/adaptive kiosk UI"]
    D2 --> PAY["Mock payment complete"]
```

## Module Responsibilities

- Module A: `POST /analyze`, ElevenLabs helper APIs, Korean senior proxy route.
- Module B: menu, search, order, mock payment.
- Module C: adaptive UI generation. GGUI live render (`GGUI_MODE=ggui`) is the
  intended demo goal path; currently the `ggui_push` `codeReady=false` blocker
  keeps the `GGUI_MODE=local` fallback render running live.
- Module D: kiosk UI, multi-turn order state, narration (English, `en-US`),
  payment flow.

## Removed From Runtime

- AIHub download/index/clip/split/train/export scripts.
- `models/age_model` checkpoint handoff.
- validation `artifacts/` dashboard data.
- standalone `tools/voicegen`.
