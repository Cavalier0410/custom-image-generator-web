import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  app.includes('const DEFAULT_BASE_URL = "https://api.lts4ai.com"') && app.includes("baseUrl: DEFAULT_BASE_URL"),
  "Default Base URL must be https://api.lts4ai.com."
);

assert(
  app.includes('"http://64.186.244.43:12001"') && app.includes("LEGACY_DEFAULT_BASE_URLS"),
  "The old default Base URL must be migrated for existing localStorage users."
);

assert(!app.includes("<span>种子</span>"), "Seed label must not be rendered in the parameter panel.");
assert(!app.includes("· seed"), "Seed metadata must not be shown in the result panel.");
assert(!app.includes("seed-control"), "Seed-specific control class must not be used.");
assert(!app.includes("seedLocked"), "Seed lock state must not exist in the UI.");
assert(!app.includes("workspace.seed"), "Workspace seed state must not be used by the UI.");
assert(!types.includes("seedLocked"), "WorkspaceState must not expose seedLocked.");

console.log("UI contract checks passed.");
