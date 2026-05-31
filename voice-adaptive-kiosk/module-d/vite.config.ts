import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vite 설정 — React + contracts/ 정본 타입 공유.
// 루트(상위)의 contracts/ 폴더를 import 할 수 있도록 fs.allow 와 alias 를 연다.
export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, "..");
  const env = loadEnv(mode, repoRoot, "VITE_");
  const port = Number(env.VITE_PORT) || 5173;

  return {
    // 루트 .env 하나만 사용한다. module-d/.env 는 공개 실행 경로에서 쓰지 않는다.
    envDir: repoRoot,
    plugins: [react()],
    resolve: {
      alias: {
        // @contracts/types, @contracts/mocks 로 루트 정본 계약 import
        "@contracts": path.resolve(repoRoot, "contracts"),
      },
    },
    server: {
      port,
      host: true,
      allowedHosts: true,
      proxy: {
        "/api/a": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/a/, ""),
        },
        "/api/b": {
          target: "http://127.0.0.1:8001",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/b/, ""),
        },
        "/api/c": {
          target: "http://127.0.0.1:8002",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/c/, ""),
        },
      },
      // 상위 contracts/ 디렉토리 import 허용 (Vite 5 보안 기본값 우회)
      fs: { allow: [repoRoot] },
    },
    preview: { port },
  };
});
