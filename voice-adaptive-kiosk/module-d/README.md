# Module D — Web Kiosk Frontend

React + Vite frontend for the Giosk demo.

The live voice path is:

```text
browser mic -> OpenAI Realtime WebRTC conversation
  -> assistant audio + function calls -> Orchestrator tools
  -> Module C /ground-intent -> Module C /generate-ui -> GGUI/local renderer
  -> Module B /orders
```

Module D no longer uploads audio to Module A for Whisper/STT. Module A only
issues the Realtime ephemeral token. The Realtime model speaks directly over
the WebRTC audio track.

## Quick Start

```bash
cd module-d
npm install
npm run dev
```

## Environment

All Vite variables are read from the project root `.env` via
`voice-adaptive-kiosk/.env.example`. Do not keep a separate `module-d/.env`.

```bash
VITE_USE_MOCK=false
VITE_CONVERSATIONAL=true
VITE_ANALYZE_URL=http://localhost:8000
VITE_REALTIME_URL=http://localhost:8000
VITE_MENU_URL=http://localhost:8001
VITE_GGUI_URL=http://localhost:8002
```

| Step | Call | Module |
|------|------|--------|
| Realtime token | `POST {VITE_REALTIME_URL}/realtime/session` | A |
| Menu | `GET {VITE_MENU_URL}/menu` | B |
| Grounding | `POST {VITE_GGUI_URL}/ground-intent` | C |
| Adaptive UI | `POST {VITE_GGUI_URL}/generate-ui` | C |
| Order | `POST {VITE_MENU_URL}/orders` | B |

`VITE_USE_MOCK=true` keeps the UI flow local with contract mocks.
`VITE_CONVERSATIONAL=false` keeps the previous staged voice flow as a fallback.
