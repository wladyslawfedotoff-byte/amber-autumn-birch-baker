import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { swPlugin } from "./scripts/sw-plugin.mjs";

const APP_VERSION = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig(({ command, isPreview }) => ({
  // «Версия 1.1.0» in Settings → «Подключение» (single source: package.json).
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    // /sw.js: offline app shell + reminders (build only).
    swPlugin({ version: APP_VERSION }),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            // The Docker image (Synology) runs a long-lived Node server.
            preset: process.env.NITRO_PRESET || "node-server",
            // Registers server/routes, server/middleware and server/plugins
            // (Nitro v3 defaults serverDir to false).
            serverDir: "./server",
            // 1.15: /assets/* are served as ready .br / .gz files (dynamic answers: server/lib/compress.ts).
            compressPublicAssets: { gzip: true, brotli: true },
            // HEIC → JPEG decoder (libheif WASM) reads files next to itself:
            // keep it in node_modules instead of bundling it.
            traceDeps: ["heic-convert*", "heic-decode*", "libheif-js*"],
            // Baseline security headers for everything, including static
            // assets (Nitro serves those before server/middleware runs).
            // CSP and the rest are added by server/middleware/00.guard.ts.
            routeRules: {
              "/**": {
                headers: {
                  "x-content-type-options": "nosniff",
                  "x-frame-options": "DENY",
                  "referrer-policy": "same-origin",
                },
              },
            },
          }),
        ]
      : []),
    viteReact(),
  ],
}));
