# SPEC - Voice-Adaptive Kiosk

OBA Weekend-thon S1, GGUI track.

The current project scope is a working kiosk demo:

1. Standard kiosk UI shows the existing complex ordering flow.
2. A Korean voice order starts the adaptive flow.
3. Module A analyzes voice-derived signals.
4. Module B provides menu and mock order/payment data.
5. Module C returns a local adaptive UI contract/render.
6. Module D presents the kiosk flow and completes payment.

## Current Decisions

- Track focus: GGUI.
- EXAONE and LG U+ voice track are out of scope.
- AIHub direct training is out of scope for this demo and its local pipeline has been removed.
- Age signal uses public pretrained `tiantiaf/wavlm-large-age-sex` through Vox-Profile.
- Age is a rough secondary signal. `behavioral.assist_level` is the primary UI adaptation signal.
- GGUI live generation is the primary/target path for the adaptive (after) demo; Module C local rendering is the fallback used when the GGUI path is unavailable. The live demo currently runs on the local fallback because the GGUI live path is blocked (`ggui_push` codeReady=false); restoring GGUI live remains the goal.
- Module A is API-only. No `/demo` page and no validation artifact dashboard.

## Modules

| Module | Path | Runtime |
|---|---|---|
| A | `module-a/` | FastAPI `:8000`, `POST /analyze`, demo voice helper APIs |
| B | `module-b/` | Express `:8001`, menu/search/orders |
| C | `module-c/` | Express `:8002`, local adaptive renderer with GGUI fallback/probe |
| D | `module-d/` | React/Vite `:5173`, standard/adaptive kiosk UI |
| Contracts | `contracts/` | Shared TS/Python schema and mocks |

## Runtime Flow

```text
Korean voice order
  -> Module A: STT + rough age + behavioral assist signal
  -> Module B: menu/search/order data
  -> Module C: adaptive UI contract/render
  -> Module D: kiosk UI, narration, multi-turn order, mock payment complete
```

## Verification

```bash
npm run verify
PYTHONPATH=. module-a/.venv/bin/python -m unittest discover -s module-a/tests -v
```
