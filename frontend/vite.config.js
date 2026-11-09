import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
const backend = process.env.AVALON_BACKEND_URL || "http://127.0.0.1:8000";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Let updates activate after all app windows close, never during a match.
      registerType: "prompt",
      injectRegister: "script",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Avalon Online",
        short_name: "Avalon",
        description: "Play The Resistance: Avalon with friends in real time.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#2a241b",
        background_color: "#2a241b",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,json}"],
        cleanupOutdatedCaches: true,
        // Only the app entry uses the SPA fallback; APIs must reach the server.
        navigateFallback: "index.html",
        navigateFallbackAllowlist: [/^\/(?:index\.html)?(?:\?.*)?$/],
      },
    }),
  ],
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
