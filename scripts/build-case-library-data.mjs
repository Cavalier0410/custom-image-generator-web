import { readFileSync, writeFileSync } from "node:fs";

const sourcePath = new URL("../public/cases.json", import.meta.url);
const indexPath = new URL("../public/cases-index.json", import.meta.url);
const promptsPath = new URL("../public/case-prompts.json", import.meta.url);

const source = JSON.parse(readFileSync(sourcePath, "utf8"));

const indexPayload = {
  repository: source.repository,
  totalCases: source.totalCases,
  categories: source.categories,
  styles: source.styles,
  scenes: source.scenes,
  cases: source.cases.map((caseItem) => ({
    id: caseItem.id,
    title: caseItem.title,
    image: caseItem.image,
    imageAlt: caseItem.imageAlt,
    sourceLabel: caseItem.sourceLabel,
    sourceUrl: caseItem.sourceUrl,
    promptPreview: caseItem.promptPreview,
    category: caseItem.category,
    styles: caseItem.styles,
    scenes: caseItem.scenes,
    featured: caseItem.featured,
    githubUrl: caseItem.githubUrl
  }))
};

const promptsPayload = {
  prompts: Object.fromEntries(source.cases.map((caseItem) => [caseItem.id, caseItem.prompt]))
};

writeFileSync(indexPath, JSON.stringify(indexPayload));
writeFileSync(promptsPath, JSON.stringify(promptsPayload));

console.log(`Wrote ${indexPayload.cases.length} case index rows and ${Object.keys(promptsPayload.prompts).length} prompts.`);
