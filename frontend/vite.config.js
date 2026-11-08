import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const backend = process.env.AVALON_BACKEND_URL || "http://127.0.0.1:8000";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      [
        "/signup",
        "/login",
        "/profile",
        "/leaderboard",
        "/rooms",
        "/images",
        "/ws",
        "/lobbies_ws",
      ].map((path) => [
        path,
        { target: backend, ws: path === "/ws" || path === "/lobbies_ws" },
      ]),
    ),
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        wiki: fileURLToPath(new URL("./wiki.html", import.meta.url)),
      },
    },
  },
  test: { environment: "jsdom", restoreMocks: true },
});
