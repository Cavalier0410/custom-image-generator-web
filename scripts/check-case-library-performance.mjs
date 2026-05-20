import { existsSync, readFileSync } from "node:fs";
import zlib from "node:zlib";

const caseLibrary = readFileSync(new URL("../src/caseLibrary.ts", import.meta.url), "utf8");

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

console.log("Case library performance checks passed.");
