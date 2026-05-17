import {
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { fetchProviderModels, generateImage } from "./api";
import { loadStoredHistory, saveStoredHistory } from "./historyStore";
import type { AspectRatio, HistoryItem, ImageSize, InputImage, ProviderModelOption, WorkspaceState } from "./types";

const WORKSPACE_KEY = "custom-image-workspace-v2";
const INPUT_IMAGE_LIMIT = 12;
const HISTORY_LIMIT = 40;
const DEFAULT_BASE_URL = "https://api.lts4ai.com";
const LEGACY_DEFAULT_BASE_URLS = new Set(["http://64.186.244.43:12001"]);
const LEGACY_DEFAULT_PROMPTS = new Set([
  "把参考图中的服装穿到模特身上，保持版型、材质和细节一致。"
]);

const ASPECT_RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "Adaptive", label: "自适应" },
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

const DEFAULT_WORKSPACE: WorkspaceState = {
  theme: "light",
  prompt: "",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  modelName: "",
  protocol: "gemini_generate_content",
  aspectRatio: "Adaptive",
  imageSize: "2K",
  concurrency: 1
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
      concurrency: Math.min(10, Math.max(1, Number.parseInt(String(workspace.concurrency), 10) || 1))
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("无法读取图片数据。");
  }
  return { mimeType: match[1], data: match[2] };
}

function fileToInputImage(file: File): Promise<InputImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const parsed = parseDataUrl(dataUrl);
      resolve({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        mimeType: parsed.mimeType,
        data: parsed.data,
        dataUrl,
        size: file.size
      });
    };
    reader.readAsDataURL(file);
  });
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
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "生成失败。";
}

function pickDefaultModel(models: ProviderModelOption[], currentModelName: string) {
  const currentModel = models.find((model) => model.id === currentModelName);
  if (currentModel) {
    return currentModel;
  }

  return models[0] ?? null;
}

export default function App() {
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("工作台就绪。");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<HistoryItem | null>(null);
  const [fileAction, setFileAction] = useState<{ mode: "append" | "replace"; index: number | null }>({
    mode: "append",
    index: null
  });
  const modelLoadRequestRef = useRef(0);
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
  const canGenerate =
    !isGenerating &&
    !isLoadingModels &&
    workspace.prompt.trim().length > 0 &&
    workspace.baseUrl.trim().length > 0 &&
    workspace.modelName.trim().length > 0 &&
    modelOptions.some((model) => model.id === workspace.modelName);

  const updateWorkspace = useCallback((patch: Partial<WorkspaceState>) => {
    setWorkspace((current) => ({ ...current, ...patch }));
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
        imageFiles.slice(0, action.mode === "replace" ? 1 : INPUT_IMAGE_LIMIT).map(fileToInputImage)
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

    const requestCount = Math.min(10, Math.max(1, workspace.concurrency));
    const seeds = Array.from({ length: requestCount }, randomSeed);

    setIsGenerating(true);
    setStatusMessage(`正在生成 ${requestCount} 张图片...`);

    try {
      const results = await Promise.allSettled(
        seeds.map((seed) =>
          generateImage({
            workspace,
            inputImages,
            seed
          })
        )
      );
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof generateImage>>> => result.status === "fulfilled");
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      if (fulfilled.length === 0) {
        throw new Error(rejected.map((item) => compactError(item.reason)).find(Boolean) ?? "生成失败。");
      }

      const createdItems: HistoryItem[] = fulfilled.map((result) => ({
        id: result.value.id,
        imageDataUrl: result.value.image.dataUrl,
        mimeType: result.value.image.mimeType,
        prompt: workspace.prompt,
        modelName: workspace.modelName,
        protocol: workspace.protocol,
        aspectRatio: workspace.aspectRatio,
        imageSize: workspace.imageSize,
        inputImageNames: inputImages.map((image) => image.name),
        createdAt: result.value.createdAt
      }));
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

    selectedItems.forEach((item) => downloadDataUrl({
      dataUrl: item.imageDataUrl,
      mimeType: item.mimeType,
      createdAt: item.createdAt
    }));
    setStatusMessage(`已开始下载 ${selectedItems.length} 张图片。`);
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

        <p className="status-pill" aria-live="polite">
          {isGenerating || isLoadingModels ? <Loader2 className="spin" size={16} /> : null}
          {statusMessage}
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
              placeholder="请输入你想生成或修改的内容"
              value={workspace.prompt}
            />
          </label>

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

          <div className="field-row">
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
          </div>

          <div className="field-row single-field-row">
            <label className="field">
              <span>数量</span>
              <input
                max={10}
                min={1}
                onChange={(event) =>
                  updateWorkspace({
                    concurrency: Math.min(10, Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1))
                  })
                }
                type="number"
                value={workspace.concurrency}
              />
            </label>
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

          <aside className="panel history-panel" aria-label="历史记录">
            <div className="history-head">
              <div>
                <h2>历史</h2>
                <span>{isManagingHistory ? `已选 ${selectedHistoryIds.length}` : isHistoryLoaded ? `${history.length} 张` : "读取中"}</span>
              </div>
              {isManagingHistory ? (
                <div className="history-actions">
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
              ) : (
                <button className="text-button small" onClick={() => setIsManagingHistory(true)} type="button">
                  管理
                </button>
              )}
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
        </section>
      </main>

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
