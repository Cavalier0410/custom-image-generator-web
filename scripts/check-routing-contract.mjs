import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const rewriteSources = vercel.rewrites?.map((rewrite) => rewrite.source) ?? [];
const rewriteDestinations = vercel.rewrites?.map((rewrite) => rewrite.destination) ?? [];

assert(!api.includes('fetch("/api/models"'), "Model loading must not call the removed /api/models wrapper.");
assert(!api.includes('fetch("/api/generate"'), "Image generation must not call the removed /api/generate wrapper.");
assert(rewriteSources.includes("/v1/:path*"), "Vercel must proxy /v1 provider calls.");
assert(rewriteSources.includes("/v1beta/:path*"), "Vercel must proxy /v1beta provider calls.");
assert(
  rewriteDestinations.includes("https://api.lts4ai.com/v1/:path*"),
  "Vercel /v1 proxy must target api.lts4ai.com."
);
assert(
  rewriteDestinations.includes("https://api.lts4ai.com/v1beta/:path*"),
  "Vercel /v1beta proxy must target api.lts4ai.com."
);
assert(!rewriteSources.includes("/api/:path*"), "Vercel must not proxy removed /api wrapper paths.");
assert(vite.includes('"/v1"') && vite.includes('"/v1beta"'), "Vite dev proxy must support provider paths.");

console.log("Routing contract checks passed.");
