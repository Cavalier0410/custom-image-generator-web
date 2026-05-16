import type {
  AspectRatio,
  GenerateResponse,
  ImageSize,
  InputImage,
  ProviderModelOption,
  ProviderModelsResponse,
  ProviderProtocol,
  WorkspaceState
} from "./types";

interface GeneratedImage {
  data: string;
  mimeType: string;
}

const PROXIED_PROVIDER_ORIGIN = "https://api.lts4ai.com";

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

function providerUrl(apiBaseUrl: string, path: string) {
  const target = new URL(`${normalizeBaseUrl(apiBaseUrl)}${path}`);
  if (target.origin === PROXIED_PROVIDER_ORIGIN) {
    return `${target.pathname}${target.search}`;
  }
  return target.toString();
}

function buildGeminiUrl(apiBaseUrl: string, modelName: string) {
  return providerUrl(apiBaseUrl, `/v1beta/models/${encodeURIComponent(modelName)}:generateContent`);
}

function buildGeminiModelsUrl(apiBaseUrl: string) {
  return providerUrl(apiBaseUrl, "/v1beta/models");
}

function buildOpenAiModelsUrl(apiBaseUrl: string) {
  return providerUrl(apiBaseUrl, "/v1/models");
}

function buildChatCompletionsUrl(apiBaseUrl: string) {
  return providerUrl(apiBaseUrl, "/v1/chat/completions");
}

function buildImagesEditsUrl(apiBaseUrl: string) {
  return providerUrl(apiBaseUrl, "/v1/images/edits");
}

function buildImagesGenerationsUrl(apiBaseUrl: string) {
  return providerUrl(apiBaseUrl, "/v1/images/generations");
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

function imageConfig(input: Pick<WorkspaceState, "aspectRatio" | "imageSize">) {
  const config: { imageSize: ImageSize; aspectRatio?: Exclude<AspectRatio, "Adaptive"> } = {
    imageSize: input.imageSize
  };
  if (input.aspectRatio !== "Adaptive") {
    config.aspectRatio = input.aspectRatio;
  }
  return config;
}

function providerImageConfig(input: Pick<WorkspaceState, "aspectRatio" | "imageSize">) {
  return {
    aspectRatio: input.aspectRatio === "Adaptive" ? "auto" : input.aspectRatio,
    imageSize: input.imageSize.toLowerCase()
  };
}

function toOpenAiImageSize(aspectRatio: AspectRatio) {
  switch (aspectRatio) {
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

  return /\bgpt[-\d.]*-image(?:-\d+)?\b/u.test(normalizedModelId);
}

function inferModelProtocol(modelId: string, fallback: ProviderProtocol): ProviderProtocol {
  return isOpenAiImageModelId(modelId) ? "openai_images" : fallback;
}

function modelPriority(model: ProviderModelOption) {
  const id = model.id.toLowerCase();
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
    result.push({ id, protocol: inferModelProtocol(id, model.protocol) });
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
        protocol: inferModelProtocol(id, "gemini_generate_content")
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
        protocol: inferModelProtocol(id, "openai_chat_completions")
      };
    })
    .filter((item: ProviderModelOption | null): item is ProviderModelOption => Boolean(item));
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

function base64ToBlob(data: string, mimeType: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function fetchProviderModels(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<ProviderModelsResponse> {
  const errors: string[] = [];
  const models: ProviderModelOption[] = [];
  const timeoutMs = 12_000;

  async function attemptModelList(attempt: {
    url: string;
    readModels: (raw: any) => ProviderModelOption[];
  }) {
    try {
      const response = await fetch(attempt.url, {
        method: "GET",
        headers: requestHeaders(input.apiKey, input.baseUrl, ""),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const raw = await readResponseBody(response);
      if (!response.ok) {
        errors.push(raw?.error?.message ?? raw?.message ?? `${attempt.url} returned ${response.status}`);
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
    return { models: uniqueModels };
  }

  throw new Error(errors[0] ?? "没有从 Base URL 获取到可用模型。");
}

async function generateWithGemini(input: {
  workspace: WorkspaceState;
  inputImages: InputImage[];
  seed: number;
}) {
  const { workspace } = input;
  const response = await fetch(buildGeminiUrl(workspace.baseUrl, workspace.modelName), {
    method: "POST",
    headers: requestHeaders(workspace.apiKey, workspace.baseUrl),
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
            { text: workspace.prompt }
          ]
        }
      ],
      seed: input.seed,
      generationConfig: {
        responseModalities: ["text", "image"],
        imageConfig: imageConfig(workspace)
      }
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? raw?.message ?? `Provider request failed with status ${response.status}`);
  }
  return extractGeminiImages(raw);
}

async function generateWithOpenAiChat(input: {
  workspace: WorkspaceState;
  inputImages: InputImage[];
}) {
  const { workspace } = input;
  const response = await fetch(buildChatCompletionsUrl(workspace.baseUrl), {
    method: "POST",
    headers: requestHeaders(workspace.apiKey, workspace.baseUrl),
    body: JSON.stringify({
      model: workspace.modelName,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: workspace.prompt },
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
      image_config: providerImageConfig(workspace)
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? raw?.message ?? `Provider request failed with status ${response.status}`);
  }
  return extractOpenAiImages(raw);
}

async function generateWithOpenAiImages(input: {
  workspace: WorkspaceState;
  inputImages: InputImage[];
}) {
  const { workspace } = input;
  const hasInputImages = input.inputImages.length > 0;
  const body = hasInputImages
    ? new FormData()
    : JSON.stringify({
        model: workspace.modelName,
        prompt: workspace.prompt,
        n: 1,
        response_format: "b64_json",
        size: toOpenAiImageSize(workspace.aspectRatio)
      });

  if (hasInputImages && body instanceof FormData) {
    body.append("model", workspace.modelName);
    body.append("prompt", workspace.prompt);
    body.append("n", "1");
    body.append("response_format", "b64_json");
    body.append("size", toOpenAiImageSize(workspace.aspectRatio));
    input.inputImages.forEach((image, index) => {
      body.append("image[]", base64ToBlob(image.data, image.mimeType), image.name || `input-${index + 1}.png`);
    });
  }

  const response = await fetch(hasInputImages ? buildImagesEditsUrl(workspace.baseUrl) : buildImagesGenerationsUrl(workspace.baseUrl), {
    method: "POST",
    headers: requestHeaders(workspace.apiKey, workspace.baseUrl, hasInputImages ? "" : "application/json"),
    body,
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? raw?.message ?? `Provider request failed with status ${response.status}`);
  }
  return extractOpenAiImages(raw);
}

export async function generateImage(input: {
  workspace: WorkspaceState;
  inputImages: InputImage[];
  seed: number;
}): Promise<GenerateResponse> {
  const generators: Record<ProviderProtocol, () => Promise<GeneratedImage[]>> = {
    gemini_generate_content: () => generateWithGemini(input),
    openai_chat_completions: () => generateWithOpenAiChat(input),
    openai_images: () => generateWithOpenAiImages(input)
  };
  const images = await generators[input.workspace.protocol]();
  const image = images[0];

  if (!image) {
    throw new Error("Provider response did not contain any image data.");
  }

  return {
    id: `history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    seed: input.seed,
    createdAt: new Date().toISOString(),
    image: {
      ...image,
      dataUrl: `data:${image.mimeType};base64,${image.data}`
    }
  };
}
