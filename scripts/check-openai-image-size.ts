import { readFileSync } from "node:fs";
import { toOpenAiImageSize } from "../src/api";
import type { AspectRatio } from "../src/types";

function assertEqual(actual: string, expected: string, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}.`);
  }
}

const expected4kSizes: Record<Exclude<AspectRatio, "Adaptive">, string> = {
  "1:1": "2880x2880",
  "16:9": "3840x2160",
  "21:9": "3840x1648",
  "4:3": "3264x2448",
  "3:2": "3504x2336",
  "5:4": "3200x2560",
  "2:1": "3840x1920",
  "3:4": "2448x3264",
  "2:3": "2336x3504",
  "4:5": "2560x3200",
  "9:16": "2160x3840"
};

Object.entries(expected4kSizes).forEach(([ratio, expected]) => {
  assertEqual(toOpenAiImageSize(ratio as AspectRatio, "4K"), expected, `4K size for ${ratio}`);
});

assertEqual(toOpenAiImageSize("Adaptive", "4K"), "3840x2160", "Adaptive 4K fallback");
assertEqual(toOpenAiImageSize("Adaptive", "1K"), "1024x1024", "Adaptive 1K should avoid provider auto size");
assertEqual(toOpenAiImageSize("Adaptive", "2K"), "1024x1024", "Adaptive 2K should avoid provider auto size");
assertEqual(toOpenAiImageSize("1:1", "2K"), "1024x1024", "Non-4K square size");
assertEqual(toOpenAiImageSize("16:9", "2K"), "1536x1024", "Non-4K landscape size");
assertEqual(toOpenAiImageSize("9:16", "2K"), "1024x1536", "Non-4K portrait size");

const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
if (!api.includes('body.append("output_format", "png")')) {
  throw new Error("OpenAI image edit FormData must request output_format=png.");
}

if (!server.includes('body.append("output_format", "png")')) {
  throw new Error("Local server OpenAI image edit FormData must request output_format=png.");
}

if (api.includes('body.append("response_format", "b64_json")') || api.includes('body.append("n", "1")')) {
  throw new Error("OpenAI image edit FormData must not keep legacy response_format or n fields.");
}

if (server.includes('body.append("response_format", "b64_json")') || server.includes('body.append("n", "1")')) {
  throw new Error("Local server image edit FormData must not keep legacy response_format or n fields.");
}

if (!api.includes('body.append("image", base64ToBlob')) {
  throw new Error("OpenAI image edit FormData must use the standard repeated image field.");
}

if (!server.includes('body.append("image", blob')) {
  throw new Error("Local server image edit FormData must use the standard repeated image field.");
}

if (api.includes('body.append("image[]"') || server.includes('body.append("image[]"')) {
  throw new Error("OpenAI image edit FormData must not use the non-standard image[] field.");
}

if (!api.includes("toOpenAiImageSize(workspace.aspectRatio, workspace.imageSize)")) {
  throw new Error("OpenAI Images requests must pass imageSize into toOpenAiImageSize.");
}

if (!server.includes("toOpenAiImageSize(input.aspectRatio, input.imageSize)")) {
  throw new Error("Local server OpenAI Images requests must pass imageSize into toOpenAiImageSize.");
}

if (api.includes('headers: requestHeaders(workspace.apiKey, workspace.baseUrl, "multipart/form-data")')) {
  throw new Error("FormData requests must not set multipart/form-data manually.");
}

console.log("OpenAI image size checks passed.");
