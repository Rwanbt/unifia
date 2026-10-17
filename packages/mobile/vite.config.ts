import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import appPlugin from "@opencode/app/vite"

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [appPlugin],
  publicDir: fileURLToPath(new URL("../app/public", import.meta.url)),
  define: {
    "import.meta.env.VITE_OPENCODE_SERVER_MODE": JSON.stringify("none"),
    "import.meta.env.VITE_OPENCODE_NATIVE_MOBILE": JSON.stringify(true),
  },
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "esnext", sourcemap: false },
})
