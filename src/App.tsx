import {
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Lock,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  Unlock,
  UploadCloud,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { fetchProviderModels, generateImage, toUserFacingError } from "./api";
import { CASE_LIBRARY_SOURCE, loadCaseLibrary, loadCasePrompts, type CaseLibraryItem, type CasePromptMap } from "./caseLibrary";
import { createGenerationPlan, parsePromptQueue, resolveEffectiveAspectRatio } from "./generationPlan";
import { loadStoredHistory, saveStoredHistory } from "./historyStore";
import type { AspectRatio, HistoryItem, ImageSize, InputImage, ProviderModelOption, WorkspaceState } from "./types";
import { downloadHistoryAsZip } from "./zipArchive";

const WORKSPACE_KEY = "custom-image-workspace-v2";
const ANNOUNCEMENT_VERSION = "2026-05-20";
const ANNOUNCEMENT_STORAGE_KEY = "image-studio-announcement-version";
const INPUT_IMAGE_LIMIT = 12;
const HISTORY_LIMIT = 40;
const DEFAULT_BASE_URL = "https://api.lts4ai.com";
const LEGACY_DEFAULT_BASE_URLS = new Set(["http://64.186.244.43:12001"]);
const LEGACY_DEFAULT_PROMPTS = new Set([
  "把参考图中的服装穿到模特身上，保持版型、材质和细节一致。"
]);

const ASPECT_RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "Adaptive", label: "自动" },
  { value: "1:1", label: "正方形 1:1" },
  { value: "16:9", label: "横屏 16:9" },
  { value: "21:9", label: "超宽屏 21:9" },
  { value: "4:3", label: "横向标准 4:3" },
  { value: "3:2", label: "横向照片 3:2" },
  { value: "5:4", label: "横向近方 5:4" },
  { value: "2:1", label: "横向宽幅 2:1" },
  { value: "3:4", label: "竖向标准 3:4" },
  { value: "2:3", label: "竖向照片 2:3" },
  { value: "4:5", label: "竖向电商 4:5" },
  { value: "9:16", label: "竖屏 9:16" }
];

const IMAGE_SIZES: ImageSize[] = ["4K", "2K", "1K"];
const ALL_CASE_CATEGORY = "全部";

const CASE_CATEGORY_LABELS: Record<string, string> = {
  "Architecture & Spaces": "建筑空间",
  "Brand & Logos": "品牌标志",
  "Characters & People": "角色人物",
  "Charts & Infographics": "信息图表",
  "Documents & Publishing": "文档出版",
  "History & Classical Themes": "历史古风",
  "Illustration & Art": "插画艺术",
  "Other Use Cases": "其他案例",
  "Photography & Realism": "摄影写实",
  "Posters & Typography": "海报字体",
  "Products & E-commerce": "产品电商",
  "Scenes & Storytelling": "场景叙事",
  "UI & Interfaces": "界面设计"
};

type GenerationTaskStatus = "queued" | "running" | "success" | "failed";
type ActiveView = "studio" | "cases";

interface GenerationTask {
  id: string;
  index: number;
  status: GenerationTaskStatus;
  message: string;
  prompt?: string;
  seed?: number;
  aspectRatio?: AspectRatio;
  imageDataUrl?: string;
  mimeType?: string;
  createdAt?: string;
  historyId?: string;
}

const DEFAULT_WORKSPACE: WorkspaceState = {
  theme: "light",
  prompt: "",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  modelName: "",
  protocol: "gemini_generate_content",
  aspectRatio: "Adaptive",
  imageSize: "2K",
  concurrency: 1,
  promptMode: "count",
  seed: 0,
  seedLocked: false
};

function readStoredWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const workspace = { ...DEFAULT_WORKSPACE, ...parsed };
    return {
      theme: workspace.theme === "dark" ? "dark" : "light",
      prompt: LEGACY_DEFAULT_PROMPTS.has(workspace.prompt) ? "" : workspace.prompt,
      apiKey: typeof workspace.apiKey === "string" ? workspace.apiKey : "",
      baseUrl: LEGACY_DEFAULT_BASE_URLS.has(workspace.baseUrl) ? DEFAULT_BASE_URL : workspace.baseUrl,
      modelName: typeof workspace.modelName === "string" ? workspace.modelName : "",
      protocol: workspace.protocol,
      aspectRatio: workspace.aspectRatio,
      imageSize: workspace.imageSize,
      concurrency: Math.min(10, Math.max(1, Number.parseInt(String(workspace.concurrency), 10) || 1)),
      promptMode: workspace.promptMode === "queue" ? "queue" : "count",
      seed: Math.max(0, Number.parseInt(String(workspace.seed), 10) || 0),
      seedLocked: Boolean(workspace.seedLocked)
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

function hasSeenAnnouncementVersion() {
  try {
    return localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY) === ANNOUNCEMENT_VERSION;
  } catch {
    return false;
  }
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("无法读取图片数据。");
  }
  return { mimeType: match[1], data: match[2] };
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Image dimensions unavailable."));
    image.src = dataUrl;
  });
}

const INPUT_IMAGE_COMPRESSION_THRESHOLD_BYTES = 3 * 1024 * 1024;
const INPUT_IMAGE_MAX_DIMENSION = 2560;
const INPUT_IMAGE_JPEG_QUALITY = 0.86;

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Image compression failed."));
      },
      mimeType,
      quality
    );
  });
}

async function compressInputImage(file: File): Promise<File> {
  if (file.size <= INPUT_IMAGE_COMPRESSION_THRESHOLD_BYTES) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Failed to read image: ${file.name}`));
      image.src = objectUrl;
    });

    const scale = Math.min(1, INPUT_IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", INPUT_IMAGE_JPEG_QUALITY);
    if (blob.size >= file.size) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "input";
    return new File([blob], `${baseName}-compressed.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now()
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function fileToInputImage(file: File): Promise<InputImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      const parsed = parseDataUrl(dataUrl);
      const dimensions = await readImageDimensions(dataUrl).catch(() => null);
      resolve({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        mimeType: parsed.mimeType,
        data: parsed.data,
        dataUrl,
        size: file.size,
        width: dimensions?.width,
        height: dimensions?.height
      });
    };
    reader.readAsDataURL(file);
  });
}

async function fileToCompressedInputImage(file: File): Promise<InputImage> {
  return fileToInputImage(await compressInputImage(file));
}

function readableSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function randomSeed() {
  return Math.floor(Math.random() * 2_147_483_647);
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("webp")) {
    return "webp";
  }
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  return "png";
}

