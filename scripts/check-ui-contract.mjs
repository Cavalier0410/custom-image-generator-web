import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  app.includes('const DEFAULT_BASE_URL = "https://api.lts4ai.com"') && app.includes("baseUrl: DEFAULT_BASE_URL"),
  "Default Base URL must be https://api.lts4ai.com."
);
assert(app.includes("const INPUT_IMAGE_LIMIT = 12;"), "Reference image upload limit must be 12.");
assert(app.includes("imageFiles.slice(0, action.mode === \"replace\" ? 1 : INPUT_IMAGE_LIMIT)"), "Batch upload must honor the image limit.");
assert(app.includes("inputImages.length >= INPUT_IMAGE_LIMIT"), "Add-image control must disable at the image limit.");

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

assert(index.includes("<title>image studio-你的专属生图台</title>"), "Browser tab title must use the Image Studio branding.");
assert(index.includes('rel="icon"') && index.includes("/image-studio-icon.svg"), "Browser tab must use the Image Studio icon.");
assert(app.includes('href="https://ctikki.com"'), "Brand title must link to ctikki.com.");
assert(app.includes(">Image Studio<"), "Primary brand title must render Image Studio.");
assert(app.includes("/image-studio-icon.svg"), "Header brand mark must use the Image Studio icon.");
assert(app.includes("downloadSelectedHistory"), "History manager must support batch image downloads.");
assert(app.includes('title="下载选中"'), "History manager must expose a selected-download button.");
assert(app.includes("selectedItems.forEach((item) => downloadDataUrl"), "Batch download must reuse the existing image downloader.");

console.log("UI contract checks passed.");
