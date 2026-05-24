import { existsSync, readFileSync } from "node:fs";
import zlib from "node:zlib";

const caseLibrary = readFileSync(new URL("../src/caseLibrary.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(existsSync(new URL("../public/cases-index.json", import.meta.url)), "Expected a lightweight case index JSON file.");
assert(existsSync(new URL("../public/case-prompts.json", import.meta.url)), "Expected a separate prompt payload JSON file.");

const casesIndex = JSON.parse(readFileSync(new URL("../public/cases-index.json", import.meta.url), "utf8"));
const casePrompts = JSON.parse(readFileSync(new URL("../public/case-prompts.json", import.meta.url), "utf8"));
const indexBuffer = Buffer.from(JSON.stringify(casesIndex));
const gzipIndexKb = Math.round(zlib.gzipSync(indexBuffer).length / 1024);

assert(Array.isArray(casesIndex.cases) && casesIndex.cases.length > 300, "Case index should contain the full gallery list.");
assert(!("prompt" in casesIndex.cases[0]), "Case index must not ship full prompts.");
assert(gzipIndexKb < 120, `Case index should stay lightweight on first load. Current gzip size: ${gzipIndexKb}KB.`);
assert(Object.keys(casePrompts.prompts ?? {}).length === casesIndex.cases.length, "Prompt payload should cover every case.");

assert(caseLibrary.includes('fetch("/cases-index.json")'), "Case library should load the lightweight index first.");
assert(caseLibrary.includes('fetch("/case-prompts.json")'), "Case library should load prompts separately.");
assert(caseLibrary.includes('/case-previews/'), "Case library should use local preview images for the gallery.");

assert(!app.includes("filteredCaseLibrary.map((caseItem, index)"), "Case cards should be rendered through a virtual window, not a full list map.");
assert(app.includes("CASE_GRID_MIN_COLUMN_WIDTH"), "Virtual grid should preserve the current desktop minimum card width.");
assert(app.includes("measureCaseGrid") && app.includes("ResizeObserver"), "Case grid should measure the live layout before calculating visible cards.");
assert(app.includes("window.scrollY") && app.includes("isCaseGridMobile"), "Mobile case grid virtualization should follow natural page scrolling.");
assert(app.includes("usesWindowScroll"), "Virtual grid should support the existing desktop natural page scroll layout.");
assert(app.includes("visibleCaseLibrary"), "Case library should render only the visible case window.");
assert(app.includes("caseImageLoadState"), "Case cards should track preview image loading state.");
assert(app.includes("onLoad") && app.includes("onError"), "Case preview images should handle loaded and failed states.");

assert(styles.includes(".case-library-grid-viewport"), "Case library should have a virtual scroll viewport.");
assert(styles.includes(".case-library-grid-spacer"), "Case library should reserve the full virtual grid height.");
assert(styles.includes(".case-library-grid-window"), "Case library should position the rendered virtual window.");
assert(styles.includes(".case-image-wrap.is-loading"), "Case previews should have a dedicated loading placeholder state.");
assert(styles.includes("@keyframes case-preview-shimmer"), "Case preview placeholders should include a subtle shimmer animation.");
assert(styles.includes(".case-image-fallback"), "Case previews should show a graceful failed-image fallback.");
assert(
  styles.includes("grid-template-columns: repeat(auto-fill, minmax(190px, 1fr))"),
  "Desktop case card sizing must keep the existing auto-fill minmax(190px, 1fr) rule."
);

console.log("Case library performance checks passed.");
