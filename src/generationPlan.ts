import type { AspectRatio, InputImage, WorkspaceState } from "./types";

type FixedAspectRatio = Exclude<AspectRatio, "Adaptive">;

const ASPECT_RATIO_VALUES: Array<{ value: FixedAspectRatio; ratio: number }> = [
  { value: "1:1", ratio: 1 },
  { value: "16:9", ratio: 16 / 9 },
  { value: "21:9", ratio: 21 / 9 },
  { value: "4:3", ratio: 4 / 3 },
  { value: "3:2", ratio: 3 / 2 },
  { value: "5:4", ratio: 5 / 4 },
  { value: "2:1", ratio: 2 },
  { value: "3:4", ratio: 3 / 4 },
  { value: "2:3", ratio: 2 / 3 },
  { value: "4:5", ratio: 4 / 5 },
  { value: "9:16", ratio: 9 / 16 }
];

const MAX_GENERATION_COUNT = 10;
const MAX_SEED = 2_147_483_647;

export interface GenerationPlanTask {
  id: string;
  index: number;
  prompt: string;
  seed: number;
  aspectRatio: AspectRatio;
}

export function parsePromptQueue(prompt: string) {
  return prompt
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function inferAspectRatioFromDimensions(width?: number, height?: number): FixedAspectRatio | null {
  if (!width || !height || width <= 0 || height <= 0) {
    return null;
  }

  const ratio = width / height;
  return ASPECT_RATIO_VALUES.reduce((best, candidate) => {
    const distance = Math.abs(ratio - candidate.ratio);
    return distance < best.distance ? { value: candidate.value, distance } : best;
  }, { value: "1:1" as FixedAspectRatio, distance: Number.POSITIVE_INFINITY }).value;
}

export function resolveEffectiveAspectRatio(aspectRatio: AspectRatio, inputImages: InputImage[]): AspectRatio {
  if (aspectRatio !== "Adaptive") {
    return aspectRatio;
  }

  const firstMeasuredImage = inputImages.find((image) => image.width && image.height);
  return inferAspectRatioFromDimensions(firstMeasuredImage?.width, firstMeasuredImage?.height) ?? "Adaptive";
}

function normalizeCount(value: number) {
  return Math.min(MAX_GENERATION_COUNT, Math.max(1, Number.isFinite(value) ? Math.trunc(value) : 1));
}

function normalizeSeed(value: number) {
  const seed = Number.isFinite(value) ? Math.trunc(Math.abs(value)) : 0;
  return seed % MAX_SEED;
}

export function createGenerationPlan(input: {
  workspace: WorkspaceState;
  inputImages: InputImage[];
  createId: (index: number) => string;
  createRandomSeed: () => number;
}): GenerationPlanTask[] {
  const prompts =
    input.workspace.promptMode === "queue"
      ? parsePromptQueue(input.workspace.prompt)
      : Array.from({ length: normalizeCount(input.workspace.concurrency) }, () => input.workspace.prompt.trim());
  const baseSeed = normalizeSeed(input.workspace.seedLocked ? input.workspace.seed : input.createRandomSeed());
  const aspectRatio = resolveEffectiveAspectRatio(input.workspace.aspectRatio, input.inputImages);

  return prompts.map((prompt, index) => ({
    id: input.createId(index),
    index,
    prompt,
    seed: normalizeSeed(baseSeed + index),
    aspectRatio
  }));
}