function downloadDataUrl(input: { dataUrl: string; mimeType: string; createdAt?: string }) {
  const anchor = document.createElement("a");
  const timestamp = (input.createdAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  anchor.href = input.dataUrl;
  anchor.download = `custom-image-${timestamp}.${extensionFromMimeType(input.mimeType)}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function compactError(error: unknown) {
  return toUserFacingError(error);
}

function compactPrompt(prompt: string, maxLength = 150) {
  const compacted = prompt.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, maxLength).trim()}...`;
}

function localizeCaseCategory(category: string) {
  return CASE_CATEGORY_LABELS[category] ?? category;
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function pickDefaultModel(models: ProviderModelOption[], currentModelName: string) {
  const currentModel = models.find((model) => model.id === currentModelName);
  if (currentModel) {
    return currentModel;
  }

  return models[0] ?? null;
}

interface CaseLibraryDetailPanelProps {
  caseItem: CaseLibraryItem;
  prompt: string;
  copiedCaseId: number | null;
  canUsePrompt: boolean;
  isCasePromptLoading: boolean;
  headerAction?: ReactNode;
  onCopy: (caseItem: CaseLibraryItem) => Promise<void>;
  onApply: (caseItem: CaseLibraryItem) => void;
}

function CaseLibraryDetailPanel({
  caseItem,
  prompt,
  copiedCaseId,
  canUsePrompt,
  isCasePromptLoading,
  headerAction,
  onCopy,
  onApply
}: CaseLibraryDetailPanelProps) {
  return (
    <>
      <div className="case-detail-media">
        <img alt={caseItem.imageAlt} decoding="async" fetchPriority="high" src={caseItem.image} />
      </div>
      <div className="case-detail-content">
        <div className="case-detail-head">
          <div className="case-detail-meta">
            <span>案例 #{caseItem.id}</span>
            <span>{localizeCaseCategory(caseItem.category)}</span>
          </div>
          {headerAction}
        </div>
        <h2>{caseItem.title}</h2>
        <p>{compactPrompt(caseItem.promptPreview, 180)}</p>
        <div className="case-tags">
          {caseItem.tags.slice(0, 8).map((tag) => (
            <span key={`${caseItem.id}-${tag}`}>{tag}</span>
          ))}
        </div>
        <div className="case-detail-actions">
          <button
            className="text-button"
            disabled={!canUsePrompt || isCasePromptLoading}
            onClick={() => void onCopy(caseItem)}
            type="button"
          >
            <Copy size={17} />
            {copiedCaseId === caseItem.id ? "已复制" : "复制提示词"}
          </button>
          <button
            className="text-button is-primary"
            disabled={!canUsePrompt || isCasePromptLoading}
            onClick={() => onApply(caseItem)}
            type="button"
          >
            <Play size={17} />
            套用到工作台
          </button>
          <a className="text-button" href={caseItem.githubUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={17} />
            源案例
          </a>
        </div>
        <div className="case-prompt-panel">
          <div>
            <strong>提示词</strong>
            {caseItem.sourceUrl ? (
              <a href={caseItem.sourceUrl} rel="noreferrer" target="_blank">
                {caseItem.sourceLabel}
              </a>
            ) : (
              <span>{caseItem.sourceLabel}</span>
            )}
          </div>
          {canUsePrompt ? (
            <pre>{prompt}</pre>
          ) : (
            <div className="case-prompt-loading">
              <Loader2 className={isCasePromptLoading ? "spin" : ""} size={18} />
              <span>{isCasePromptLoading ? "正在加载完整提示词..." : "提示词暂时不可用。"}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>("studio");
  const [isUpdateAnnouncementOpen, setIsUpdateAnnouncementOpen] = useState(() => !hasSeenAnnouncementVersion());
  const [workspace, setWorkspace] = useState<WorkspaceState>(readStoredWorkspace);
  const [modelOptions, setModelOptions] = useState<ProviderModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [inputImages, setInputImages] = useState<InputImage[]>([]);
  const [selectedInputIndex, setSelectedInputIndex] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [isManagingHistory, setIsManagingHistory] = useState(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("工作台就绪。");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isHistorySidebarOpen, setIsHistorySidebarOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<HistoryItem | null>(null);
  const [caseLibraryItems, setCaseLibraryItems] = useState<CaseLibraryItem[]>([]);
  const [caseLibraryCategories, setCaseLibraryCategories] = useState<string[]>([]);
  const [casePromptsById, setCasePromptsById] = useState<CasePromptMap>({});
  const [caseLibraryTotal, setCaseLibraryTotal] = useState(CASE_LIBRARY_SOURCE.totalCases);
  const [isCaseLibraryLoading, setIsCaseLibraryLoading] = useState(true);
  const [isCasePromptLoading, setIsCasePromptLoading] = useState(false);
  const [caseLibraryError, setCaseLibraryError] = useState("");
  const [caseLibraryQuery, setCaseLibraryQuery] = useState("");
  const [selectedCaseCategory, setSelectedCaseCategory] = useState(ALL_CASE_CATEGORY);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [isMobileCaseDetailOpen, setIsMobileCaseDetailOpen] = useState(false);
  const [copiedCaseId, setCopiedCaseId] = useState<number | null>(null);
  const [fileAction, setFileAction] = useState<{ mode: "append" | "replace"; index: number | null }>({
    mode: "append",
    index: null
  });
  const modelLoadRequestRef = useRef(0);
  const casePromptLoadAttemptedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedInputImage = inputImages[selectedInputIndex] ?? null;
  const visibleHistoryItem = useMemo(() => {
    if (history.length === 0) {
      return null;
    }
    return history.find((item) => item.id === selectedHistoryId) ?? history[0];
  }, [history, selectedHistoryId]);

  const selectedModel = useMemo(
    () => modelOptions.find((model) => model.id === workspace.modelName) ?? null,
    [modelOptions, workspace.modelName]
  );
  const filteredCaseLibrary = useMemo(() => {
    const query = caseLibraryQuery.trim().toLowerCase();
    return caseLibraryItems.filter((caseItem) => {
      const matchesCategory = selectedCaseCategory === ALL_CASE_CATEGORY || caseItem.category === selectedCaseCategory;
      const haystack =
        `${caseItem.id} ${caseItem.title} ${caseItem.category} ${caseItem.sourceLabel} ${caseItem.tags.join(" ")} ${caseItem.promptPreview}`.toLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [caseLibraryItems, caseLibraryQuery, selectedCaseCategory]);
  const selectedCaseItem = useMemo(
    () => caseLibraryItems.find((caseItem) => caseItem.id === selectedCaseId) ?? filteredCaseLibrary[0] ?? caseLibraryItems[0] ?? null,
    [caseLibraryItems, filteredCaseLibrary, selectedCaseId]
  );
  const selectedCasePrompt = selectedCaseItem ? (casePromptsById[selectedCaseItem.id] ?? selectedCaseItem.prompt ?? "") : "";
  const canUseSelectedCasePrompt = selectedCasePrompt.trim().length > 0;
  const promptQueue = useMemo(() => parsePromptQueue(workspace.prompt), [workspace.prompt]);
  const plannedTaskCount =
    workspace.promptMode === "queue"
      ? promptQueue.length
      : Math.min(10, Math.max(1, Number.parseInt(String(workspace.concurrency), 10) || 1));
  const effectiveAspectRatio = useMemo(
    () => resolveEffectiveAspectRatio(workspace.aspectRatio, inputImages),
    [inputImages, workspace.aspectRatio]
  );
  const canGenerate =
    !isGenerating &&
    !isLoadingModels &&
    plannedTaskCount > 0 &&
    workspace.baseUrl.trim().length > 0 &&
    workspace.modelName.trim().length > 0 &&
    modelOptions.some((model) => model.id === workspace.modelName);
  const visibleStatusMessage =
    activeView === "cases"
      ? statusMessage.startsWith("已复制案例") || statusMessage.startsWith("已将案例")
        ? statusMessage
        : isCaseLibraryLoading
          ? "案例库加载中..."
          : caseLibraryError || `案例库就绪：${caseLibraryTotal || caseLibraryItems.length} 个案例。`
      : statusMessage;
  const isStatusBusy = activeView === "cases" ? isCaseLibraryLoading : isGenerating || isLoadingModels;

  const updateWorkspace = useCallback((patch: Partial<WorkspaceState>) => {
    setWorkspace((current) => ({ ...current, ...patch }));
  }, []);

  const copyCasePrompt = useCallback(async (caseItem: CaseLibraryItem) => {
    const prompt = casePromptsById[caseItem.id] ?? caseItem.prompt ?? "";
    if (!prompt.trim()) {
      setStatusMessage("提示词仍在加载，请稍后再试。");
      return;
    }

    try {
      await copyTextToClipboard(prompt);
      setCopiedCaseId(caseItem.id);
      setStatusMessage(`已复制案例「${caseItem.title}」的提示词。`);
      window.setTimeout(() => {
        setCopiedCaseId((current) => (current === caseItem.id ? null : current));
      }, 1800);
    } catch {
      setStatusMessage("复制失败，请在详情里手动选中提示词。");
    }
  }, []);

  const applyCasePrompt = useCallback(
    (caseItem: CaseLibraryItem) => {
      const prompt = casePromptsById[caseItem.id] ?? caseItem.prompt ?? "";
      if (!prompt.trim()) {
        setStatusMessage("提示词仍在加载，请稍后再试。");
        return;
      }

      updateWorkspace({
        prompt,
        promptMode: "count"
      });
      setIsMobileCaseDetailOpen(false);
      setActiveView("studio");
      setStatusMessage(`已将案例「${caseItem.title}」套用到工作台。`);
    },
    [casePromptsById, updateWorkspace]
  );

  const openCaseDetail = useCallback((caseId: number) => {
    setSelectedCaseId(caseId);
    if (window.matchMedia("(max-width: 900px)").matches) {
      setIsMobileCaseDetailOpen(true);
    }
  }, []);

  const loadModels = useCallback(
    async (mode: "auto" | "manual" = "manual") => {
      const baseUrl = workspace.baseUrl.trim();
      if (!baseUrl) {
        setModelOptions([]);
        updateWorkspace({ modelName: "" });
        setStatusMessage("请先填写 Base URL。");
        return;
      }

      const requestId = modelLoadRequestRef.current + 1;
      modelLoadRequestRef.current = requestId;
      setIsLoadingModels(true);
      if (mode === "manual") {
        setStatusMessage("正在获取模型列表...");
      }

      try {
        const result = await fetchProviderModels({
          baseUrl,
          apiKey: workspace.apiKey
        });
        if (modelLoadRequestRef.current !== requestId) {
          return;
        }

        setModelOptions(result.models);
        setWorkspace((current) => {
          const nextModel = pickDefaultModel(result.models, current.modelName);
          return {
            ...current,
            modelName: nextModel?.id ?? "",
            protocol: nextModel?.protocol ?? current.protocol
          };
        });
        setStatusMessage(`已获取 ${result.models.length} 个模型。`);
      } catch (error) {
        if (modelLoadRequestRef.current !== requestId) {
          return;
        }
        setModelOptions([]);
        updateWorkspace({ modelName: "" });
        setStatusMessage(compactError(error));
      } finally {
        if (modelLoadRequestRef.current === requestId) {
          setIsLoadingModels(false);
        }
      }
    },
    [updateWorkspace, workspace.apiKey, workspace.baseUrl]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.theme;
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    let isActive = true;

    loadCaseLibrary()
      .then((data) => {
        if (!isActive) {
          return;
        }
        setCaseLibraryItems(data.cases);
        setCaseLibraryCategories(data.categories);
        setCaseLibraryTotal(data.source.totalCases);
        setSelectedCaseId(data.cases[0]?.id ?? null);
        setCaseLibraryError("");
      })
      .catch(() => {
        if (isActive) {
          setCaseLibraryError("案例库加载失败，请稍后重试。");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsCaseLibraryLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (activeView !== "cases" || caseLibraryItems.length === 0 || casePromptLoadAttemptedRef.current) {
      return;
    }

    let isActive = true;
    casePromptLoadAttemptedRef.current = true;
    setIsCasePromptLoading(true);

    loadCasePrompts()
      .then((prompts) => {
        if (isActive) {
          setCasePromptsById(prompts);
        }
      })
      .catch(() => {
        if (isActive) {
          setStatusMessage("案例提示词加载失败，请稍后重试。");
          casePromptLoadAttemptedRef.current = false;
        }
      })
      .finally(() => {
        if (isActive) {
          setIsCasePromptLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [activeView, caseLibraryItems.length]);

  useEffect(() => {
    let isActive = true;

    loadStoredHistory(HISTORY_LIMIT)
      .then((storedHistory) => {
        if (!isActive) {
          return;
        }
        setHistory(storedHistory);
        setSelectedHistoryId(storedHistory[0]?.id ?? null);
      })
      .catch(() => {
        if (isActive) {
          setStatusMessage("历史记录读取失败，本次仍可继续生成。");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsHistoryLoaded(true);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isHistoryLoaded) {
      return;
    }

    let isActive = true;
    saveStoredHistory(history, HISTORY_LIMIT).catch(() => {
      if (isActive) {
        setStatusMessage("历史记录保存失败，本次图片仍可下载。");
      }
    });

    return () => {
      isActive = false;
    };
  }, [history, isHistoryLoaded]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadModels("auto");
    }, 650);
    return () => window.clearTimeout(timer);
  }, [loadModels]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    if (selectedModel.protocol !== workspace.protocol) {
      updateWorkspace({ protocol: selectedModel.protocol });
    }
  }, [selectedModel, updateWorkspace, workspace.protocol]);

  useEffect(() => {
    if (filteredCaseLibrary.length === 0) {
      setSelectedCaseId(null);
      return;
    }

    setSelectedCaseId((current) =>
      current && filteredCaseLibrary.some((caseItem) => caseItem.id === current) ? current : filteredCaseLibrary[0].id
    );
  }, [filteredCaseLibrary]);

  useEffect(() => {
    if (!isMobileCaseDetailOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileCaseDetailOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileCaseDetailOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        setIsMobileCaseDetailOpen(false);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    setSelectedInputIndex((current) => {
      if (inputImages.length === 0) {
        return 0;
      }
      return Math.min(current, inputImages.length - 1);
    });
  }, [inputImages.length]);

  useEffect(() => {
    if (history.length === 0) {
      setSelectedHistoryId(null);
      return;
    }
    setSelectedHistoryId((current) => (current && history.some((item) => item.id === current) ? current : history[0].id));
  }, [history]);

  const openFilePicker = (nextAction: typeof fileAction) => {
    setFileAction(nextAction);
    fileInputRef.current?.click();
  };

  const addFiles = async (files: File[], action: typeof fileAction) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setStatusMessage("请选择图片文件。");
      return;
    }

    try {
      const nextImages = await Promise.all(
        imageFiles.slice(0, action.mode === "replace" ? 1 : INPUT_IMAGE_LIMIT).map(fileToCompressedInputImage)
      );
      setInputImages((current) => {
        if (action.mode === "replace" && action.index !== null) {
          const cloned = [...current];
          cloned[action.index] = nextImages[0];
          return cloned.filter(Boolean).slice(0, INPUT_IMAGE_LIMIT);
        }
        const remainingSlots = INPUT_IMAGE_LIMIT - current.length;
        return [...current, ...nextImages.slice(0, Math.max(0, remainingSlots))];
      });
      setStatusMessage(`已载入 ${nextImages.length} 张参考图。`);
    } catch (error) {
      setStatusMessage(compactError(error));
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    await addFiles(files, fileAction);
  };

  const handleDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    await addFiles(Array.from(event.dataTransfer.files), { mode: "append", index: null });
  };

  const removeInputImage = (index: number) => {
    setInputImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const runGenerate = async () => {
    if (!canGenerate) {
      setStatusMessage("请先填写提示词，并从当前 Base URL 获取模型。");
      return;
    }

    const taskInputs = createGenerationPlan({
      workspace,
      inputImages,
      createId: (index) => `task-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      createRandomSeed: randomSeed
    });

    if (taskInputs.length === 0) {
      setStatusMessage("请至少填写一行有效提示词。");
      return;
    }

    if (!workspace.seedLocked && taskInputs[0]) {
      updateWorkspace({ seed: taskInputs[0].seed });
    }

    setIsGenerating(true);
    setGenerationTasks(
      taskInputs.map((task) => ({
        id: task.id,
        index: task.index,
        status: workspace.promptMode === "queue" && task.index > 0 ? "queued" : "running",
        message: workspace.promptMode === "queue" && task.index > 0 ? "等待队列" : "正在生成",
        prompt: task.prompt,
        seed: task.seed,
        aspectRatio: task.aspectRatio
      }))
    );
    setStatusMessage(
      workspace.promptMode === "queue" ? `队列生成中：共 ${taskInputs.length} 条提示词。` : `正在生成 ${taskInputs.length} 张图片...`
    );

    try {
      const runTask = async (task: (typeof taskInputs)[number]) => {
        setGenerationTasks((current) =>
          current.map((candidate) => (candidate.id === task.id ? { ...candidate, status: "running", message: "正在生成" } : candidate))
        );

        try {
          const result = await generateImage({
            workspace: { ...workspace, prompt: task.prompt, aspectRatio: task.aspectRatio },
            inputImages,
            seed: task.seed
          });
          const item: HistoryItem = {
            id: result.id,
            imageDataUrl: result.image.dataUrl,
            mimeType: result.image.mimeType,
            prompt: task.prompt,
            modelName: workspace.modelName,
            protocol: workspace.protocol,
            aspectRatio: task.aspectRatio,
            imageSize: workspace.imageSize,
            seed: task.seed,
            inputImageNames: inputImages.map((image) => image.name),
            createdAt: result.createdAt
          };

          setGenerationTasks((current) =>
            current.map((candidate) =>
              candidate.id === task.id
                ? {
                    ...candidate,
                    status: "success",
                    message: "生成完成",
                    imageDataUrl: item.imageDataUrl,
                    mimeType: item.mimeType,
                    createdAt: item.createdAt,
                    historyId: item.id
                  }
                : candidate
            )
          );
          return item;
        } catch (error) {
          const message = compactError(error);
          setGenerationTasks((current) =>
            current.map((candidate) => (candidate.id === task.id ? { ...candidate, status: "failed", message } : candidate))
          );
          throw new Error(message);
        }
      };

      const results =
        workspace.promptMode === "queue"
          ? await taskInputs.reduce<Promise<PromiseSettledResult<HistoryItem>[]>>(async (pending, task) => {
              const settled = await pending;
              try {
                settled.push({ status: "fulfilled", value: await runTask(task) });
              } catch (reason) {
                settled.push({ status: "rejected", reason });
              }
              return settled;
            }, Promise.resolve([]))
          : await Promise.allSettled(taskInputs.map(runTask));
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<HistoryItem> => result.status === "fulfilled");
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      if (fulfilled.length === 0) {
        throw new Error(rejected.map((item) => compactError(item.reason)).find(Boolean) ?? "生成失败。");
      }

      const createdItems = fulfilled.map((result) => result.value);
      const newestItem = createdItems.at(-1);

      setHistory((current) => [...createdItems.reverse(), ...current].slice(0, HISTORY_LIMIT));
      if (newestItem) {
        setSelectedHistoryId(newestItem.id);
      }

      setStatusMessage(
        rejected.length > 0
          ? `已完成 ${fulfilled.length}/${results.length} 张，另有 ${rejected.length} 张失败。`
          : `生成完成：${fulfilled.length} 张。`
      );
    } catch (error) {
      setStatusMessage(compactError(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const openTaskResult = (task: GenerationTask) => {
    if (!task.historyId) {
      return;
    }

    const item = history.find((candidate) => candidate.id === task.historyId);
    if (item) {
      setSelectedHistoryId(item.id);
      setLightboxImage(item);
      return;
    }

    if (task.imageDataUrl && task.mimeType && task.createdAt) {
      setLightboxImage({
        id: task.historyId,
        imageDataUrl: task.imageDataUrl,
        mimeType: task.mimeType,
        prompt: task.prompt ?? workspace.prompt,
        modelName: workspace.modelName,
        protocol: workspace.protocol,
        aspectRatio: task.aspectRatio ?? workspace.aspectRatio,
        imageSize: workspace.imageSize,
        seed: task.seed,
        inputImageNames: inputImages.map((image) => image.name),
        createdAt: task.createdAt
      });
    }
  };

  const toggleHistorySelection = (historyId: string) => {
    setSelectedHistoryIds((current) =>
      current.includes(historyId) ? current.filter((item) => item !== historyId) : [...current, historyId]
    );
  };

  const deleteSelectedHistory = () => {
    const targets = new Set(selectedHistoryIds);
    setHistory((current) => current.filter((item) => !targets.has(item.id)));
    setSelectedHistoryIds([]);
    setIsManagingHistory(false);
  };

  const downloadSelectedHistory = () => {
    const targets = new Set(selectedHistoryIds);
    const selectedItems = history.filter((item) => targets.has(item.id));

    if (selectedItems.length === 0) {
      setStatusMessage("请先选择要下载的历史图片。");
      return;
    }

    downloadHistoryAsZip(selectedItems);
    setStatusMessage(`已打包下载 ${selectedItems.length} 张图片。`);
  };

  const dismissUpdateAnnouncement = useCallback(() => {
    setIsUpdateAnnouncementOpen(false);
    try {
      localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, ANNOUNCEMENT_VERSION);
    } catch {
      // Storage can be unavailable in private or restricted browser sessions.
    }
  }, []);

  const showCaseLibraryFromAnnouncement = () => {
    dismissUpdateAnnouncement();
    setActiveView("cases");
  };

  const copyAssistantWechat = () => {
    void navigator.clipboard?.writeText("Ctikki888").catch(() => undefined);
    setStatusMessage("小助手微信：Ctikki888");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="https://ctikki.com" target="_blank" rel="noreferrer" aria-label="访问 ctikki.com">
          <span className="brand-mark" aria-hidden="true">
            <img src="/image-studio-icon.svg" alt="" />
          </span>
          <div>
            <p className="eyebrow">Custom generation</p>
            <h1>Image Studio</h1>
          </div>
        </a>

        <div className="topbar-actions">
          <a
            className="topup-button"
            href="https://pay.ldxp.cn/shop/AMTT76KG"
            rel="noreferrer"
            target="_blank"
          >
            <CreditCard size={17} />
            充值
          </a>

          <nav className="view-tabs" aria-label="主功能标签">
            <button
              className={activeView === "studio" ? "is-active" : ""}
              onClick={() => setActiveView("studio")}
              type="button"
            >
              <SlidersHorizontal size={16} />
              工作台
            </button>
            <button
              className={activeView === "cases" ? "is-active" : ""}
              onClick={() => setActiveView("cases")}
              type="button"
            >
              <ImageIcon size={16} />
              案例专区
            </button>
          </nav>
        </div>

        <p className="status-pill" aria-live="polite">
          {isStatusBusy ? <Loader2 className="spin" size={16} /> : null}
          <span className="status-text">{visibleStatusMessage}</span>
        </p>

        <button
          aria-label={workspace.theme === "light" ? "切换深色主题" : "切换浅色主题"}
          className="icon-button"
          onClick={() => updateWorkspace({ theme: workspace.theme === "light" ? "dark" : "light" })}
          title={workspace.theme === "light" ? "深色" : "浅色"}
          type="button"
        >
          {workspace.theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </header>

      {activeView === "studio" ? (
        <section className={`motion-console ${isGenerating ? "is-live" : ""}`} aria-label="创意引擎状态">
          <div className="motion-console-signal" aria-hidden="true">
            <span />
          </div>
          <div className="motion-console-copy">
            <span>Creative engine</span>
            <strong>{isGenerating ? "正在把提示词推入生成队列" : "准备生成下一组画面"}</strong>
          </div>
          <dl className="motion-console-stats" aria-label="当前生成设置">
            <div>
              <dt>Tasks</dt>
              <dd>{String(plannedTaskCount).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>{effectiveAspectRatio === "Adaptive" ? "自动" : effectiveAspectRatio}</dd>
            </div>
            <div>
              <dt>Quality</dt>
              <dd>{workspace.imageSize}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {activeView === "studio" ? (
      <div className={`workbench-shell ${isHistorySidebarOpen ? "is-history-open" : ""}`}>
      <main className="workbench" aria-label="Image Studio 工作台">
        <section className="panel params-panel" aria-label="参数">
          <div className="section-heading">
            <span>01</span>
            <h2>参数</h2>
          </div>

          <label className="field">
            <span>API Key</span>
            <div className="inline-control">
              <input
                autoComplete="off"
                onChange={(event) => updateWorkspace({ apiKey: event.currentTarget.value })}
                placeholder="sk-..."
                type={isApiKeyVisible ? "text" : "password"}
                value={workspace.apiKey}
              />
              <button
                aria-label={isApiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                className="icon-button control-button"
                onClick={() => setIsApiKeyVisible((current) => !current)}
                type="button"
              >
                {isApiKeyVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <label className="field">
            <span>提示词</span>
            <textarea
              onChange={(event) => updateWorkspace({ prompt: event.currentTarget.value })}
              placeholder={
                workspace.promptMode === "queue"
                  ? "一行一个提示词，例如：\n电商主图\n侧身姿势图\n细节特写图"
                  : "请输入你想生成或修改的内容"
              }
              value={workspace.prompt}
            />
            <span className="field-hint">
              {workspace.promptMode === "queue" ? `已识别 ${promptQueue.length} 条提示词，将按顺序逐张生成。` : "同一个提示词可一次生成多张。"}
            </span>
          </label>

          <div className="segmented-control" role="group" aria-label="生成模式">
            <button
              className={workspace.promptMode === "count" ? "is-active" : ""}
              onClick={() => updateWorkspace({ promptMode: "count" })}
              type="button"
            >
              同提示词 N 张
            </button>
            <button
              className={workspace.promptMode === "queue" ? "is-active" : ""}
              onClick={() => updateWorkspace({ promptMode: "queue" })}
              type="button"
            >
              多提示词队列
            </button>
          </div>

          <label className="field">
            <span>Base URL</span>
            <input
              onChange={(event) => updateWorkspace({ baseUrl: event.currentTarget.value, modelName: "" })}
              placeholder={DEFAULT_BASE_URL}
              type="url"
              value={workspace.baseUrl}
            />
          </label>

          <label className="field">
            <span>模型</span>
            <div className="inline-control model-control">
              <select
                disabled={isLoadingModels || modelOptions.length === 0}
                onChange={(event) => {
                  const model = modelOptions.find((item) => item.id === event.currentTarget.value);
                  if (!model) {
                    return;
                  }
                  updateWorkspace({ modelName: model.id, protocol: model.protocol });
                }}
                value={workspace.modelName}
              >
                {isLoadingModels ? <option value="">正在获取模型...</option> : null}
                {!isLoadingModels && modelOptions.length === 0 ? <option value="">未获取到模型</option> : null}
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
              <button
                aria-label="刷新模型列表"
                className="icon-button control-button"
                disabled={isLoadingModels || !workspace.baseUrl.trim()}
                onClick={() => void loadModels("manual")}
                title="刷新模型列表"
                type="button"
              >
                <RefreshCw className={isLoadingModels ? "spin" : ""} size={18} />
              </button>
            </div>
          </label>

          <div className="field-row compact-setting-row">
            <label className="field">
              <span>比例</span>
              <select
                onChange={(event) => updateWorkspace({ aspectRatio: event.currentTarget.value as AspectRatio })}
                value={workspace.aspectRatio}
              >
                {ASPECT_RATIO_OPTIONS.map((ratio) => (
                  <option key={ratio.value} value={ratio.value}>
                    {ratio.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>画质</span>
              <select
                onChange={(event) => updateWorkspace({ imageSize: event.currentTarget.value as ImageSize })}
                value={workspace.imageSize}
              >
                {IMAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <span className="field-hint compact-setting-hint">
              {workspace.aspectRatio === "Adaptive"
                ? effectiveAspectRatio === "Adaptive"
                  ? "自动：未上传参考图时由上游决定比例。"
                  : `自动：跟随第一张参考图，按 ${effectiveAspectRatio} 生成。`
                : "手动比例会优先生效。"}
            </span>
          </div>

          <div className="field-row single-field-row">
            <label className="field">
              <span>{workspace.promptMode === "queue" ? "队列条数" : "数量"}</span>
              <input
                disabled={workspace.promptMode === "queue"}
                max={10}
                min={1}
                onChange={(event) =>
                  updateWorkspace({
                    concurrency: Math.min(10, Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1))
                  })
                }
                type="number"
                value={workspace.promptMode === "queue" ? promptQueue.length : workspace.concurrency}
              />
              <span className="field-hint">
                {workspace.promptMode === "queue" ? "队列模式按有效提示词行数生成，每行一张。" : `本次会创建 ${plannedTaskCount} 个生成任务。`}
              </span>
            </label>
          </div>

          <div className="advanced-box">
            <button className="advanced-toggle" onClick={() => setIsAdvancedOpen((current) => !current)} type="button">
              <span>
                <SlidersHorizontal size={16} />
                高级参数
              </span>
              <small>{workspace.seedLocked ? `Seed ${workspace.seed}` : "随机 Seed"}</small>
            </button>

            {isAdvancedOpen ? (
              <div className="advanced-content">
                <label className="field">
                  <span>Seed</span>
                  <div className="inline-control">
                    <input
                      min={0}
                      onChange={(event) =>
                        updateWorkspace({ seed: Math.max(0, Number.parseInt(event.currentTarget.value, 10) || 0) })
                      }
                      type="number"
                      value={workspace.seed}
                    />
                    <button
                      aria-label={workspace.seedLocked ? "解除 Seed 锁定" : "锁定 Seed"}
                      className={`icon-button control-button ${workspace.seedLocked ? "is-active" : ""}`}
                      onClick={() => updateWorkspace({ seedLocked: !workspace.seedLocked })}
                      title={workspace.seedLocked ? "已锁定 Seed" : "使用随机 Seed"}
                      type="button"
                    >
                      {workspace.seedLocked ? <Lock size={17} /> : <Unlock size={17} />}
                    </button>
                  </div>
                  <span className="field-hint">
                    {workspace.seedLocked
                      ? "锁定后批量任务会使用 seed、seed+1、seed+2，方便复现系列图。"
                      : "未锁定时每次运行会自动生成新的起始 seed。"}
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          <button className="run-button" disabled={!canGenerate} onClick={() => void runGenerate()} type="button">
            {isGenerating ? <Loader2 className="spin" size={20} /> : <Play size={20} />}
            运行
          </button>
        </section>

        <section className="panel upload-panel" aria-label="上传图像">
          <div className="section-heading">
            <span>02</span>
            <h2>参考图</h2>
          </div>

          <input
            accept="image/*"
            className="visually-hidden"
            multiple={fileAction.mode === "append"}
            onChange={(event) => void handleFileChange(event)}
            ref={fileInputRef}
            type="file"
          />

          <button
            className={`upload-dropzone ${selectedInputImage ? "has-image" : ""}`}
            onClick={() =>
              openFilePicker({
                mode: selectedInputImage ? "replace" : "append",
                index: selectedInputImage ? selectedInputIndex : null
              })
            }
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleDrop(event)}
            type="button"
          >
            {selectedInputImage ? (
              <img alt={selectedInputImage.name} src={selectedInputImage.dataUrl} />
            ) : (
              <div className="empty-upload">
                <UploadCloud size={34} />
                <strong>上传参考图</strong>
                <span>最多 {INPUT_IMAGE_LIMIT} 张</span>
              </div>
            )}
          </button>

          <div className="preview-row">
            {inputImages.map((image, index) => (
              <button
                aria-label={`选择 ${image.name}`}
                className={`preview-tile ${index === selectedInputIndex ? "is-active" : ""}`}
                key={image.id}
                onClick={() => setSelectedInputIndex(index)}
                type="button"
              >
                <img alt="" src={image.dataUrl} />
                <span className="preview-index">{index + 1}</span>
                <span className="preview-meta">{readableSize(image.size)}</span>
                <span
                  aria-label={`删除 ${image.name}`}
                  className="tile-delete"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeInputImage(index);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <X size={14} />
                </span>
              </button>
            ))}
            <button
              aria-label="添加参考图"
              className="add-tile"
              disabled={inputImages.length >= INPUT_IMAGE_LIMIT}
              onClick={() => openFilePicker({ mode: "append", index: null })}
              type="button"
            >
              <Plus size={22} />
            </button>
          </div>
        </section>

        <section className="output-region" aria-label="结果">
          <div className="panel output-panel">
            <div className="section-heading">
              <span>03</span>
              <h2>结果</h2>
            </div>

            {generationTasks.length > 0 ? (
              <div className="generation-task-grid" aria-label="生成任务">
                {generationTasks.map((task) => (
                  <button
                    className={`generation-task-card is-${task.status}`}
                    disabled={task.status !== "success"}
                    key={task.id}
                    onClick={() => openTaskResult(task)}
                    type="button"
                  >
                    <span className="generation-task-index">{String(task.index + 1).padStart(2, "0")}</span>
                    <span className="generation-task-preview">
                      {task.imageDataUrl ? (
                        <img alt="" src={task.imageDataUrl} />
                      ) : task.status === "failed" ? (
                        <X size={22} />
                      ) : task.status === "queued" ? (
                        <span className="queued-dot" />
                      ) : (
                        <Loader2 className="spin" size={22} />
                      )}
                    </span>
                    <span className="generation-task-copy">
                      <strong>
                        {task.status === "success" ? "已完成" : task.status === "failed" ? "生成失败" : task.status === "queued" ? "排队中" : "生成中"}
                        {task.status === "success" ? <CheckCircle2 size={14} /> : null}
                      </strong>
                      <small>{task.prompt ? `${task.message} · ${task.prompt}` : task.message}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {visibleHistoryItem ? (
              <div className="output-content">
                <button className="output-image-button" onClick={() => setLightboxImage(visibleHistoryItem)} type="button">
                  <img alt={visibleHistoryItem.prompt} src={visibleHistoryItem.imageDataUrl} />
                </button>
                <div className="output-actions">
                  <div>
                    <strong>{visibleHistoryItem.modelName}</strong>
                    <span>{formatTime(visibleHistoryItem.createdAt)}</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      downloadDataUrl({
                        dataUrl: visibleHistoryItem.imageDataUrl,
                        mimeType: visibleHistoryItem.mimeType,
                        createdAt: visibleHistoryItem.createdAt
                      })
                    }
                    type="button"
                  >
                    <Download size={17} />
                    下载
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-output">
                <ImageIcon size={42} />
                <strong>等待生成</strong>
              </div>
            )}
          </div>

        </section>
      </main>
      <button
        aria-controls="history-sidebar"
        aria-expanded={isHistorySidebarOpen}
        aria-label={isHistorySidebarOpen ? "关闭历史侧边栏" : "打开历史侧边栏"}
        className="history-toggle-button"
        onClick={() => {
          if (isHistorySidebarOpen) {
            setIsManagingHistory(false);
          }
          setIsHistorySidebarOpen((current) => !current);
        }}
        title={isHistorySidebarOpen ? "关闭历史" : "打开历史"}
        type="button"
      >
        {isHistorySidebarOpen ? <X size={17} /> : <ImageIcon size={17} />}
        <span>历史</span>
      </button>
      <aside
        aria-hidden={!isHistorySidebarOpen}
        aria-label="历史记录"
        className={`panel history-panel history-sidebar ${isHistorySidebarOpen ? "is-open" : ""}`}
        id="history-sidebar"
      >
        <div className={`history-head ${isManagingHistory ? "is-managing" : ""}`}>
          <div className="history-title-row">
            <div className="history-title">
              <h2>历史</h2>
              <span>{isManagingHistory ? `已选 ${selectedHistoryIds.length}` : isHistoryLoaded ? `${history.length} 张` : "读取中"}</span>
            </div>
            {!isManagingHistory ? (
              <button className="text-button small" onClick={() => setIsManagingHistory(true)} type="button">
                管理
              </button>
            ) : null}
          </div>
          {isManagingHistory ? (
            <div className="history-actions" aria-label="历史批量操作">
              <button
                aria-label="下载选中"
                className="icon-button control-button"
                disabled={selectedHistoryIds.length === 0}
                onClick={downloadSelectedHistory}
                title="下载选中"
                type="button"
              >
                <Download size={17} />
              </button>
              <button
                className="icon-button control-button"
                disabled={selectedHistoryIds.length === 0}
                onClick={deleteSelectedHistory}
                title="删除选中"
                type="button"
              >
                <Trash2 size={17} />
              </button>
              <button className="icon-button control-button" onClick={() => setIsManagingHistory(false)} title="完成" type="button">
                <X size={17} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="history-list">
          {!isHistoryLoaded ? (
            <div className="empty-history">正在读取历史</div>
          ) : history.length === 0 ? (
            <div className="empty-history">暂无记录</div>
          ) : (
            history.map((item) => (
              <button
                aria-label={`查看 ${formatTime(item.createdAt)}`}
                className={`history-tile ${item.id === visibleHistoryItem?.id ? "is-active" : ""} ${
                  selectedHistoryIds.includes(item.id) ? "is-selected" : ""
                }`}
                key={item.id}
                onClick={() => {
                  if (isManagingHistory) {
                    toggleHistorySelection(item.id);
                    return;
                  }
                  setSelectedHistoryId(item.id);
                }}
                type="button"
              >
                <img alt="" src={item.imageDataUrl} />
                <span>{formatTime(item.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      </aside>
      </div>
      ) : (
        <main className="case-library-page" aria-label="案例专区">
          <section className="case-library-main" aria-label="案例浏览">
            <div className="case-library-hero">
              <div>
                <p className="eyebrow">Prompt gallery</p>
                <h2>案例专区</h2>
                <p>
                  收录 {CASE_LIBRARY_SOURCE.name} 画廊案例，点击卡片查看详情，一键复制提示词或套用到生图工作台。
                </p>
              </div>
              <a className="case-source-link" href={CASE_LIBRARY_SOURCE.sourceRepository} rel="noreferrer" target="_blank">
                GitHub 项目
                <ExternalLink size={16} />
              </a>
            </div>

            <div className="case-library-toolbar">
              <label className="case-search" aria-label="搜索案例">
                <Search size={18} />
                <input
                  onChange={(event) => setCaseLibraryQuery(event.currentTarget.value)}
                  placeholder="搜索案例、提示词、来源..."
                  type="search"
                  value={caseLibraryQuery}
                />
              </label>
              <div className="case-count">
                <strong>{filteredCaseLibrary.length}</strong>
                <span>/ {caseLibraryTotal || caseLibraryItems.length} 个案例</span>
              </div>
            </div>

            <div className="case-category-row" aria-label="案例分类">
              {[ALL_CASE_CATEGORY, ...caseLibraryCategories].map((category) => (
                <button
                  className={selectedCaseCategory === category ? "is-active" : ""}
                  key={category}
                  onClick={() => setSelectedCaseCategory(category)}
                  type="button"
                >
                  {category === ALL_CASE_CATEGORY ? ALL_CASE_CATEGORY : localizeCaseCategory(category)}
                </button>
              ))}
            </div>

            {isCaseLibraryLoading ? (
              <div className="empty-case-library">
                <Loader2 className="spin" size={34} />
                <strong>正在加载案例库</strong>
                <span>读取 awesome-gpt-image-2 的完整案例数据。</span>
              </div>
            ) : caseLibraryError ? (
              <div className="empty-case-library">
                <X size={34} />
                <strong>{caseLibraryError}</strong>
                <span>请确认本地 /cases-index.json 可以访问。</span>
              </div>
            ) : filteredCaseLibrary.length > 0 ? (
              <div className="case-library-grid">
                {filteredCaseLibrary.map((caseItem, index) => (
                  <button
                    className={`case-card ${selectedCaseItem?.id === caseItem.id ? "is-active" : ""}`}
                    key={caseItem.id}
                    onClick={() => openCaseDetail(caseItem.id)}
                    type="button"
                  >
                    <span className="case-image-wrap">
                      <img
                        alt={caseItem.imageAlt}
                        decoding="async"
                        fetchPriority={index < 4 ? "high" : "auto"}
                        loading="lazy"
                        src={caseItem.thumbImage}
                      />
                      <span>#{caseItem.id}</span>
                    </span>
                    <span className="case-card-body">
                      <strong>{caseItem.title}</strong>
                      <small>{localizeCaseCategory(caseItem.category)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-case-library">
                <Search size={34} />
                <strong>没有找到匹配案例</strong>
                <span>换个关键词或分类试试。</span>
              </div>
            )}
          </section>

          <aside className="case-library-detail" aria-label="案例详情">
            {selectedCaseItem ? (
              <CaseLibraryDetailPanel
                canUsePrompt={canUseSelectedCasePrompt}
                caseItem={selectedCaseItem}
                copiedCaseId={copiedCaseId}
                isCasePromptLoading={isCasePromptLoading}
                onApply={applyCasePrompt}
                onCopy={copyCasePrompt}
                prompt={selectedCasePrompt}
              />
            ) : (
              <div className="empty-case-detail">
                <ImageIcon size={36} />
                <strong>选择一个案例</strong>
                <span>点击左侧卡片查看提示词和生成入口。</span>
              </div>
            )}
          </aside>
        </main>
      )}

      {activeView === "cases" && selectedCaseItem && isMobileCaseDetailOpen ? (
        <div
          className="case-detail-sheet-backdrop"
          onClick={() => setIsMobileCaseDetailOpen(false)}
          role="presentation"
        >
          <section
            aria-label="案例移动端详情"
            className="case-detail-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <CaseLibraryDetailPanel
              canUsePrompt={canUseSelectedCasePrompt}
              caseItem={selectedCaseItem}
              copiedCaseId={copiedCaseId}
              headerAction={
                <button
                  aria-label="关闭案例详情"
                  className="icon-button case-detail-sheet-close"
                  onClick={() => setIsMobileCaseDetailOpen(false)}
                  type="button"
                >
                  <X size={18} />
                </button>
              }
              isCasePromptLoading={isCasePromptLoading}
              onApply={applyCasePrompt}
              onCopy={copyCasePrompt}
              prompt={selectedCasePrompt}
            />
          </section>
        </div>
      ) : null}

      {isUpdateAnnouncementOpen ? (
        <div className="release-announcement-backdrop" onClick={dismissUpdateAnnouncement} role="presentation">
          <section
            aria-labelledby="release-announcement-title"
            aria-modal="true"
            className="release-announcement-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="关闭更新公告"
              className="icon-button release-announcement-close"
              onClick={dismissUpdateAnnouncement}
              type="button"
            >
              <X size={18} />
            </button>
            <p className="release-announcement-kicker">Image Studio Release</p>
            <h2 id="release-announcement-title">5.20更新公告</h2>
            <div className="release-announcement-copy">
              <p>
                接入了全球最强生图模型 <strong>gptimage2</strong>，收集了全网{" "}
                <strong>442 条玩法案例</strong>，一键复刻，立即赚钱。
              </p>
              <p>
                欢迎大家反馈 bug 或提供优化意见，联系小助手 VX：<strong>Ctikki888</strong>{" "}
                加群一起交流。
              </p>
            </div>
            <div className="release-announcement-actions">
              <button className="release-announcement-primary" onClick={showCaseLibraryFromAnnouncement} type="button">
                查看玩法案例
              </button>
              <button className="release-announcement-secondary" onClick={copyAssistantWechat} type="button">
                <Copy size={16} />
                复制微信
              </button>
              <button className="release-announcement-secondary" onClick={dismissUpdateAnnouncement} type="button">
                我知道了
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {lightboxImage ? (
        <div className="lightbox" onClick={() => setLightboxImage(null)} role="dialog" aria-label="图片预览">
          <div className="lightbox-inner" onClick={(event) => event.stopPropagation()}>
            <button className="icon-button lightbox-close" onClick={() => setLightboxImage(null)} type="button">
              <X size={18} />
            </button>
            <img alt={lightboxImage.prompt} src={lightboxImage.imageDataUrl} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
