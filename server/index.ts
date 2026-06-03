import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ProviderProtocol = "gemini_generate_content" | "openai_chat_completions" | "openai_images";
type AspectRatio =
  | "Adaptive"
  | "1:1"
  | "16:9"
  | "21:9"
  | "4:3"
  | "3:2"
  | "5:4"
  | "2:1"
  | "3:4"
  | "2:3"
  | "4:5"
  | "9:16";
type ImageSize = "1K" | "2K" | "4K";

interface InputImagePayload {
  name: string;
  mimeType: string;
  data: string;
}

interface GenerateRequest {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  protocol: ProviderProtocol;
  prompt: string;
  seed: number;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  timeoutMinutes?: number;
  inputImages: InputImagePayload[];
}

interface GeneratedImage {
  data: string;
  mimeType: string;
}

interface ProviderModelOption {
  id: string;
  protocol: ProviderProtocol;
}

const app = express();
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

app.use(cors({ origin: true }));
app.use(express.json({ limit: "80mb" }));

function normalizeBaseUrl(apiBaseUrl: string) {
  const url = new URL(apiBaseUrl.trim());
  let pathname = url.pathname.replace(/\/+$/, "");
  ["/v1/chat/completions", "/v1/images/edits", "/v1/images/generations", "/v1/models", "/v1beta/models"].forEach(
    (suffix) => {
      if (pathname.endsWith(suffix)) {
        pathname = pathname.slice(0, -suffix.length);
      }
    }
  );
  if (pathname === "/v1") {
    pathname = "";
  }
  url.pathname = pathname || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function buildGeminiUrl(apiBaseUrl: string, modelName: string) {
  return `${normalizeBaseUrl(apiBaseUrl)}/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
}

function buildGeminiModelsUrl(apiBaseUrl: string) {
  return `${normalizeBaseUrl(apiBaseUrl)}/v1beta/models`;
}

function buildOpenAiModelsUrl(apiBaseUrl: string) {
  return `${normalizeBaseUrl(apiBaseUrl)}/v1/models`;
}

function buildChatCompletionsUrl(apiBaseUrl: string) {
  return `${normalizeBaseUrl(apiBaseUrl)}/v1/chat/completions`;
}

function buildImagesEditsUrl(apiBaseUrl: string) {
  return `${normalizeBaseUrl(apiBaseUrl)}/v1/images/edits`;
}

function buildImagesGenerationsUrl(apiBaseUrl: string) {
  return `${normalizeBaseUrl(apiBaseUrl)}/v1/images/generations`;
}

function imageConfig(input: Pick<GenerateRequest, "aspectRatio" | "imageSize">) {
  const config: { imageSize: ImageSize; aspectRatio?: Exclude<AspectRatio, "Adaptive"> } = {
    imageSize: input.imageSize
  };
  if (input.aspectRatio !== "Adaptive") {
    config.aspectRatio = input.aspectRatio;
  }
  return config;
}

function providerImageConfig(input: Pick<GenerateRequest, "aspectRatio" | "imageSize">) {
  return {
    aspectRatio: input.aspectRatio === "Adaptive" ? "auto" : input.aspectRatio,
    imageSize: input.imageSize.toLowerCase()
  };
}

const OPENAI_IMAGE_4K_SIZE_BY_RATIO: Record<Exclude<AspectRatio, "Adaptive">, string> = {
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

function toOpenAiImageSize(aspectRatio: AspectRatio, imageSize: ImageSize) {
  if (imageSize === "4K") {
    return aspectRatio === "Adaptive" ? "3840x2160" : OPENAI_IMAGE_4K_SIZE_BY_RATIO[aspectRatio];
  }

  switch (aspectRatio) {
    case "Adaptive":
    case "1:1":
      return "1024x1024";
    case "16:9":
    case "4:3":
    case "3:2":
      return "1536x1024";
    case "9:16":
    case "3:4":
    case "2:3":
    case "4:5":
      return "1024x1536";
    default:
      return "auto";
  }
}

function parseEventStreamJson(text: string): unknown[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""))
        .join("\n")
        .trim()
    )
    .filter((data) => data && data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

function parseJsonOrEventStream(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const stream = parseEventStreamJson(trimmed);
    if (stream.length > 0) {
      return stream.length === 1 ? stream[0] : { stream };
    }
    throw error;
  }
}

async function readResponseBody(response: Response) {
  return parseJsonOrEventStream(await response.text());
}

function extractGeminiImages(raw: any): GeneratedImage[] {
  const candidates = Array.isArray(raw?.candidates) ? raw.candidates : [];
  const results: GeneratedImage[] = [];

  candidates.forEach((candidate: any) => {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    parts.forEach((part: any) => {
      const inlineData = part?.inlineData ?? part?.inline_data;
      if (inlineData?.data) {
        results.push({
          data: inlineData.data,
          mimeType: inlineData.mimeType ?? inlineData.mime_type ?? "image/png"
        });
      }
    });
  });

  return results;
}

function parseDataUrl(value: unknown): GeneratedImage | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

function collectOpenAiImages(value: any, results: GeneratedImage[]) {
  const dataUrl = parseDataUrl(value);
  if (dataUrl) {
    results.push(dataUrl);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectOpenAiImages(item, results));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const directB64 = value.b64_json ?? value.b64Json;
  if (typeof directB64 === "string" && directB64.trim()) {
    results.push({
      data: directB64.trim(),
      mimeType: value.mime_type ?? value.mimeType ?? "image/png"
    });
  }

  collectOpenAiImages(value.image_url?.url, results);
  collectOpenAiImages(value.url, results);
  collectOpenAiImages(value.content, results);
  collectOpenAiImages(value.delta, results);
  collectOpenAiImages(value.message, results);
  collectOpenAiImages(value.image, results);
  collectOpenAiImages(value.images, results);
}

function extractOpenAiImages(raw: any): GeneratedImage[] {
  const results: GeneratedImage[] = [];
  collectOpenAiImages(raw?.stream, results);
  collectOpenAiImages(raw?.choices, results);
  collectOpenAiImages(raw?.data, results);
  collectOpenAiImages(raw?.images, results);
  collectOpenAiImages(raw?.image, results);
  return results;
}

function requestHeaders(apiKey: string, baseUrl: string, contentType = "application/json") {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const trimmedKey = apiKey.trim();
  if (trimmedKey && baseUrl.includes("generativelanguage.googleapis.com")) {
    headers["x-goog-api-key"] = trimmedKey;
  } else if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

function normalizeModelId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isOpenAiImageModelId(modelId: string) {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (normalizedModelId.includes("dall-e")) {
    return true;
  }

  if (normalizedModelId.includes("gpt-image")) {
    return true;
  }

  if (normalizedModelId.includes("gemini") && normalizedModelId.includes("image")) {
    return true;
  }

  if (normalizedModelId.includes("imagen")) {
    return true;
  }

  return /\bgpt[-\d.]*-image(?:-\d+)?\b/u.test(normalizedModelId);
}

function inferOpenAiModelProtocol(modelId: string): ProviderProtocol {
  return isOpenAiImageModelId(modelId) ? "openai_images" : "openai_chat_completions";
}

function isImage2ModelId(modelId: string) {
  const normalizedModelId = modelId.trim().toLowerCase();
  return normalizedModelId === "gpt-image-2" || normalizedModelId === "gptimage2" || normalizedModelId === "image2";
}

function modelPriority(model: ProviderModelOption) {
  const id = model.id.toLowerCase();
  if (isImage2ModelId(id)) {
    return -1;
  }
  if (id.includes("gemini") && id.includes("pro") && id.includes("image")) {
    return 0;
  }
  if (id.includes("gemini") && id.includes("image")) {
    return 1;
  }
  if (id.includes("image") || id.includes("dall-e")) {
    return 2;
  }
  return 10;
}

function sortModels(models: ProviderModelOption[]) {
  return models
    .map((model, index) => ({ model, index }))
    .sort((left, right) => {
      const priorityDiff = modelPriority(left.model) - modelPriority(right.model);
      return priorityDiff === 0 ? left.index - right.index : priorityDiff;
    })
    .map((item) => item.model);
}

function preferImageModels(models: ProviderModelOption[]) {
  const imageModels = models.filter((model) => /image|dall-e/iu.test(model.id));
  return imageModels.length > 0 ? imageModels : models;
}

function dedupeModels(models: ProviderModelOption[]) {
  const seen = new Set<string>();
  const result: ProviderModelOption[] = [];

  models.forEach((model) => {
    const id = normalizeModelId(model.id);
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    result.push({ id, protocol: model.protocol });
  });

  return sortModels(preferImageModels(result));
}

function readGeminiModels(raw: any): ProviderModelOption[] {
  const models = Array.isArray(raw?.models) ? raw.models : [];

  return models
    .map((item: any) => {
      const rawName = normalizeModelId(item?.name ?? item?.id);
      const id = rawName?.replace(/^models\//, "") ?? null;
      if (!id) {
        return null;
      }

      return {
        id,
        protocol: "gemini_generate_content"
      };
    })
    .filter((item: ProviderModelOption | null): item is ProviderModelOption => Boolean(item));
}

function readOpenAiModels(raw: any): ProviderModelOption[] {
  const models = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.models) ? raw.models : [];

  return models
    .map((item: any) => {
      const id = normalizeModelId(typeof item === "string" ? item : item?.id ?? item?.name);
      if (!id) {
        return null;
      }

      return {
        id,
        protocol: inferOpenAiModelProtocol(id)
      };
    })
    .filter((item: ProviderModelOption | null): item is ProviderModelOption => Boolean(item));
}

async function fetchProviderModelOptions(input: {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}) {
  const errors: string[] = [];
  const models: ProviderModelOption[] = [];

  async function attemptModelList(attempt: {
    url: string;
    readModels: (raw: any) => ProviderModelOption[];
  }) {
    try {
      const response = await fetch(attempt.url, {
        method: "GET",
        headers: requestHeaders(input.apiKey, input.baseUrl, ""),
        signal: AbortSignal.timeout(input.timeoutMs)
      });
      const raw = await readResponseBody(response);
      if (!response.ok) {
        errors.push(raw?.error?.message ?? `${attempt.url} returned ${response.status}`);
        return;
      }
      models.push(...attempt.readModels(raw));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to fetch models.");
    }
  }

  await attemptModelList({
    url: buildGeminiModelsUrl(input.baseUrl),
    readModels: readGeminiModels
  });

  await attemptModelList({
    url: buildOpenAiModelsUrl(input.baseUrl),
    readModels: readOpenAiModels
  });

  const uniqueModels = dedupeModels(models);
  if (uniqueModels.length > 0) {
    return uniqueModels;
  }

  if (errors.length > 0) {
    throw new Error(errors[0] ?? "没有从 Base URL 获取到可用模型。");
  }

  throw new Error("没有从 Base URL 获取到可用模型。");
}

function assertGenerateRequest(input: Partial<GenerateRequest>): asserts input is GenerateRequest {
  if (!input.prompt?.trim()) {
    throw new Error("请先输入提示词。");
  }
  if (!input.baseUrl?.trim()) {
    throw new Error("请先填写 Base URL。");
  }
  if (!input.modelName?.trim()) {
    throw new Error("请先填写模型名称。");
  }
  if (!input.protocol) {
    throw new Error("请先选择调用协议。");
  }
}

app.post("/api/models", async (request, response) => {
  try {
    const baseUrl = typeof request.body?.baseUrl === "string" ? request.body.baseUrl.trim() : "";
    if (!baseUrl) {
      throw new Error("请先填写 Base URL。");
    }

    const timeoutSeconds =
      typeof request.body?.timeoutSeconds === "number" && Number.isFinite(request.body.timeoutSeconds)
        ? request.body.timeoutSeconds
        : 12;
    const timeoutMs = Math.min(30, Math.max(3, timeoutSeconds)) * 1000;
    const apiKey = typeof request.body?.apiKey === "string" ? request.body.apiKey : "";
    const models = await fetchProviderModelOptions({ baseUrl, apiKey, timeoutMs });
    response.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取模型列表失败。";
    response.status(400).json({ error: message });
  }
});

async function generateWithGemini(input: GenerateRequest, timeoutMs: number) {
  const response = await fetch(buildGeminiUrl(input.baseUrl, input.modelName), {
    method: "POST",
    headers: requestHeaders(input.apiKey, input.baseUrl),
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            ...input.inputImages.map((image) => ({
              inlineData: {
                mimeType: image.mimeType,
                data: image.data
              }
            })),
            { text: input.prompt }
          ]
        }
      ],
      seed: input.seed,
      generationConfig: {
        responseModalities: ["text", "image"],
        imageConfig: imageConfig(input)
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? `Provider request failed with status ${response.status}`);
  }
  return extractGeminiImages(raw);
}

async function generateWithOpenAiChat(input: GenerateRequest, timeoutMs: number) {
  const response = await fetch(buildChatCompletionsUrl(input.baseUrl), {
    method: "POST",
    headers: requestHeaders(input.apiKey, input.baseUrl),
    body: JSON.stringify({
      model: input.modelName,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            ...input.inputImages.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mimeType};base64,${image.data}`
              }
            }))
          ]
        }
      ],
      response_modalities: ["text", "image"],
      image_config: providerImageConfig(input)
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? `Provider request failed with status ${response.status}`);
  }
  return extractOpenAiImages(raw);
}

