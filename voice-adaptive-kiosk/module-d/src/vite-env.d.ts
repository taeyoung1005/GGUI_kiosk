/// <reference types="vite/client" />

// VITE_ 환경변수 타입 힌트 (브라우저 노출).
interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string;
  readonly VITE_ANALYZE_URL?: string;
  readonly VITE_MENU_URL?: string;
  readonly VITE_GGUI_URL?: string;
  readonly VITE_ANALYZE_API_KEY?: string;
  readonly VITE_PORT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// @ggui-ai/react 는 optionalDependency — 미설치 시 빌드가 깨지지 않도록 모듈 선언.
declare module "@ggui-ai/react" {
  // 실제 export 형태는 GGUI 런타임에 위임. 사용 측에서 안전 가드 후 동적 import 한다.
  export const GGUIEmbed: any;
  const _default: any;
  export default _default;
}
