export type ThemeMode = "light" | "dark";

export type ProviderProtocol = "gemini_generate_content" | "openai_chat_completions" | "openai_images";

export type AspectRatio =
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

export type ImageSize = "1K" | "2K" | "4K";
export type PromptMode = "count" | "queue";

export interface InputImage {
  id: string;
  name: string;
  mimeType: string;
  data: string;
  dataUrl: string;
  size: number;
  width?: number;
  height?: number;
}

export interface WorkspaceState {
  theme: ThemeMode;
  prompt: string;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  protocol: ProviderProtocol;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  concurrency: number;
  promptMode: PromptMode;
  seed: number;
  seedLocked: boolean;
}

export interface ProviderModelOption {
  id: string;
  protocol: ProviderProtocol;
}

export interface ProviderModelsResponse {
  models: ProviderModelOption[];
}

export interface HistoryItem {
  id: string;
  imageDataUrl: string;
  mimeType: string;
  prompt: string;
  modelName: string;
  protocol: ProviderProtocol;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  seed?: number;
  inputImageNames: string[];
  createdAt: string;
}

export interface GenerateResponse {
  id: string;
  seed: number;
  createdAt: string;
  image: {
    data: string;
    mimeType: string;
    dataUrl: string;
  };
}
