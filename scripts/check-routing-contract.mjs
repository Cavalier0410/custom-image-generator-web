import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const rewriteSources = vercel.rewrites?.map((rewrite) => rewrite.source) ?? [];

assert(!api.includes('fetch("/api/models"'), "Model loading must not call the removed /api/models wrapper.");
assert(!api.includes('fetch("/api/generate"'), "Image generation must not call the removed /api/generate wrapper.");
assert(api.includes("return target.toString();"), "Provider requests must go directly to the configured Base URL.");
assert(api.includes('SUFY_IMAGE_MODEL_ID = "openai/gpt-image-2"'), "Browser model sorting must explicitly recognize the Sufy image model.");
assert(api.includes('return -2;') && api.includes("isSufyImageModelId"), "Browser model sorting must put Sufy image model before legacy gpt-image-2.");
assert(app.includes('PREFERRED_IMAGE_MODEL_ID = "openai/gpt-image-2"'), "Workspace model selection must prefer the Sufy image model when available.");
assert(!rewriteSources.includes("/api/:path*"), "Vercel must not proxy removed /api wrapper paths.");
assert(!rewriteSources.includes("/v1/:path*"), "Vercel must not proxy /v1 provider calls.");
assert(!rewriteSources.includes("/v1beta/:path*"), "Vercel must not proxy /v1beta provider calls.");
assert(!vite.includes('"/v1"') && !vite.includes('"/v1beta"'), "Vite dev proxy must not hide provider routing issues.");

console.log("Routing contract checks passed.");
