import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const caseLibraryData = JSON.parse(readFileSync(new URL("../public/cases.json", import.meta.url), "utf8"));
let caseLibrary = "";

try {
  caseLibrary = readFileSync(new URL("../src/caseLibrary.ts", import.meta.url), "utf8");
} catch {
  caseLibrary = "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(caseLibrary.includes("export interface CaseLibraryItem"), "Case library must expose a typed case item contract.");
assert(caseLibraryData.cases.length >= 300, "Case library must include the full source gallery data.");
assert(caseLibrary.includes("awesome-gpt-image-2"), "Case library must credit the source project.");
assert(caseLibrary.includes("CASE_LIBRARY_CATEGORIES"), "Case library must expose filterable categories.");

assert(app.includes("loadCaseLibrary"), "App must load the case library data.");
assert(app.includes("loadCasePrompts"), "App must load full prompts separately.");
assert(app.includes("caseLibraryQuery"), "Case library must support search.");
assert(app.includes("selectedCaseCategory"), "Case library must support category filtering.");
assert(app.includes("activeView"), "App must support top-level tab navigation.");
assert(app.includes('activeView === "cases"'), "Case library must render as its own tab page.");
assert(app.includes("isMobileCaseDetailOpen"), "Case library must track mobile detail visibility.");
assert(app.includes("openCaseDetail"), "Case library cards must open a dedicated detail experience.");
assert(app.includes("copyCasePrompt"), "Case library must support copying prompts.");
assert(
  app.includes("casePromptsById") && app.includes('promptMode: "count"') && app.includes('setActiveView("studio")'),
  "Case prompts must be reusable in the current generation workspace."
);
assert(app.includes("案例专区") && app.includes("套用到工作台"), "Case library UI must render Chinese actions for browsing and reuse.");

assert(styles.includes(".view-tabs"), "Top-level tabs must have dedicated styling.");
assert(styles.includes(".case-library-page"), "Case library tab must have dedicated page styling.");
assert(styles.includes(".case-library-grid"), "Case cards must be displayed in a responsive grid.");
assert(styles.includes(".case-library-detail"), "Selected case details must have dedicated styling.");
assert(styles.includes(".case-detail-sheet"), "Mobile detail sheet must have dedicated styling.");

assert(packageJson.includes("test:case-library"), "Case library contract must run from npm scripts.");

console.log("Case library contract checks passed.");
