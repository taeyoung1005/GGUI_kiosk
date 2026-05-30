import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vite 설정 — React + contracts/ 정본 타입 공유.
// 루트(상위)의 contracts/ 폴더를 import 할 수 있도록 fs.allow 와 alias 를 연다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const port = Number(env.VITE_PORT) || 5173;
  const repoRoot = path.resolve(__dirname, "..");

  return {
    plugins: [react()],
    resolve: {
      alias: {
        // @contracts/types, @contracts/mocks 로 루트 정본 계약 import
        "@contracts": path.resolve(repoRoot, "contracts"),
      },
    },
    // @ggui-ai/react 는 optionalDependency(런타임 동적 import). 미설치/불완전 의존성이
    // 빌드를 깨지 않도록 dep 최적화에서 제외한다. 실패 시 AdaptiveKiosk 가 iframe 으로 폴백.
    optimizeDeps: {
      exclude: ["@ggui-ai/react"],
    },
    build: {
      rollupOptions: {
        // GGUI 임베드 트리(+ 그 transitive zod)는 외부화 → 번들에서 분리.
        // 동적 import 는 try/catch 로 감싸 미해석 시 iframe 으로 안전 폴백한다.
        external: [/^@ggui-ai\//, "zod"],
      },
    },
    server: {
      port,
      host: true,
      // 상위 contracts/ 디렉토리 import 허용 (Vite 5 보안 기본값 우회)
      fs: { allow: [repoRoot] },
    },
    preview: { port },
  };
});
