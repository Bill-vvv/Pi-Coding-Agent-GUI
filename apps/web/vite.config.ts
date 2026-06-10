import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backendPort = parsePort(process.env.PI_GUI_BACKEND_PORT ?? process.env.PORT, 8787);
const webPort = parsePort(process.env.PI_GUI_WEB_PORT ?? process.env.VITE_PORT, undefined);
const webHost = process.env.PI_GUI_WEB_HOST?.trim() || "127.0.0.1";
const backendOrigin = process.env.PI_GUI_BACKEND_ORIGIN?.trim() || `http://127.0.0.1:${backendPort}`;
const backendWsOrigin = backendOrigin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

export default defineConfig({
  plugins: [react()],
  server: {
    host: webHost,
    ...(webPort ? { port: webPort, strictPort: true } : {}),
    proxy: {
      "/ws": {
        target: backendWsOrigin,
        ws: true,
      },
      "/api": {
        target: backendOrigin,
        changeOrigin: true,
      },
    },
  },
});

function parsePort(value: string | undefined, fallback: number): number;
function parsePort(value: string | undefined, fallback: undefined): number | undefined;
function parsePort(value: string | undefined, fallback: number | undefined): number | undefined {
  if (!value?.trim()) return fallback;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}
