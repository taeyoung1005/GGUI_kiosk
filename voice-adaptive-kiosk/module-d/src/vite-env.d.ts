/// <reference types="vite/client" />

// VITE_ 환경변수 타입 힌트 (브라우저 노출).
interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string;
  readonly VITE_CONVERSATIONAL?: string;
  readonly VITE_ANALYZE_URL?: string;
  readonly VITE_REALTIME_URL?: string;
  readonly VITE_MENU_URL?: string;
  readonly VITE_GGUI_URL?: string;
  readonly VITE_ANALYZE_API_KEY?: string;
  readonly VITE_GGUI_EMBED?: string;
  readonly VITE_PORT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