async function generateWithOpenAiImages(input: GenerateRequest, timeoutMs: number) {
  const hasInputImages = input.inputImages.length > 0;
  const body = hasInputImages
    ? new FormData()
    : JSON.stringify({
        model: input.modelName,
        prompt: input.prompt,
        n: 1,
        response_format: "b64_json",
        size: toOpenAiImageSize(input.aspectRatio, input.imageSize)
      });

  if (hasInputImages && body instanceof FormData) {
    body.append("model", input.modelName);
    body.append("prompt", input.prompt);
    body.append("size", toOpenAiImageSize(input.aspectRatio, input.imageSize));
    body.append("output_format", "png");
    input.inputImages.forEach((image, index) => {
      const bytes = Buffer.from(image.data, "base64");
      const blob = new Blob([new Uint8Array(bytes)], { type: image.mimeType });
      body.append("image", blob, image.name || `input-${index + 1}.png`);
    });
  }

  const response = await fetch(hasInputImages ? buildImagesEditsUrl(input.baseUrl) : buildImagesGenerationsUrl(input.baseUrl), {
    method: "POST",
    headers: requestHeaders(input.apiKey, input.baseUrl, hasInputImages ? "" : "application/json"),
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? `Provider request failed with status ${response.status}`);
  }
  return extractOpenAiImages(raw);
}

app.post("/api/generate", async (request, response) => {
  try {
    assertGenerateRequest(request.body);
    const input = request.body;
    const timeoutMs = Math.max(1, input.timeoutMinutes ?? 10) * 60 * 1000;
    const generators: Record<ProviderProtocol, () => Promise<GeneratedImage[]>> = {
      gemini_generate_content: () => generateWithGemini(input, timeoutMs),
      openai_chat_completions: () => generateWithOpenAiChat(input, timeoutMs),
      openai_images: () => generateWithOpenAiImages(input, timeoutMs)
    };
    const images = await generators[input.protocol]();
    const image = images[0];

    if (!image) {
      throw new Error("Provider response did not contain any image data.");
    }

    response.json({
      id: `history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      seed: input.seed,
      createdAt: new Date().toISOString(),
      image: {
        ...image,
        dataUrl: `data:${image.mimeType};base64,${image.data}`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    response.status(400).json({ error: message });
  }
});

app.use(express.static(distDir));
app.get("*", (_request, response) => {
  response.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Custom image generator API is running at http://127.0.0.1:${port}`);
});
