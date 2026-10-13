/**
 * Emits /sw.js into the client build: scripts/sw-template.js with the app
 * version + build id and the list of hashed files to keep for offline use.
 * Each build gives a different sw.js, so the browser picks up a new version.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function renderServiceWorker(template, { version, files }) {
  const precache = [...new Set(files)].filter((file) => /\.(js|css|woff2?|svg|png|webp)$/.test(file)).sort().map((file) => `/${file}`);
  const build = createHash("sha256").update(precache.join("\n")).digest("hex").slice(0, 10);
  return template.replace("__VERSION__", `${version}-${build}`).replace('["__PRECACHE__"]', JSON.stringify(precache));
}

export function swPlugin({ version }) {
  const template = readFileSync(new URL("./sw-template.js", import.meta.url), "utf8");
  return {
    name: "pora:service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const env = this.environment;
      if (env && env.name !== "client") return;
      const files = Object.values(bundle).map((item) => item.fileName).filter((name) => name.startsWith("assets/"));
      if (!files.length) return;
      this.emitFile({ type: "asset", fileName: "sw.js", source: renderServiceWorker(template, { version, files }) });
    },
  };
}
