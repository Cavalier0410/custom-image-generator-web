import {
  createGenerationPlan,
  inferAspectRatioFromDimensions,
  parsePromptQueue,
  resolveEffectiveAspectRatio
} from "../src/generationPlan";
import type { InputImage, WorkspaceState } from "../src/types";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}

function assertArrayEqual<T>(actual: T[], expected: T[], message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}.`);
  }
}

const baseWorkspace: WorkspaceState = {
  theme: "light",
  prompt: "line one\n\nline two\n  line three  ",
  apiKey: "",
  baseUrl: "https://api.lts4ai.com",
  modelName: "gpt-image-2",
  protocol: "openai_images",
  aspectRatio: "Adaptive",
  imageSize: "4K",
  concurrency: 3,
  promptMode: "queue",
  seed: 1200,
  seedLocked: true
};

const referenceImage: InputImage = {
  id: "reference",
  name: "reference.png",
  mimeType: "image/png",
  data: "AA==",
  dataUrl: "data:image/png;base64,AA==",
  size: 1,
  width: 800,
  height: 1000
};

assertArrayEqual(parsePromptQueue(baseWorkspace.prompt), ["line one", "line two", "line three"], "Prompt queue parsing");
assertEqual(inferAspectRatioFromDimensions(800, 1000), "4:5", "Portrait ecommerce ratio inference");
assertEqual(inferAspectRatioFromDimensions(1920, 1080), "16:9", "Landscape ratio inference");
assertEqual(inferAspectRatioFromDimensions(900, 1600), "9:16", "Vertical screen ratio inference");
assertEqual(resolveEffectiveAspectRatio("Adaptive", [referenceImage]), "4:5", "Adaptive should follow first reference image");
assertEqual(resolveEffectiveAspectRatio("3:2", [referenceImage]), "3:2", "Manual aspect ratio should be respected");

const queuePlan = createGenerationPlan({
  workspace: baseWorkspace,
  inputImages: [referenceImage],
  createId: (index) => `task-${index}`,
  createRandomSeed: () => 9000
});

assertEqual(queuePlan.length, 3, "Queue mode should create one task per prompt line");
assertArrayEqual(queuePlan.map((task) => task.prompt), ["line one", "line two", "line three"], "Queue task prompts");
assertArrayEqual(queuePlan.map((task) => task.seed), [1200, 1201, 1202], "Locked seed should increment per task");
assertArrayEqual(queuePlan.map((task) => task.aspectRatio), ["4:5", "4:5", "4:5"], "Queue tasks should use inferred ratio");

const countPlan = createGenerationPlan({
  workspace: { ...baseWorkspace, prompt: "single prompt", promptMode: "count", concurrency: 2, seedLocked: false },
  inputImages: [referenceImage],
  createId: (index) => `count-${index}`,
  createRandomSeed: () => 500
});

assertEqual(countPlan.length, 2, "Count mode should create N tasks");
assertArrayEqual(countPlan.map((task) => task.prompt), ["single prompt", "single prompt"], "Count mode repeats the same prompt");
assertArrayEqual(countPlan.map((task) => task.seed), [500, 501], "Unlocked seed should pick one base seed and increment");

console.log("Generation plan checks passed.");
