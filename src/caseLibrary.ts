const SOURCE_REPOSITORY = "https://github.com/CTctikki/awesome-gpt-image-2";
const UPSTREAM_REPOSITORY = "https://github.com/freestylefly/awesome-gpt-image-2";
const IMAGE_BASE_URL = "https://raw.githubusercontent.com/CTctikki/awesome-gpt-image-2/main/data";

export interface RawCaseLibraryItem {
  id: number;
  title: string;
  image: string;
  imageAlt: string;
  sourceLabel: string;
  sourceUrl: string;
  prompt?: string;
  promptPreview: string;
  category: string;
  styles: string[];
  scenes: string[];
  featured?: boolean;
  githubUrl: string;
}

export interface RawCaseLibraryData {
  repository: string;
  totalCases: number;
  categories: string[];
  styles?: string[];
  scenes?: string[];
  cases: RawCaseLibraryItem[];
}

export interface CaseLibraryItem {
  id: number;
  title: string;
  category: string;
  image: string;
  thumbImage: string;
  sourceImage: string;
  imageAlt: string;
  sourceLabel: string;
  sourceUrl: string;
  githubUrl: string;
  tags: string[];
  prompt?: string;
  promptPreview: string;
}

export interface CaseLibraryData {
  source: typeof CASE_LIBRARY_SOURCE;
  categories: string[];
  cases: CaseLibraryItem[];
}

export type CasePromptMap = Record<number, string>;

export const CASE_LIBRARY_SOURCE = {
  name: "awesome-gpt-image-2",
  sourceRepository: SOURCE_REPOSITORY,
  totalCases: 0
};

export const CASE_LIBRARY_CATEGORIES: string[] = [];

export const CASE_LIBRARY: CaseLibraryItem[] = [];

let promptMapRequest: null | Promise<CasePromptMap> = null;

function toSourceImageUrl(imagePath: string) {
  return imagePath.startsWith("/") ? `${IMAGE_BASE_URL}${imagePath}` : imagePath;
}

function toPreviewImageUrl(imagePath: string) {
  const fileName = imagePath.split("/").at(-1) ?? imagePath;
  const stem = fileName.replace(/\.(jpg|jpeg|png|webp)$/i, "");
  return `/case-previews/${stem}.webp`;
}

export function normalizeCaseLibrary(rawData: RawCaseLibraryData): CaseLibraryData {
  return {
    source: {
      ...CASE_LIBRARY_SOURCE,
      totalCases: rawData.totalCases
    },
    categories: rawData.categories,
    cases: rawData.cases.map((caseItem) => ({
      id: caseItem.id,
      title: caseItem.title,
      category: caseItem.category,
      image: toPreviewImageUrl(caseItem.image),
      thumbImage: toPreviewImageUrl(caseItem.image),
      sourceImage: toSourceImageUrl(caseItem.image),
      imageAlt: caseItem.imageAlt,
      sourceLabel: caseItem.sourceLabel,
      sourceUrl: caseItem.sourceUrl,
      githubUrl: caseItem.githubUrl.replace(UPSTREAM_REPOSITORY, SOURCE_REPOSITORY),
      tags: [...new Set([...(caseItem.styles ?? []), ...(caseItem.scenes ?? [])])],
      prompt: caseItem.prompt,
      promptPreview: caseItem.promptPreview
    }))
  };
}

export async function loadCaseLibrary(): Promise<CaseLibraryData> {
  const response = await fetch("/cases-index.json");
  if (!response.ok) {
    throw new Error("CASE_LIBRARY_LOAD_FAILED");
  }

  return normalizeCaseLibrary((await response.json()) as RawCaseLibraryData);
}

export async function loadCasePrompts(): Promise<CasePromptMap> {
  promptMapRequest ??= fetch("/case-prompts.json")
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("CASE_PROMPT_LOAD_FAILED");
      }

      const payload = (await response.json()) as { prompts?: Record<string, string> };
      return Object.fromEntries(
        Object.entries(payload.prompts ?? {}).map(([key, value]) => [Number(key), value])
      );
    })
    .catch((error) => {
      promptMapRequest = null;
      throw error;
    });

  return promptMapRequest;
}
