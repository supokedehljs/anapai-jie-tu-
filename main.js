const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  shell,
  nativeImage,
  ipcMain,
  dialog,
  desktopCapturer,
  globalShortcut,
  clipboard,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");

let tray = null;
let captureWindow = null;
let pendingCapturePayload = null;
let workflowWindow = null;
let settingsWindow = null;
let pinDragState = null;
let pinnedWindowsHidden = false;
const pinnedImageWindows = new Map();
let lastFocusedPinWindowId = null;
let selectedPinnedImageIds = new Set();
const isPackagedApp = app.isPackaged;
const bundledConfigPath = path.join(__dirname, "runninghub.config.json");
const bundledWorkflowDir = path.join(__dirname, "runninghub-workflows");
const appDataRoot = isPackagedApp
  ? path.join(app.getPath("userData"), "runninghub-data")
  : __dirname;
const logFilePath = path.join(appDataRoot, "running-jietu-debug.log");
const runningHubConfigPath = path.join(appDataRoot, "runninghub.config.json");
const runningHubWorkflowDir = isPackagedApp
  ? path.join(appDataRoot, "runninghub-workflows")
  : bundledWorkflowDir;
let runningHubActiveCount = 0;
const WORKFLOW_IMAGE_PLACEHOLDER = "{{RUNNINGHUB_IMAGE_URL}}";

function generatePinnedImageId() {
  return `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPinnedWindowEntries() {
  return Array.from(pinnedImageWindows.values()).filter(
    (entry) => entry && entry.window && !entry.window.isDestroyed()
  );
}

function getPinnedWindowEntryByWebContents(webContents) {
  if (!webContents) return null;
  return (
    getPinnedWindowEntries().find((entry) => entry.window.webContents.id === webContents.id) ||
    null
  );
}

function getSelectedPinnedWindowEntries() {
  const selectedEntries = getPinnedWindowEntries().filter((entry) =>
    selectedPinnedImageIds.has(entry.id)
  );
  return selectedEntries.length ? selectedEntries : [];
}

function getPrimaryPinnedWindowEntry() {
  const selectedEntries = getSelectedPinnedWindowEntries();
  if (selectedEntries.length) {
    return selectedEntries[selectedEntries.length - 1] || null;
  }
  if (lastFocusedPinWindowId && pinnedImageWindows.has(lastFocusedPinWindowId)) {
    const focusedEntry = pinnedImageWindows.get(lastFocusedPinWindowId);
    if (focusedEntry && focusedEntry.window && !focusedEntry.window.isDestroyed()) {
      return focusedEntry;
    }
  }
  const entries = getPinnedWindowEntries();
  return entries[entries.length - 1] || null;
}

function normalizePinnedImageList(images = []) {
  return images.filter((item) => typeof item === "string" && item.trim());
}

function buildPinImagesPayload(entry) {
  const images = normalizePinnedImageList(entry && entry.images ? entry.images : []);
  const fallbackImages =
    images.length || !entry || typeof entry.dataUrl !== "string" || !entry.dataUrl
      ? images
      : [entry.dataUrl];
  const maxIndex = Math.max(0, fallbackImages.length - 1);
  const activeIndex = Math.min(Math.max(Number(entry && entry.activeImageIndex) || 0, 0), maxIndex);
  return {
    images: fallbackImages,
    activeIndex,
  };
}

function syncPinImages(entry) {
  if (!entry || !entry.window || entry.window.isDestroyed()) return;
  const payload = buildPinImagesPayload(entry);
  entry.images = payload.images;
  entry.activeImageIndex = payload.activeIndex;
  entry.dataUrl = payload.images[payload.activeIndex] || "";
  entry.window.webContents.send("set-image", payload);
}

function appendImageToPinEntry(entry, dataUrl, options = {}) {
  if (!entry || typeof dataUrl !== "string" || !dataUrl.trim()) return;
  const payload = buildPinImagesPayload(entry);
  const nextImages = [...payload.images, dataUrl];
  entry.images = nextImages;
  entry.activeImageIndex =
    options.activateAppended === false ? payload.activeIndex : nextImages.length - 1;
  syncPinImages(entry);
}

function syncPinnedSelectionStyles() {
  getPinnedWindowEntries().forEach((entry) => {
    entry.window.webContents.send("pin-selection-state", {
      selected: selectedPinnedImageIds.has(entry.id),
      selectionCount: selectedPinnedImageIds.size,
    });
  });
}

function sendWorkflowInputContext() {
  if (workflowWindow && !workflowWindow.isDestroyed()) {
    workflowWindow.webContents.send("workflow-input-context", getWorkflowInputContext());
  }
}

function setSelectedPinnedImages(ids = []) {
  const validIds = new Set(
    ids.filter((id) => typeof id === "string" && pinnedImageWindows.has(id))
  );
  selectedPinnedImageIds = validIds;
  syncPinnedSelectionStyles();
  sendWorkflowInputContext();
}

function togglePinnedImageSelection(id, additive = false) {
  if (!id || !pinnedImageWindows.has(id)) return;
  if (!additive) {
    setSelectedPinnedImages([id]);
    return;
  }
  const nextSelected = new Set(selectedPinnedImageIds);
  if (nextSelected.has(id)) {
    nextSelected.delete(id);
  } else {
    nextSelected.add(id);
  }
  setSelectedPinnedImages(Array.from(nextSelected));
}

function deletePinnedWindowEntry(id) {
  if (!id) return;
  pinnedImageWindows.delete(id);
  if (selectedPinnedImageIds.has(id)) {
    const nextSelected = new Set(selectedPinnedImageIds);
    nextSelected.delete(id);
    selectedPinnedImageIds = nextSelected;
  }
  if (lastFocusedPinWindowId === id) {
    lastFocusedPinWindowId = null;
  }
  syncPinnedSelectionStyles();
  sendWorkflowInputContext();
}

function getDefaultWorkflowConfig(fileName = "") {
  return {
    fileName: String(fileName || ""),
    displayName: path.basename(String(fileName || ""), path.extname(String(fileName || ""))),
    workflowId: "",
    imageNodeId: "36",
    imageFieldName: "image",
    outputNodeId: "",
    imagePlaceholder: WORKFLOW_IMAGE_PLACEHOLDER,
  };
}

function getThumbnailExtensionFromPath(filePath = "") {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext) ? ext : ".png";
}

function removeWorkflowThumbnailFiles(fileName) {
  const baseName = path.basename(String(fileName || ""), path.extname(String(fileName || "")));
  [".png", ".jpg", ".jpeg", ".webp", ".gif"].forEach((ext) => {
    const targetPath = path.join(runningHubWorkflowDir, `${baseName}${ext}`);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  });
}

function deleteWorkflowFiles(fileName) {
  const normalizedFileName = String(fileName || "").trim();
  if (!normalizedFileName) {
    throw new Error("无效的工作流文件名");
  }
  const jsonPath = path.join(runningHubWorkflowDir, normalizedFileName);
  const configPath = getWorkflowConfigPath(normalizedFileName);
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
  }
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
  removeWorkflowThumbnailFiles(normalizedFileName);
}

function saveWorkflowThumbnail(fileName, sourcePath = "") {
  if (!sourcePath) {
    return "";
  }
  ensureRunningHubFiles();
  const baseName = path.basename(String(fileName || ""), path.extname(String(fileName || "")));
  const ext = getThumbnailExtensionFromPath(sourcePath);
  const targetPath = path.join(runningHubWorkflowDir, `${baseName}${ext}`);
  removeWorkflowThumbnailFiles(fileName);
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function replaceWorkflowJsonFile(fileName, sourcePath = "") {
  if (!sourcePath) {
    return "";
  }
  ensureRunningHubFiles();
  const targetPath = path.join(runningHubWorkflowDir, String(fileName || ""));
  const rawContent = fs.readFileSync(sourcePath, "utf8");
  const parsed = JSON.parse(rawContent);
  fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), "utf8");
  return targetPath;
}

function getDefaultAppSettings() {
  return {
    apiKey: "",
    uploadUrl: "https://www.runninghub.cn/task/openapi/upload",
    createTaskUrl: "https://www.runninghub.cn/task/openapi/create",
    taskStatusUrl: "https://www.runninghub.cn/task/openapi/status",
    taskOutputsUrl: "https://www.runninghub.ai/task/openapi/outputs",
    webhookDetailUrl: "https://www.runninghub.cn/task/openapi/getWebhookDetail",
    selectedWorkflowFile: "",
    captureShortcut: "CommandOrControl+Shift+A",
    workflowShortcut: "CommandOrControl+Shift+W",
    togglePinnedShortcut: "CommandOrControl+Shift+H",
    defaultClickThrough: false,
    autoCopyToClipboard: true,
    launchAtStartup: false,
    defaultSaveDirectory: app.getPath("pictures"),
  };
}

function logDebug(message, extra = "") {
  const line = `[${new Date().toISOString()}] ${message}${
    extra ? ` | ${extra}` : ""
  }\n`;
  fs.appendFile(logFilePath, line, "utf8", () => {
    // Keep app running even if writing log fails.
  });
}

function createTrayIcon() {
  const iconCandidates = [
    path.join(__dirname, "assets", "running-jietu-icon.ico"),
    path.join(__dirname, "assets", "running-jietu-icon.png"),
    path.join(__dirname, "assets", "running-jietu-icon.svg"),
  ];

  for (const iconPath of iconCandidates) {
    if (!fs.existsSync(iconPath)) continue;
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image.resize({ width: 16, height: 16 });
    }
  }

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <text x="32" y="58" text-anchor="middle" font-size="63" font-family="Segoe UI, Arial, sans-serif" font-weight="700" fill="#ffffff">R</text>
  </svg>`;
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: 16, height: 16 });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Running Jietu v2.0");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "区域截图",
      click: () => startCapture(),
    },
    {
      label: "选择工作流窗口",
      click: () => showWorkflowWindow(),
    },
    {
      label: pinnedWindowsHidden ? "显示置顶贴图" : "隐藏置顶贴图",
      click: () => togglePinnedImagesVisibility(),
    },
    {
      label: "设置",
      click: () => showSettingsWindow(),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function refreshTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "区域截图",
      click: () => startCapture(),
    },
    {
      label: "选择工作流窗口",
      click: () => showWorkflowWindow(),
    },
    {
      label: pinnedWindowsHidden ? "显示置顶贴图" : "隐藏置顶贴图",
      click: () => togglePinnedImagesVisibility(),
    },
    {
      label: "设置",
      click: () => showSettingsWindow(),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function copyBundledWorkflowsToUserDir() {
  if (!isPackagedApp || !fs.existsSync(bundledWorkflowDir)) {
    return;
  }

  const bundledFiles = fs.readdirSync(bundledWorkflowDir);
  bundledFiles.forEach((fileName) => {
    const sourcePath = path.join(bundledWorkflowDir, fileName);
    const targetPath = path.join(runningHubWorkflowDir, fileName);
    if (!fs.statSync(sourcePath).isFile() || fs.existsSync(targetPath)) {
      return;
    }
    fs.copyFileSync(sourcePath, targetPath);
  });
}

function ensureRunningHubFiles() {
  if (!fs.existsSync(appDataRoot)) {
    fs.mkdirSync(appDataRoot, { recursive: true });
  }
  if (!fs.existsSync(runningHubWorkflowDir)) {
    fs.mkdirSync(runningHubWorkflowDir, { recursive: true });
  }
  copyBundledWorkflowsToUserDir();
  if (!fs.existsSync(runningHubConfigPath)) {
    const initialConfig = fs.existsSync(bundledConfigPath) && !isPackagedApp
      ? JSON.parse(fs.readFileSync(bundledConfigPath, "utf8"))
      : getDefaultAppSettings();
    fs.writeFileSync(
      runningHubConfigPath,
      JSON.stringify({ ...getDefaultAppSettings(), ...initialConfig }, null, 2),
      "utf8"
    );
  }
}

function getRunningHubConfig() {
  ensureRunningHubFiles();
  const defaults = getDefaultAppSettings();
  try {
    const parsed = JSON.parse(fs.readFileSync(runningHubConfigPath, "utf8"));
    return {
      ...defaults,
      ...parsed,
      apiKey: String(parsed.apiKey || defaults.apiKey),
      uploadUrl: String(parsed.uploadUrl || defaults.uploadUrl),
      createTaskUrl: String(parsed.createTaskUrl || defaults.createTaskUrl),
      taskStatusUrl: String(parsed.taskStatusUrl || defaults.taskStatusUrl),
      taskOutputsUrl: String(parsed.taskOutputsUrl || defaults.taskOutputsUrl),
      webhookDetailUrl: String(parsed.webhookDetailUrl || defaults.webhookDetailUrl),
      selectedWorkflowFile: String(parsed.selectedWorkflowFile || defaults.selectedWorkflowFile),
      captureShortcut: String(parsed.captureShortcut || defaults.captureShortcut),
      workflowShortcut: String(parsed.workflowShortcut || defaults.workflowShortcut),
      togglePinnedShortcut: String(
        parsed.togglePinnedShortcut || defaults.togglePinnedShortcut
      ),
      defaultClickThrough: Boolean(parsed.defaultClickThrough),
      autoCopyToClipboard:
        typeof parsed.autoCopyToClipboard === "boolean"
          ? parsed.autoCopyToClipboard
          : defaults.autoCopyToClipboard,
      launchAtStartup: Boolean(parsed.launchAtStartup),
      defaultSaveDirectory: String(
        parsed.defaultSaveDirectory || defaults.defaultSaveDirectory
      ),
    };
  } catch (_error) {
    return defaults;
  }
}

function saveRunningHubConfig(nextValues = {}) {
  const merged = {
    ...getRunningHubConfig(),
    ...nextValues,
  };
  fs.writeFileSync(runningHubConfigPath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function getWorkflowFiles() {
  ensureRunningHubFiles();
  return fs
    .readdirSync(runningHubWorkflowDir)
    .filter((name) => name.toLowerCase().endsWith(".json") && !name.toLowerCase().endsWith(".workflow.json"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sanitizeWorkflowFileBaseName(input) {
  const baseName = String(input || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return baseName || `workflow-${Date.now()}`;
}

function getWorkflowConfigPath(fileName) {
  const baseName = path.basename(String(fileName || ""), path.extname(String(fileName || "")));
  return path.join(runningHubWorkflowDir, `${baseName}.workflow.json`);
}

function readWorkflowConfig(fileName, workflowJson = null) {
  const defaults = getDefaultWorkflowConfig(fileName);
  const configPath = getWorkflowConfigPath(fileName);
  let parsed = {};

  try {
    if (fs.existsSync(configPath)) {
      parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (_error) {
    parsed = {};
  }

  const derived = workflowJson && typeof workflowJson === "object"
    ? {
        workflowId: String(workflowJson.workflowId || ""),
        imagePlaceholder: String(
          workflowJson.imagePlaceholder || defaults.imagePlaceholder
        ),
      }
    : {};

  return {
    ...defaults,
    ...derived,
    ...parsed,
    fileName: String(fileName || defaults.fileName),
    displayName: path.basename(String(fileName || defaults.fileName), path.extname(String(fileName || defaults.fileName))),
    workflowId: String(parsed.workflowId || derived.workflowId || defaults.workflowId),
    imageNodeId: String(parsed.imageNodeId || defaults.imageNodeId),
    imageFieldName: String(parsed.imageFieldName || defaults.imageFieldName),
    outputNodeId: String(parsed.outputNodeId || defaults.outputNodeId),
    imagePlaceholder: String(parsed.imagePlaceholder || derived.imagePlaceholder || defaults.imagePlaceholder),
  };
}

function saveWorkflowConfig(fileName, nextValues = {}) {
  const current = readWorkflowConfig(fileName);
  const merged = {
    ...current,
    ...nextValues,
    fileName: String(fileName || current.fileName),
    displayName: path.basename(String(fileName || current.fileName), path.extname(String(fileName || current.fileName))),
  };
  fs.writeFileSync(getWorkflowConfigPath(fileName), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function fileToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mimeType = mimeMap[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function getWorkflowThumbnailPath(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const candidates = [".png", ".jpg", ".jpeg", ".webp", ".gif"]
    .map((ext) => path.join(runningHubWorkflowDir, `${baseName}${ext}`));
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function getWorkflowTimingStats(fileName) {
  const config = readWorkflowConfig(fileName);
  const durations = Array.isArray(config.generationDurationsMs)
    ? config.generationDurationsMs.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0).slice(-10)
    : [];
  return {
    generationSampleCount: durations.length,
    estimatedGenerationDurationMs: durations[0] || 0,
  };
}

function getSelectedWorkflowTimingInfo() {
  const config = getRunningHubConfig();
  const workflowFile = config.selectedWorkflowFile;
  if (!workflowFile) {
    return { workflowName: "当前工作流", estimatedDurationMs: 180000 };
  }
  const workflow = readWorkflow(workflowFile);
  const timingStats = getWorkflowTimingStats(workflowFile);
  return {
    workflowName: workflow.name || path.basename(workflowFile, path.extname(workflowFile)),
    estimatedDurationMs: timingStats.estimatedGenerationDurationMs || 180000,
  };
}

function recordWorkflowGenerationDuration(fileName, durationMs) {
  const normalizedFileName = String(fileName || "").trim();
  const value = Math.round(Number(durationMs) || 0);
  if (!normalizedFileName || value <= 0) return;
  const current = readWorkflowConfig(normalizedFileName);
  const durations = Array.isArray(current.generationDurationsMs)
    ? current.generationDurationsMs.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
    : [];
  saveWorkflowConfig(normalizedFileName, {
    ...current,
    generationDurationsMs: [...durations, value].slice(-10),
  });
}

function buildWorkflowWebUrl(workflowId = "") {
  const id = String(workflowId || "").trim();
  return id ? `https://www.runninghub.cn/workflow/${encodeURIComponent(id)}` : "";
}

function getWorkflowSummaries() {
  const config = getRunningHubConfig();
  return getWorkflowFiles().map((fileName) => {
    const workflow = readWorkflow(fileName);
    const thumbnailPath = getWorkflowThumbnailPath(fileName);
    const timingStats = getWorkflowTimingStats(fileName);
    return {
      fileName,
      name: workflow.name,
      workflowId: workflow.workflowId,
      workflowUrl: buildWorkflowWebUrl(workflow.workflowId),
      imageNodeId: workflow.imageNodeId,
      imageFieldName: workflow.imageFieldName,
      outputNodeId: workflow.outputNodeId,
      selected: config.selectedWorkflowFile === fileName,
      thumbnailDataUrl: thumbnailPath ? fileToDataUrl(thumbnailPath) : "",
      ...timingStats,
    };
  });
}

function readWorkflow(fileName) {
  const fullPath = path.join(runningHubWorkflowDir, fileName);
  const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const workflowConfig = readWorkflowConfig(fileName, parsed);
  const requestTemplate =
    parsed.requestTemplate && typeof parsed.requestTemplate === "object"
      ? parsed.requestTemplate
      : {
          workflowId: workflowConfig.workflowId,
          nodeInfoList: [
            {
              nodeId: workflowConfig.imageNodeId,
              fieldName: workflowConfig.imageFieldName,
              fieldValue: workflowConfig.imagePlaceholder,
            },
          ],
        };

  return {
    fileName,
    name: path.basename(String(fileName || ""), path.extname(String(fileName || ""))),
    workflowId: String(workflowConfig.workflowId || parsed.workflowId || ""),
    imageNodeId: String(workflowConfig.imageNodeId || "36"),
    imageFieldName: String(workflowConfig.imageFieldName || "image"),
    outputNodeId: String(workflowConfig.outputNodeId || ""),
    imagePlaceholder: String(
      workflowConfig.imagePlaceholder || parsed.imagePlaceholder || WORKFLOW_IMAGE_PLACEHOLDER
    ),
    requestTemplate,
    rawConfig: workflowConfig,
    rawWorkflowJson: parsed,
  };
}

async function importWorkflowFromJson(metadata = {}) {
  ensureRunningHubFiles();

  let sourcePath = String(metadata.workflowJsonSourcePath || "").trim();
  if (!sourcePath) {
    const result = await dialog.showOpenDialog({
      title: "选择要导入的工作流 JSON",
      defaultPath: runningHubWorkflowDir,
      properties: ["openFile"],
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });

    if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
      return { ok: false, cancelled: true };
    }

    sourcePath = result.filePaths[0];
  }

  const rawContent = fs.readFileSync(sourcePath, "utf8");
  const parsed = JSON.parse(rawContent);
  const requestedBaseName = sanitizeWorkflowFileBaseName(
    metadata.fileBaseName || path.basename(sourcePath, path.extname(sourcePath))
  );

  let targetFileName = `${requestedBaseName}.json`;
  let targetPath = path.join(runningHubWorkflowDir, targetFileName);
  let suffix = 2;
  while (fs.existsSync(targetPath) && path.resolve(targetPath) !== path.resolve(sourcePath)) {
    targetFileName = `${requestedBaseName}-${suffix}.json`;
    targetPath = path.join(runningHubWorkflowDir, targetFileName);
    suffix += 1;
  }

  fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), "utf8");

  const workflowConfig = saveWorkflowConfig(targetFileName, {
    workflowId: String(metadata.workflowId || parsed.workflowId || ""),
    imageNodeId: String(metadata.imageNodeId || "36"),
    imageFieldName: String(metadata.imageFieldName || "image"),
    outputNodeId: String(metadata.outputNodeId || ""),
    imagePlaceholder: String(metadata.imagePlaceholder || WORKFLOW_IMAGE_PLACEHOLDER),
  });

  const finalWorkflow = readWorkflow(targetFileName);
  return {
    ok: true,
    fileName: targetFileName,
    workflow: finalWorkflow,
    config: workflowConfig,
  };
}

function replacePlaceholderDeep(input, placeholder, value) {
  if (typeof input === "string") {
    return input === placeholder ? value : input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => replacePlaceholderDeep(item, placeholder, value));
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [
        k,
        replacePlaceholderDeep(v, placeholder, value),
      ])
    );
  }
  return input;
}

function getRunningHubResultData(responseJson) {
  if (!responseJson || typeof responseJson !== "object") {
    throw new Error("RunningHub 返回数据格式异常");
  }
  if (responseJson.code && Number(responseJson.code) !== 0) {
    throw new Error(responseJson.msg || `RunningHub 错误码: ${responseJson.code}`);
  }
  if (responseJson.success === false) {
    throw new Error(responseJson.message || "RunningHub 调用失败");
  }
  return responseJson.data ?? responseJson.result ?? responseJson;
}

function collectStringCandidates(input, output = []) {
  if (typeof input === "string") {
    output.push(input);
    return output;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectStringCandidates(item, output));
    return output;
  }
  if (input && typeof input === "object") {
    Object.values(input).forEach((value) => collectStringCandidates(value, output));
  }
  return output;
}

function summarizeForLog(input, depth = 0) {
  if (depth >= 3) {
    if (Array.isArray(input)) return `[Array(${input.length})]`;
    if (input && typeof input === "object") return `[Object keys=${Object.keys(input).join(",")}]`;
    return input;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 5).map((item) => summarizeForLog(item, depth + 1));
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input)
        .slice(0, 20)
        .map(([key, value]) => [key, summarizeForLog(value, depth + 1)])
    );
  }
  if (typeof input === "string") {
    return input.length > 240 ? `${input.slice(0, 240)}...` : input;
  }
  return input;
}

function logRunningHubFailure(stage, details = {}) {
  try {
    logDebug(`runninghub failure @ ${stage}`, JSON.stringify(summarizeForLog(details)).slice(0, 4000));
  } catch (error) {
    logDebug(
      `runninghub failure @ ${stage} (serialize failed)`,
      error && error.message ? error.message : String(error)
    );
  }
}

function pickRunningHubImageRef(data) {
  if (!data) return "";
  if (typeof data === "string") return data;

  const directKeys = [
    "url",
    "fileUrl",
    "path",
    "filePath",
    "image",
    "imageUrl",
    "ossUrl",
    "src",
  ];
  for (const key of directKeys) {
    if (data && typeof data[key] === "string" && data[key].trim()) {
      return data[key];
    }
  }

  const candidates = collectStringCandidates(data).filter(Boolean);
  const preferred = candidates.find(
    (item) =>
      /^https?:\/\//i.test(item) ||
      item.startsWith("pasted/") ||
      item.startsWith("/pasted/") ||
      item.endsWith(".png") ||
      item.endsWith(".jpg") ||
      item.endsWith(".jpeg") ||
      item.endsWith(".webp")
  );
  return preferred || candidates[0] || "";
}

async function uploadImageToRunningHub(dataUrl, config) {
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, "base64");
  const formData = new FormData();
  formData.append("file", new Blob([imageBuffer], { type: "image/png" }), "snap.png");
  formData.append("apiKey", config.apiKey);

  const response = await fetch(config.uploadUrl, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
    },
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`上传失败: HTTP ${response.status}`);
  }
  const json = await response.json();
  logDebug("runninghub upload response", JSON.stringify(json).slice(0, 2000));
  const data = getRunningHubResultData(json);
  const imageRef = pickRunningHubImageRef(data);
  if (imageRef) return imageRef;
  throw new Error("上传成功但未返回图片地址");
}

async function createRunningHubTask(config, workflow, imageUrl) {
  const template =
    workflow.requestTemplate && Object.keys(workflow.requestTemplate).length
      ? workflow.requestTemplate
      : {
          workflowId: workflow.workflowId,
          nodeInfoList: [],
        };
  const body = replacePlaceholderDeep(
    template,
    workflow.imagePlaceholder,
    imageUrl
  );
  if (!body.workflowId && workflow.workflowId) {
    body.workflowId = workflow.workflowId;
  }
  body.apiKey = config.apiKey;
  logDebug(
    "runninghub create request",
    JSON.stringify(
      summarizeForLog({
        workflowName: workflow.name,
        workflowId: body.workflowId,
        imageNodeId: workflow.imageNodeId,
        imageFieldName: workflow.imageFieldName,
        outputNodeId: workflow.outputNodeId,
        body,
      })
    ).slice(0, 4000)
  );

  const response = await fetch(config.createTaskUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    logRunningHubFailure("createTask.http", {
      workflowName: workflow.name,
      workflowId: body.workflowId,
      status: response.status,
      body,
    });
    throw new Error(`创建任务失败: HTTP ${response.status}`);
  }
  const json = await response.json();
  logDebug("runninghub create response", JSON.stringify(json).slice(0, 2000));
  return getRunningHubResultData(json);
}

function pickTaskId(input) {
  if (!input) return "";
  if (typeof input === "string") {
    return /^\d{10,}$/.test(input) ? input : "";
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const id = pickTaskId(item);
      if (id) return id;
    }
    return "";
  }
  if (typeof input === "object") {
    const direct =
      input.taskId ||
      input.id ||
      input.taskID ||
      input.jobId ||
      input.requestId ||
      "";
    if (typeof direct === "string" && direct.trim()) return direct;
    for (const value of Object.values(input)) {
      const id = pickTaskId(value);
      if (id) return id;
    }
  }
  return "";
}

function looksLikeImageRef(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith("pasted/") ||
    trimmed.startsWith("/pasted/") ||
    /^(\.\/|\.\.\/|\/).+\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(trimmed)
  );
}

function extractRunningHubTargetBaseUrl(wsUrl = "") {
  try {
    const parsed = new URL(String(wsUrl || ""));
    const target = parsed.searchParams.get("target") || "";
    return /^https?:\/\//i.test(target) ? target.replace(/\/+$/, "") : "";
  } catch (_error) {
    return "";
  }
}

function buildComfyViewImageUrl(imageInfo, baseUrl = "") {
  if (!imageInfo || typeof imageInfo !== "object") return "";
  const filename = String(imageInfo.filename || imageInfo.fileName || "").trim();
  if (!filename || !/\.(png|jpg|jpeg|webp|gif)$/i.test(filename)) return "";
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) return filename;
  const subfolder = String(imageInfo.subfolder || "").trim();
  const type = String(imageInfo.type || imageInfo.fileType || "output").trim() || "output";
  const params = new URLSearchParams({ filename, type });
  if (subfolder) params.set("subfolder", subfolder);
  return `${normalizedBaseUrl}/view?${params.toString()}`;
}

function summarizeRunningHubWsMessage(parsed, imageUrl = "") {
  if (!parsed || typeof parsed !== "object") return { messageType: typeof parsed, imageUrl };
  const data = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const output = data.output && typeof data.output === "object" ? data.output : null;
  return {
    type: parsed.type || data.type || "",
    node: data.node || data.display_node || data.node_id || data.nodeId || "",
    nodeType: data.node_type || data.nodeType || "",
    outputKeys: output ? Object.keys(output) : [],
    imageCount: output && Array.isArray(output.images) ? output.images.length : 0,
    firstImage: output && Array.isArray(output.images) ? summarizeForLog(output.images[0]) : "",
    imageUrl,
  };
}

function getResultNodeId(data) {
  if (!data || typeof data !== "object") return "";
  return String(
    data.node ||
      data.display_node ||
      data.nodeId ||
      data.node_id ||
      data.id ||
      data.outputNodeId ||
      ""
  ).trim().replace(/^#/, "");
}

function pickResultImageUrl(data, preferredNodeId = "", options = {}) {
  if (!data) return "";
  const normalizedNodeId = String(preferredNodeId || "").trim().replace(/^#/, "");
  const strictNodeMatch = options.strictNodeMatch === true;
  const baseUrl = String(options.baseUrl || "").trim();
  if (normalizedNodeId && typeof data === "object") {
    const currentNodeId = getResultNodeId(data);
    if (currentNodeId === normalizedNodeId) {
      const nodePayload =
        data.output || data.outputs || data.result || data.results || data.data || data;
      const preferredUrl = pickResultImageUrl(nodePayload, "", options);
      if (preferredUrl) {
        return preferredUrl;
      }
    }
    if (strictNodeMatch && currentNodeId && currentNodeId !== normalizedNodeId) {
      return "";
    }
    const preferredNodeData =
      (data && typeof data === "object" && data[normalizedNodeId]) ||
      (data && typeof data === "object" && data.outputs && data.outputs[normalizedNodeId]) ||
      (data && typeof data === "object" && data.output && data.output[normalizedNodeId]) ||
      (data && typeof data === "object" && data.results && data.results[normalizedNodeId]) ||
      null;
    if (preferredNodeData) {
      const preferredUrl = pickResultImageUrl(preferredNodeData, "", options);
      if (preferredUrl) {
        return preferredUrl;
      }
    }
    if (Array.isArray(data.nodeInfoList)) {
      const matchedNode = data.nodeInfoList.find((item) => {
        if (!item || typeof item !== "object") return false;
        const nodeId = String(item.nodeId || item.id || item.node_id || "").trim().replace(/^#/, "");
        return nodeId === normalizedNodeId;
      });
      if (matchedNode) {
        const preferredUrl = pickResultImageUrl(matchedNode, "", options);
        if (preferredUrl) {
          return preferredUrl;
        }
      }
    }
  }
  if (typeof data === "string") {
    return looksLikeImageRef(data) ? data.trim() : "";
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const url = pickResultImageUrl(item, normalizedNodeId, options);
      if (url) return url;
    }
    return "";
  }
  if (typeof data === "object") {
    const directKeys = [
      "cos_url",
      "url",
      "fileUrl",
      "imageUrl",
      "image",
      "src",
      "ossUrl",
      "finalUrl",
      "outputUrl",
      "resultUrl",
    ];
    for (const key of directKeys) {
      if (typeof data[key] === "string" && looksLikeImageRef(data[key])) {
        return data[key].trim();
      }
    }
    const comfyImageUrl = buildComfyViewImageUrl(data, baseUrl);
    if (comfyImageUrl) {
      return comfyImageUrl;
    }
    const arrayKeys = ["results", "images", "outputs", "output", "fileList", "data"];
    for (const key of arrayKeys) {
      if (key in data) {
        const url = pickResultImageUrl(data[key], normalizedNodeId, options);
        if (url) return url;
      }
    }
    for (const value of Object.values(data)) {
      const url = pickResultImageUrl(value, normalizedNodeId, options);
      if (url) return url;
    }
  }
  return "";
}

function pickRunningHubExecutionError(data) {
  if (!data) return null;
  if (typeof data === "string") {
    return /error|exception|failed/i.test(data)
      ? { message: data.trim() }
      : null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const error = pickRunningHubExecutionError(item);
      if (error) return error;
    }
    return null;
  }
  if (typeof data === "object") {
    const payload = data.data && typeof data.data === "object" ? data.data : data;
    const message =
      payload.exception_message ||
      payload.errorMessage ||
      payload.failedReason ||
      payload.msg ||
      payload.message ||
      "";
    const nodeId = payload.node_id || payload.nodeId || payload.failedNodeId || "";
    const nodeType = payload.node_type || payload.nodeType || payload.failedNodeType || "";
    const errorType = payload.exception_type || payload.errorType || "";
    const hasSignal =
      data.type === "execution_error" ||
      payload.type === "execution_error" ||
      Boolean(message && (nodeId || errorType || /error|exception|failed/i.test(message)));
    if (hasSignal && message) {
      return {
        nodeId: String(nodeId || ""),
        nodeType: String(nodeType || ""),
        errorType: String(errorType || ""),
        message: String(message || ""),
      };
    }
    for (const value of Object.values(data)) {
      const error = pickRunningHubExecutionError(value);
      if (error) return error;
    }
  }
  return null;
}

function formatRunningHubExecutionError(error) {
  if (!error || !error.message) return "";
  const parts = [];
  if (error.nodeId) parts.push(`节点 ${error.nodeId}`);
  if (error.nodeType) parts.push(error.nodeType);
  if (error.errorType) parts.push(error.errorType);
  const prefix = parts.length ? `${parts.join(" / ")}：` : "";
  return `${prefix}${error.message}`;
}

function pickRunningHubWebSocketUrl(input) {
  if (!input) return "";
  if (typeof input === "string") {
    return /^wss?:\/\//i.test(input.trim()) ? input.trim() : "";
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const url = pickRunningHubWebSocketUrl(item);
      if (url) return url;
    }
    return "";
  }
  if (typeof input === "object") {
    const directKeys = ["netWssUrl", "wssUrl", "wsUrl", "websocketUrl", "socketUrl"];
    for (const key of directKeys) {
      if (typeof input[key] === "string" && /^wss?:\/\//i.test(input[key].trim())) {
        return input[key].trim();
      }
    }
    for (const value of Object.values(input)) {
      const url = pickRunningHubWebSocketUrl(value);
      if (url) return url;
    }
  }
  return "";
}

async function readWebSocketMessageData(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }
  return String(data || "");
}

function createRunningHubWebSocketWatcher(wsUrl, taskId, onProgress, outputNodeId = "") {
  let socket = null;
  let latestImageUrl = "";
  let latestExecutionError = null;
  let settled = false;
  let timeoutId = null;
  const baseUrl = extractRunningHubTargetBaseUrl(wsUrl);

  new Promise((resolve) => {
    if (!wsUrl || typeof WebSocket !== "function") {
      resolve("");
      return;
    }

    const finish = (value = "") => {
      if (settled) return;
      settled = true;
      latestImageUrl = value || latestImageUrl;
      if (timeoutId) clearTimeout(timeoutId);
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      } catch (_error) {
        // Ignore websocket close errors.
      }
      resolve(latestImageUrl || "");
    };

    try {
      socket = new WebSocket(wsUrl);
      logDebug("runninghub websocket connect", wsUrl);
    } catch (error) {
      logDebug(
        "runninghub websocket connect failed",
        error && error.message ? error.message : String(error)
      );
      resolve("");
      return;
    }

    timeoutId = setTimeout(() => finish(""), 180000);

    socket.addEventListener("open", () => {
      if (onProgress) {
        onProgress(`已连接任务结果通道（taskId=${taskId}）`);
      }
    });

    socket.addEventListener("message", async (event) => {
      try {
        const text = await readWebSocketMessageData(event.data);
        logDebug("runninghub websocket message", text.slice(0, 2000));
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (_error) {
          parsed = text;
        }
        const imageUrl = pickResultImageUrl(parsed, outputNodeId, { baseUrl });
        const executionError = pickRunningHubExecutionError(parsed);
        logDebug(
          "runninghub websocket parsed",
          JSON.stringify(summarizeRunningHubWsMessage(parsed, imageUrl)).slice(0, 2000)
        );
        if (executionError) {
          latestExecutionError = executionError;
          logRunningHubFailure("websocket.execution_error", {
            taskId,
            outputNodeId,
            executionError,
            payload: parsed,
          });
        }
        if (imageUrl) {
          latestImageUrl = imageUrl;
          finish(imageUrl);
        }
      } catch (error) {
        logDebug(
          "runninghub websocket message parse failed",
          error && error.message ? error.message : String(error)
        );
      }
    });

    socket.addEventListener("error", (event) => {
      logDebug("runninghub websocket error", JSON.stringify(event).slice(0, 500));
    });

    socket.addEventListener("close", () => {
      finish(latestImageUrl);
    });
  });

  return {
    getImageUrl() {
      return latestImageUrl;
    },
    getExecutionError() {
      return latestExecutionError;
    },
    async waitForImage(timeoutMs = 8000) {
      const immediate = latestImageUrl;
      if (immediate) return immediate;
      return new Promise((resolve) =>
        setTimeout(() => resolve(latestImageUrl || ""), timeoutMs)
      );
    },
    stop() {
      if (timeoutId) clearTimeout(timeoutId);
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      } catch (_error) {
        // Ignore websocket close errors.
      }
    },
  };
}

async function queryRunningHubTaskStatus(config, taskId) {
  const response = await fetch(config.taskStatusUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      apiKey: config.apiKey,
      taskId,
    }),
  });
  if (!response.ok) {
    throw new Error(`查询任务状态失败: HTTP ${response.status}`);
  }
  const json = await response.json();
  logDebug("runninghub status response", JSON.stringify(json).slice(0, 2000));
  return getRunningHubResultData(json);
}

async function queryRunningHubTaskOutputs(config, taskId) {
  const outputsUrl = String(config.taskOutputsUrl || "https://www.runninghub.ai/task/openapi/outputs");
  const response = await fetch(outputsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      apiKey: config.apiKey,
      taskId,
    }),
  });
  if (!response.ok) {
    throw new Error(`查询任务输出失败: HTTP ${response.status}`);
  }
  const json = await response.json();
  logDebug("runninghub outputs response", JSON.stringify(json).slice(0, 4000));
  return getRunningHubResultData(json);
}

async function queryRunningHubWebhookDetail(config, taskId) {
  const response = await fetch(config.webhookDetailUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      apiKey: config.apiKey,
      taskId,
    }),
  });
  if (!response.ok) {
    throw new Error(`查询 webhook 详情失败: HTTP ${response.status}`);
  }
  const json = await response.json();
  logDebug("runninghub webhook detail response", JSON.stringify(json).slice(0, 2000));
  return getRunningHubResultData(json);
}

async function waitRunningHubTaskResult(config, taskId, onProgress, options = {}, workflow = null) {
  const maxTries = 120;
  const wsWatcher =
    options.wsUrl && typeof options.wsUrl === "string"
      ? createRunningHubWebSocketWatcher(
          options.wsUrl,
          taskId,
          onProgress,
          workflow && workflow.outputNodeId
        )
      : null;

  try {
    for (let i = 0; i < maxTries; i += 1) {
      const data = await queryRunningHubTaskStatus(config, taskId);
      const status = String(
        typeof data === "string"
          ? data
          : (data && (data.status || data.taskStatus || data.state)) || ""
      ).toUpperCase();
      const imageUrl =
        pickResultImageUrl(data, workflow && workflow.outputNodeId) ||
        (wsWatcher ? wsWatcher.getImageUrl() : "");
      const executionError =
        pickRunningHubExecutionError(data) ||
        (wsWatcher ? wsWatcher.getExecutionError() : null);
      if (onProgress) {
        const seconds = Math.round(((i + 1) * 2500) / 1000);
        onProgress(`任务 ${taskId} 状态: ${status || "UNKNOWN"}（已等待 ${seconds}s）`);
      }
      if (status === "FAILED") {
        const detailedError = formatRunningHubExecutionError(executionError);
        const errMsg =
          detailedError ||
          (typeof data === "object" &&
            data &&
            (data.errorMessage || data.failedReason || data.msg)) ||
          "任务执行失败";
        logRunningHubFailure("taskStatus.failed", {
          taskId,
          workflowName: workflow && workflow.name,
          workflowId: workflow && workflow.workflowId,
          imageNodeId: workflow && workflow.imageNodeId,
          imageFieldName: workflow && workflow.imageFieldName,
          outputNodeId: workflow && workflow.outputNodeId,
          status,
          executionError,
          statusData: data,
        });
        throw new Error(String(errMsg));
      }
      if (status === "SUCCESS" && imageUrl) {
        return imageUrl;
      }
      if (status === "SUCCESS" && !imageUrl) {
        const successWaitRounds = 24;
        for (let round = 0; round < successWaitRounds; round += 1) {
          if (wsWatcher) {
            if (onProgress) {
              onProgress(`状态已成功，正在等待任务结果通道返回图片...（${round + 1}/${successWaitRounds}）`);
            }
            const wsImageUrl = await wsWatcher.waitForImage(2500);
            if (wsImageUrl) {
              return wsImageUrl;
            }
          }
          if (onProgress) {
            onProgress(`状态接口未返回结果图，正在查询任务输出...（${round + 1}/${successWaitRounds}）`);
          }
          try {
            const outputsData = await queryRunningHubTaskOutputs(config, taskId);
            const outputsExecutionError = pickRunningHubExecutionError(outputsData);
            const outputsImageUrl = pickResultImageUrl(
              outputsData,
              workflow && workflow.outputNodeId,
              { baseUrl: extractRunningHubTargetBaseUrl(options.wsUrl || "") }
            );
            if (outputsExecutionError) {
              logRunningHubFailure("outputs.execution_error", {
                taskId,
                workflowName: workflow && workflow.name,
                executionError: outputsExecutionError,
                outputsData,
              });
              throw new Error(formatRunningHubExecutionError(outputsExecutionError));
            }
            if (outputsImageUrl) {
              return outputsImageUrl;
            }
            logDebug(
              "runninghub outputs no image",
              JSON.stringify(outputsData).slice(0, 2000)
            );
          } catch (error) {
            logDebug(
              "runninghub outputs failed",
              error && error.message ? error.message : String(error)
            );
          }
          try {
            const webhookData = await queryRunningHubWebhookDetail(config, taskId);
            const webhookExecutionError = pickRunningHubExecutionError(webhookData);
            const webhookImageUrl = pickResultImageUrl(
              webhookData,
              workflow && workflow.outputNodeId,
              { baseUrl: extractRunningHubTargetBaseUrl(options.wsUrl || "") }
            );
            if (webhookExecutionError) {
              logRunningHubFailure("webhook.execution_error", {
                taskId,
                workflowName: workflow && workflow.name,
                executionError: webhookExecutionError,
                webhookData,
              });
              throw new Error(formatRunningHubExecutionError(webhookExecutionError));
            }
            if (webhookImageUrl) {
              return webhookImageUrl;
            }
            logDebug(
              "runninghub webhook detail no image",
              JSON.stringify(webhookData).slice(0, 2000)
            );
          } catch (error) {
            logDebug(
              "runninghub webhook detail failed",
              error && error.message ? error.message : String(error)
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
        logRunningHubFailure("taskStatus.success_without_image", {
          taskId,
          workflowName: workflow && workflow.name,
          workflowId: workflow && workflow.workflowId,
          imageNodeId: workflow && workflow.imageNodeId,
          imageFieldName: workflow && workflow.imageFieldName,
          outputNodeId: workflow && workflow.outputNodeId,
          wsUrl: options.wsUrl || "",
          statusData: data,
        });
        throw new Error("任务已成功，但未获取到结果图链接");
      }
      if (!status && executionError) {
        const detailedError = formatRunningHubExecutionError(executionError) || "任务执行失败";
        logRunningHubFailure("taskStatus.execution_error_without_status", {
          taskId,
          workflowName: workflow && workflow.name,
          executionError,
          statusData: data,
        });
        throw new Error(detailedError);
      }
      if (!status && imageUrl) {
        return imageUrl;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error("任务超时：长时间未拿到生图结果");
  } finally {
    if (wsWatcher) {
      wsWatcher.stop();
    }
  }
}

async function imageUrlToDataUrl(imageUrl) {
  logDebug("runninghub download image ref", String(imageUrl || "").slice(0, 1000));
  if (!looksLikeImageRef(imageUrl)) {
    logRunningHubFailure("download.invalid_image_ref", { imageUrl });
    throw new Error(`返回的结果不是可下载图片地址: ${imageUrl}`);
  }
  const response = await fetch(imageUrl);
  if (!response.ok) {
    logRunningHubFailure("download.http", { imageUrl, status: response.status });
    throw new Error(`下载结果图片失败: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "image/png";
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

async function runRunningHubGeneration(dataUrl, onProgress) {
  const config = getRunningHubConfig();
  if (!config.apiKey) {
    throw new Error("请先在 runninghub.config.json 中填写 apiKey");
  }
  const workflowFile = config.selectedWorkflowFile;
  if (!workflowFile) {
    throw new Error("请先在右键菜单中选择一个工作流");
  }
  const workflow = readWorkflow(workflowFile);
  const startedAt = Date.now();
  let taskId = "";
  try {
    if (onProgress) onProgress(`开始上传截图（工作流：${workflow.name}）...`);
    const imageUrl = await uploadImageToRunningHub(dataUrl, config);
    if (onProgress) onProgress("上传成功，开始创建任务...");
    const taskResult = await createRunningHubTask(config, workflow, imageUrl);
    taskId = pickTaskId(taskResult);
    const wsUrl = pickRunningHubWebSocketUrl(taskResult);
    if (!taskId) {
      logRunningHubFailure("createTask.no_task_id", {
        workflowName: workflow.name,
        workflowId: workflow.workflowId,
        imageNodeId: workflow.imageNodeId,
        imageFieldName: workflow.imageFieldName,
        outputNodeId: workflow.outputNodeId,
        taskResult,
      });
      throw new Error(`已创建任务但未拿到 taskId: ${JSON.stringify(taskResult)}`);
    }
    logDebug(
      "runninghub create parsed",
      JSON.stringify({ taskId, wsUrl, taskStatus: taskResult && taskResult.taskStatus }).slice(0, 2000)
    );
    if (onProgress) onProgress(`任务已创建，taskId=${taskId}`);
    const resultImageUrl = await waitRunningHubTaskResult(config, taskId, onProgress, {
      wsUrl,
    }, workflow);
    if (onProgress) onProgress("已拿到结果图链接，正在下载结果...");
    const resultImageDataUrl = await imageUrlToDataUrl(resultImageUrl);
    if (onProgress) onProgress("结果已下载，正在替换贴图...");
    const durationMs = Date.now() - startedAt;
    recordWorkflowGenerationDuration(workflowFile, durationMs);
    sendWorkflowSelectionData();
    return { workflowName: workflow.name, imageUrl, taskResult, taskId, resultImageDataUrl, durationMs };
  } catch (error) {
    logRunningHubFailure("runGeneration.catch", {
      workflowFile,
      workflowName: workflow.name,
      workflowId: workflow.workflowId,
      imageNodeId: workflow.imageNodeId,
      imageFieldName: workflow.imageFieldName,
      outputNodeId: workflow.outputNodeId,
      taskId,
      error: error && error.message ? error.message : String(error),
    });
    if (error && typeof error === "object") {
      error.runningHubContext = {
        workflowName: workflow.name,
        workflowFile,
        workflowId: workflow.workflowId,
        taskId,
      };
    }
    throw error;
  }
}

function formatUserFacingRunningHubError(error, context = {}) {
  const rawMessage = error && error.message ? String(error.message) : String(error || "未知错误");
  const lower = rawMessage.toLowerCase();
  const workflowName = context.workflowName || "工作流";
  let title = `${workflowName} · 运行失败`;
  let reason = rawMessage;

  if (/concurrent|concurrency|parallel|simultaneous|同时|并发|会员|super|limit|限制|too many/i.test(rawMessage)) {
    title = "云端并行任务受限";
    reason = "RunningHub 云端可能限制了同时运行多个任务。请等待当前任务完成，或确认账号是否支持并行/超级会员能力。";
    if (!/同时|并发|会员|限制/.test(rawMessage)) reason += `\n原始信息：${rawMessage}`;
  } else if (/api[_ -]?key|apikey|401|403|unauthorized|forbidden/i.test(rawMessage)) {
    title = "API 配置错误";
    reason = "API Key 无效、未填写，或没有权限访问 RunningHub。请检查设置里的 API Key。";
  } else if (/fetch failed|network|econn|enotfound|etimedout|timeout|timed out|networkerror/i.test(lower)) {
    title = "网络连接错误";
    reason = "本地网络无法连接到 RunningHub，可能是网络断开、代理异常或服务暂时不可达。";
  } else if (/上传失败|upload|上传成功但未返回|图片地址/i.test(rawMessage)) {
    title = "图片上传失败";
    reason = rawMessage;
  } else if (/创建任务失败|create|taskid|未拿到 taskid/i.test(lower)) {
    title = "云端创建任务失败";
    reason = "RunningHub 没有成功创建生图任务。请检查工作流 ID、输入节点配置和 API 权限。";
    if (!/http/i.test(rawMessage)) reason += `\n原始信息：${rawMessage}`;
  } else if (/任务执行失败|execution|failed|节点|exception/i.test(rawMessage)) {
    title = "云端工作流执行失败";
    reason = rawMessage;
  } else if (/超时|timeout|长时间/i.test(rawMessage)) {
    title = "云端处理超时";
    reason = "任务等待时间过长，可能是 RunningHub 排队、工作流执行太慢，或结果接口没有返回图片。";
  } else if (/下载结果图片失败|download|结果不是可下载图片|未获取到结果图|未拿到生图结果|未获取到结果/i.test(rawMessage)) {
    title = "结果图片获取失败";
    reason = rawMessage;
  } else if (/工作流|workflow|json|node|节点|配置/i.test(rawMessage)) {
    title = "本地工作流配置错误";
    reason = rawMessage;
  }

  const details = [];
  if (context.taskId) details.push(`任务 ID：${context.taskId}`);
  if (context.workflowName) details.push(`工作流：${context.workflowName}`);
  return {
    title,
    message: details.length ? `${reason}\n${details.join("\n")}` : reason,
    rawMessage,
  };
}

function sendPinStatus(message, targetEntries = []) {
  const entries = Array.isArray(targetEntries) && targetEntries.length
    ? targetEntries.filter((entry) => entry && entry.window && !entry.window.isDestroyed())
    : getPinnedWindowEntries();
  entries.forEach((entry) => {
    entry.window.webContents.send("runninghub-status", message);
  });
}

function sendPinProgress(payload = {}, targetEntries = []) {
  const entries = Array.isArray(targetEntries) && targetEntries.length
    ? targetEntries.filter((entry) => entry && entry.window && !entry.window.isDestroyed())
    : getPinnedWindowEntries();
  entries.forEach((entry) => {
    entry.window.webContents.send("runninghub-progress", payload && typeof payload === "object" ? payload : {});
  });
}

function getWorkflowInputContext() {
  const selectedEntries = getSelectedPinnedWindowEntries();
  const entry = selectedEntries[0] || null;
  return {
    hasSelectedPin: Boolean(entry && entry.dataUrl),
    selectedPinCount: selectedEntries.length,
    imageDataUrl: entry && entry.dataUrl ? entry.dataUrl : "",
  };
}

function sendWorkflowSelectionData() {
  if (workflowWindow && !workflowWindow.isDestroyed()) {
    workflowWindow.webContents.send("workflow-selection-data", getWorkflowSummaries());
  }
}

function sendWorkflowEditRequest(fileName) {
  if (workflowWindow && !workflowWindow.isDestroyed() && fileName) {
    workflowWindow.webContents.send("workflow-edit-request", String(fileName));
  }
}

function setSelectedWorkflow(fileName) {
  saveRunningHubConfig({ selectedWorkflowFile: fileName });
  sendWorkflowSelectionData();
  sendSettingsData();
}

function showWorkflowWindow(options = {}) {
  if (workflowWindow && !workflowWindow.isDestroyed()) {
    workflowWindow.show();
    workflowWindow.focus();
    sendWorkflowSelectionData();
    if (options.editFileName) {
      sendWorkflowEditRequest(options.editFileName);
    }
    return;
  }

  const parentEntry = getPrimaryPinnedWindowEntry();
  const parentWindow = parentEntry ? parentEntry.window : undefined;

  workflowWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    alwaysOnTop: false,
    resizable: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    parent: parentWindow,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  workflowWindow.setMenuBarVisibility(false);
  workflowWindow.loadFile(path.join(__dirname, "workflow-selector.html"));
  workflowWindow.webContents.on("console-message", (_e, _level, msg) => {
    logDebug("workflow selector console", msg);
  });
  workflowWindow.webContents.once("did-finish-load", () => {
    sendWorkflowSelectionData();
    sendWorkflowInputContext();
    if (options.editFileName) {
      sendWorkflowEditRequest(options.editFileName);
    }
  });
  workflowWindow.on("closed", () => {
    workflowWindow = null;
  });
}

function sendSettingsData() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("settings-data", getRunningHubConfig());
  }
}

function normalizeShortcut(value, fallback) {
  const input = String(value || "").trim();
  return input || fallback;
}

function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();
  const config = getRunningHubConfig();
  const captureShortcut = normalizeShortcut(
    config.captureShortcut,
    getDefaultAppSettings().captureShortcut
  );
  const workflowShortcut = normalizeShortcut(
    config.workflowShortcut,
    getDefaultAppSettings().workflowShortcut
  );
  const togglePinnedShortcut = normalizeShortcut(
    config.togglePinnedShortcut,
    getDefaultAppSettings().togglePinnedShortcut
  );

  const captureRegistered = globalShortcut.register(captureShortcut, () => {
    startCapture();
  });
  const workflowRegistered = globalShortcut.register(workflowShortcut, () => {
    showWorkflowWindow();
  });
  const toggleRegistered = globalShortcut.register(togglePinnedShortcut, () => {
    togglePinnedImagesVisibility();
  });

  logDebug(
    "global shortcuts registered",
    JSON.stringify({
      captureShortcut,
      captureRegistered,
      workflowShortcut,
      workflowRegistered,
      togglePinnedShortcut,
      toggleRegistered,
    })
  );

  return {
    captureShortcut,
    captureRegistered,
    workflowShortcut,
    workflowRegistered,
    togglePinnedShortcut,
    toggleRegistered,
  };
}

function togglePinnedImagesVisibility(forceVisible) {
  const entries = getPinnedWindowEntries();
  if (!entries.length) {
    return false;
  }
  const nextHidden =
    typeof forceVisible === "boolean" ? !forceVisible : !pinnedWindowsHidden;
  pinnedWindowsHidden = nextHidden;
  if (pinnedWindowsHidden) {
    entries.forEach((entry) => entry.window.hide());
    if (workflowWindow && !workflowWindow.isDestroyed()) {
      workflowWindow.hide();
    }
  } else {
    entries.forEach((entry) => entry.window.show());
    if (workflowWindow && !workflowWindow.isDestroyed()) {
      workflowWindow.show();
    }
  }
  refreshTrayMenu();
  return true;
}

function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    sendSettingsData();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.webContents.on("console-message", (_e, _level, msg) => {
    logDebug("settings console", msg);
  });
  settingsWindow.webContents.once("did-finish-load", () => {
    sendSettingsData();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

async function runRunningHubForEntries(targetEntries = []) {
  const entries = Array.isArray(targetEntries)
    ? targetEntries.filter((entry) => entry && entry.dataUrl)
    : [];
  if (!entries.length) return;
  const timingInfo = getSelectedWorkflowTimingInfo();
  runningHubActiveCount += 1;
  sendPinProgress({
    state: "running",
    workflowName: timingInfo.workflowName,
    estimatedDurationMs: timingInfo.estimatedDurationMs,
    startedAt: Date.now(),
  }, entries);
  try {
    const workflowNames = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entries.length > 1) {
        sendPinProgress({
          state: "running",
          workflowName: timingInfo.workflowName,
          estimatedDurationMs: timingInfo.estimatedDurationMs,
          startedAt: Date.now(),
          prefix: `第 ${index + 1}/${entries.length} 张`,
        }, [entry]);
      }
      const result = await runRunningHubGeneration(entry.dataUrl);
      appendImageToPinEntry(entry, result.resultImageDataUrl);
      workflowNames.push(result.workflowName);
    }
    sendPinProgress({
      state: "done",
      workflowName: workflowNames.join("、") || timingInfo.workflowName,
    }, entries);
  } catch (error) {
    const userError = formatUserFacingRunningHubError(error, {
      ...((error && error.runningHubContext) || {}),
      workflowName: (error && error.runningHubContext && error.runningHubContext.workflowName) || timingInfo.workflowName,
    });
    sendPinProgress({
      state: "error",
      workflowName: timingInfo.workflowName,
      title: userError.title,
      message: userError.message,
      rawMessage: userError.rawMessage,
    }, entries);
  } finally {
    runningHubActiveCount = Math.max(0, runningHubActiveCount - 1);
  }
}

function buildPinContextMenu(pinEntry) {
  const currentConfig = getRunningHubConfig();
  const currentWorkflowFile = currentConfig.selectedWorkflowFile;
  const selectedEntries = getSelectedPinnedWindowEntries();
  const targetEntries =
    selectedEntries.length && pinEntry && selectedPinnedImageIds.has(pinEntry.id)
      ? selectedEntries
      : pinEntry
        ? [pinEntry]
        : [];
  const targetCount = targetEntries.length;

  return Menu.buildFromTemplate([
    {
      label: runningHubActiveCount > 0
        ? "RunningHub 正在处理..."
        : `上传到 RunningHub 生图${targetCount > 1 ? `（${targetCount} 张）` : ""}`,
      enabled:
        targetEntries.length > 0 &&
        targetEntries.every((entry) => Boolean(entry.dataUrl)),
      click: async () => {
        runRunningHubForEntries(targetEntries);
      },
    },
    {
      label: "打开工作流选择器",
      enabled: !runningHubUploading,
      click: () => showWorkflowWindow(),
    },
    {
      label: "编辑当前工作流配置",
      enabled: Boolean(currentWorkflowFile),
      click: () => showWorkflowWindow({ editFileName: currentWorkflowFile }),
    },
    { type: "separator" },
    {
      label: "打开设置",
      click: () => showSettingsWindow(),
    },
    {
      label: "打开工作流目录",
      click: () => shell.openPath(runningHubWorkflowDir),
    },
  ]);
}

async function captureScreenImageDataUrl(payload = {}) {
  const displayId = Number(payload.displayId);
  const width = Number.isFinite(payload.width) ? payload.width : 1920;
  const height = Number.isFinite(payload.height) ? payload.height : 1080;
  logDebug("get-screen-image-data-url", `${displayId || "auto"}:${width}x${height}`);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });

  if (!sources.length) {
    throw new Error("未获取到可用屏幕源");
  }

  const matchedSource = Number.isFinite(displayId)
    ? sources.find((item) => String(item.display_id || "") === String(displayId))
    : null;
  const sourceWithImage =
    matchedSource || sources.find((item) => !item.thumbnail.isEmpty()) || sources[0];
  const dataUrl = sourceWithImage.thumbnail.toDataURL();

  if (!dataUrl || dataUrl === "data:image/png;base64,") {
    throw new Error("屏幕截图数据为空");
  }

  return dataUrl;
}

function startCapture() {
  logDebug("startCapture called");
  if (captureWindow) {
    logDebug("captureWindow already exists, focusing");
    captureWindow.focus();
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const displayBounds = targetDisplay && targetDisplay.bounds
    ? targetDisplay.bounds
    : screen.getPrimaryDisplay().bounds;
  const scaleFactor = targetDisplay && targetDisplay.scaleFactor ? targetDisplay.scaleFactor : 1;
  const displayInfo = {
    id: targetDisplay && targetDisplay.id,
    scaleFactor,
    bounds: displayBounds,
    workArea: targetDisplay && targetDisplay.workArea,
  };

  captureWindow = new BrowserWindow({
    x: Math.round(displayBounds.x),
    y: Math.round(displayBounds.y),
    width: Math.max(1, Math.round(displayBounds.width)),
    height: Math.max(1, Math.round(displayBounds.height)),
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  captureWindow.setAlwaysOnTop(true, "screen-saver");
  captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  captureWindow.setBounds(displayBounds);

  const pageReady = new Promise((resolve) => {
    captureWindow.webContents.once("did-finish-load", resolve);
  });
  const captureScale = Math.min(scaleFactor, 1.5);
  const imageReady = captureScreenImageDataUrl({
    displayId: displayInfo.id,
    width: Math.floor(displayBounds.width * captureScale),
    height: Math.floor(displayBounds.height * captureScale),
  });

  captureWindow.loadFile(path.join(__dirname, "capture.html"));
  captureWindow.webContents.on("console-message", (_e, _level, msg) => {
    logDebug("capture console", msg);
  });
  captureWindow.on("closed", () => {
    logDebug("captureWindow closed");
    captureWindow = null;
    pendingCapturePayload = null;
  });

  Promise.all([pageReady, imageReady])
    .then(([, fullImage]) => {
      if (!captureWindow || captureWindow.isDestroyed()) return;
      pendingCapturePayload = { fullImage, displayInfo };
      captureWindow.webContents.send("capture-ready-data", pendingCapturePayload);
      captureWindow.showInactive();
      captureWindow.focus();
    })
    .catch((error) => {
      logDebug("startCapture failed", error && error.message ? error.message : String(error));
      if (captureWindow && !captureWindow.isDestroyed()) {
        captureWindow.close();
      }
      dialog.showErrorBox("截图失败", `获取屏幕图像失败：${error.message || error}`);
    });
}

function openPinnedImage(dataUrl, selectionRect) {
  logDebug("openPinnedImage called", `dataUrlLength=${dataUrl ? dataUrl.length : 0}`);
  pinnedWindowsHidden = false;
  const pinId = generatePinnedImageId();
  const config = getRunningHubConfig();
  if (config.autoCopyToClipboard && dataUrl) {
    try {
      clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    } catch (error) {
      logDebug(
        "clipboard write failed",
        error && error.message ? error.message : String(error)
      );
    }
  }
  const hasSelectionRect =
    selectionRect &&
    Number.isFinite(selectionRect.left) &&
    Number.isFinite(selectionRect.top) &&
    Number.isFinite(selectionRect.width) &&
    Number.isFinite(selectionRect.height);

  const pinWindow = new BrowserWindow({
    width: Math.max(120, Math.round(selectionRect?.width || 560)),
    height: Math.max(80, Math.round(selectionRect?.height || 360)),
    minWidth: 120,
    minHeight: 80,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const pinEntry = {
    id: pinId,
    dataUrl,
    images: dataUrl ? [dataUrl] : [],
    activeImageIndex: 0,
    window: pinWindow,
  };
  pinnedImageWindows.set(pinId, pinEntry);
  lastFocusedPinWindowId = pinId;

  pinWindow.setAlwaysOnTop(true, "screen-saver");
  pinWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pinWindow.setMenuBarVisibility(false);
  pinWindow.setIgnoreMouseEvents(Boolean(config.defaultClickThrough), {
    forward: true,
  });
  if (hasSelectionRect) {
    const nextBounds = {
      x: Math.round(selectionRect.left),
      y: Math.round(selectionRect.top),
      width: Math.max(120, Math.round(selectionRect.width)),
      height: Math.max(80, Math.round(selectionRect.height)),
    };
    pinWindow.setBounds(nextBounds);
    pinEntry.preciseBounds = { ...nextBounds };
  } else {
    pinEntry.preciseBounds = { ...pinWindow.getBounds() };
  }
  pinWindow.loadFile(path.join(__dirname, "pin.html"));
  pinWindow.webContents.on("console-message", (_e, _level, msg) => {
    logDebug("pin console", msg);
  });
  pinWindow.webContents.once("did-finish-load", () => {
    logDebug("pin did-finish-load, sending image");
    syncPinImages(pinEntry);
    pinWindow.webContents.send("pin-click-through-state", config.defaultClickThrough);
    pinWindow.webContents.send("pin-window-meta", { id: pinId });
    syncPinnedSelectionStyles();
  });
  pinWindow.on("focus", () => {
    lastFocusedPinWindowId = pinId;
  });
  pinWindow.on("close", () => {
    if (!workflowWindow || workflowWindow.isDestroyed()) return;
    try {
      const parentWindow = workflowWindow.getParentWindow();
      if (parentWindow && parentWindow.id === pinWindow.id) {
        const bounds = workflowWindow.getBounds();
        workflowWindow.setParentWindow(null);
        workflowWindow.setBounds(bounds);
        workflowWindow.show();
      }
    } catch (error) {
      logDebug("detach workflow parent failed", error && error.message ? error.message : String(error));
    }
  });
  pinWindow.on("closed", () => {
    logDebug("pinWindow closed", pinId);
    pinDragState = null;
    deletePinnedWindowEntry(pinId);
    if (!getPinnedWindowEntries().length) {
      pinnedWindowsHidden = false;
    }
    refreshTrayMenu();
  });
  setSelectedPinnedImages([pinId]);
  pinWindow.show();
  pinWindow.focus();
  refreshTrayMenu();
  return pinEntry;
}

ipcMain.on("close-capture", () => {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
  }
});

ipcMain.on("capture-complete", (_event, payload) => {
  const dataUrl =
    payload && typeof payload === "object" ? payload.dataUrl : payload;
  const selectionRect =
    payload && typeof payload === "object" ? payload.selectionRect : null;
  const runImmediately = Boolean(payload && typeof payload === "object" && payload.runImmediately);
  logDebug("capture-complete received", `dataUrlLength=${dataUrl ? dataUrl.length : 0}`);
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
  }
  if (!dataUrl || typeof dataUrl !== "string") {
    logDebug("capture-complete invalid dataUrl");
    dialog.showErrorBox("截图失败", "未收到有效截图数据");
    return;
  }
  try {
    const pinEntry = openPinnedImage(dataUrl, selectionRect);
    if (runImmediately && pinEntry) {
      setImmediate(() => runRunningHubForEntries([pinEntry]));
    }
  } catch (error) {
    logDebug("openPinnedImage failed", error && error.stack ? error.stack : String(error));
    dialog.showErrorBox("截图失败", `打开置顶窗口失败：${error.message || error}`);
  }
});

ipcMain.handle("save-image", async (_event, dataUrl) => {
  const config = getRunningHubConfig();
  const defaultDirectory = String(config.defaultSaveDirectory || app.getPath("pictures"));
  const fileName = `SnapAI-${Date.now()}.png`;
  const targetPath = path.join(defaultDirectory, fileName);

  if (!fs.existsSync(defaultDirectory)) {
    fs.mkdirSync(defaultDirectory, { recursive: true });
  }

  const image = nativeImage.createFromDataURL(String(dataUrl || ""));
  const pngBuffer = image.toPNG();
  fs.writeFileSync(targetPath, pngBuffer);
  return { ok: true, filePath: targetPath };
});

ipcMain.handle("copy-image-to-clipboard", async (_event, dataUrl) => {
  const image = nativeImage.createFromDataURL(String(dataUrl || ""));
  if (image.isEmpty()) {
    throw new Error("未收到有效图片数据");
  }
  clipboard.writeImage(image);
  return { ok: true };
});

ipcMain.handle("choose-directory", async () => {
  const config = getRunningHubConfig();
  const result = await dialog.showOpenDialog({
    title: "选择默认保存位置",
    defaultPath: String(config.defaultSaveDirectory || app.getPath("pictures")),
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
    return { ok: false };
  }

  return { ok: true, directoryPath: result.filePaths[0] };
});

ipcMain.handle("choose-workflow-json-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择工作流 JSON 文件",
    defaultPath: runningHubWorkflowDir,
    properties: ["openFile"],
    filters: [{ name: "JSON Files", extensions: ["json"] }],
  });

  if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
    return { ok: false, cancelled: true };
  }

  const sourcePath = result.filePaths[0];
  return {
    ok: true,
    sourcePath,
    fileName: path.basename(sourcePath),
    fileBaseName: path.basename(sourcePath, path.extname(sourcePath)),
  };
});
ipcMain.handle("choose-workflow-thumbnail-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择工作流缩略图",
    defaultPath: runningHubWorkflowDir,
    properties: ["openFile"],
    filters: [{ name: "Image Files", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });

  if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
    return { ok: false, cancelled: true };
  }

  const sourcePath = result.filePaths[0];
  return {
    ok: true,
    sourcePath,
    fileName: path.basename(sourcePath),
  };
});
ipcMain.handle("get-capture-display-info", () => {
  const cursorPoint = screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const display = targetDisplay || screen.getPrimaryDisplay();
  return {
    id: display.id,
    scaleFactor: display.scaleFactor,
    bounds: display.bounds,
    workArea: display.workArea,
  };
});
ipcMain.handle("get-screen-image-data-url", async (_event, payload = {}) => {
  return captureScreenImageDataUrl(payload);
});

ipcMain.on("pin-recapture", () => startCapture());
ipcMain.on("pin-close", (event) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return;
  pinEntry.window.close();
});
ipcMain.on("pin-open-workflow-selector", () => {
  showWorkflowWindow();
});
ipcMain.handle("get-workflow-summaries", () => {
  return getWorkflowSummaries();
});
ipcMain.handle("get-workflow-input-context", () => {
  return getWorkflowInputContext();
});
ipcMain.handle("get-clipboard-image-data-url", () => {
  const image = clipboard.readImage();
  if (!image || image.isEmpty()) {
    return { ok: false, error: "剪贴板里没有图片" };
  }
  return { ok: true, dataUrl: image.toDataURL() };
});
ipcMain.handle("run-workflow-with-image", async (_event, dataUrl) => {
  const imageDataUrl = String(dataUrl || "");
  if (!imageDataUrl.startsWith("data:image/")) {
    return { ok: false, error: "请先放入一张图片" };
  }
  try {
    const pinEntry = openPinnedImage(imageDataUrl, null);
    if (pinEntry && pinEntry.window && !pinEntry.window.isDestroyed() && pinEntry.window.webContents.isLoading()) {
      await new Promise((resolve) => pinEntry.window.webContents.once("did-finish-load", resolve));
    }
    runRunningHubForEntries([pinEntry]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
});
ipcMain.handle("open-workflow-link", async (_event, fileName) => {
  try {
    const workflow = readWorkflow(String(fileName || ""));
    const url = buildWorkflowWebUrl(workflow.workflowId);
    if (!url) return { ok: false, error: "这个工作流还没有配置网页工作流 ID" };
    await shell.openExternal(url);
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
});
ipcMain.handle("get-workflow-config", (_event, fileName) => {
  if (!fileName || typeof fileName !== "string") {
    return { ok: false, error: "无效的工作流文件名" };
  }
  try {
    const workflow = readWorkflow(fileName);
    return {
      ok: true,
      workflow: {
        fileName: workflow.fileName,
        name: workflow.name,
        workflowId: workflow.workflowId,
        imageNodeId: workflow.imageNodeId,
        imageFieldName: workflow.imageFieldName,
        outputNodeId: workflow.outputNodeId,
        imagePlaceholder: workflow.imagePlaceholder,
        thumbnailPath: getWorkflowThumbnailPath(fileName),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
    };
  }
});
ipcMain.handle("save-workflow-config", (_event, payload = {}) => {
  const fileName = String(payload.fileName || "").trim();
  if (!fileName) {
    return { ok: false, error: "无效的工作流文件名" };
  }

  try {
    if (payload.workflowJsonSourcePath) {
      replaceWorkflowJsonFile(fileName, String(payload.workflowJsonSourcePath || ""));
    }
    if (payload.thumbnailSourcePath) {
      saveWorkflowThumbnail(fileName, String(payload.thumbnailSourcePath || ""));
    }

    const saved = saveWorkflowConfig(fileName, {
      workflowId: String(payload.workflowId || "").trim(),
      imageNodeId: String(payload.imageNodeId || "36").trim() || "36",
      imageFieldName: String(payload.imageFieldName || "image").trim() || "image",
      outputNodeId: String(payload.outputNodeId || "").trim(),
      imagePlaceholder:
        String(payload.imagePlaceholder || WORKFLOW_IMAGE_PLACEHOLDER).trim() ||
        WORKFLOW_IMAGE_PLACEHOLDER,
    });
    sendWorkflowSelectionData();
    sendSettingsData();
    return { ok: true, config: saved };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
    };
  }
});
ipcMain.handle("import-workflow-json", async (_event, payload = {}) => {
  try {
    const result = await importWorkflowFromJson(payload);
    if (result.ok) {
      if (payload.thumbnailSourcePath) {
        saveWorkflowThumbnail(result.fileName, String(payload.thumbnailSourcePath || ""));
      }
      setSelectedWorkflow(result.fileName);
      sendWorkflowSelectionData();
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
    };
  }
});
ipcMain.handle("select-workflow", (_event, fileName) => {
  if (!fileName || typeof fileName !== "string") {
    return { ok: false, error: "无效的工作流文件名" };
  }
  setSelectedWorkflow(fileName);
  return { ok: true };
});
ipcMain.handle("delete-workflow", (_event, fileName) => {
  const normalizedFileName = String(fileName || "").trim();
  if (!normalizedFileName) {
    return { ok: false, error: "无效的工作流文件名" };
  }
  try {
    deleteWorkflowFiles(normalizedFileName);
    const currentConfig = getRunningHubConfig();
    if (currentConfig.selectedWorkflowFile === normalizedFileName) {
      const remainingFiles = getWorkflowFiles();
      saveRunningHubConfig({ selectedWorkflowFile: remainingFiles[0] || "" });
    }
    sendWorkflowSelectionData();
    sendSettingsData();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
    };
  }
});
ipcMain.handle("run-selected-workflow", async () => {
  const selectedEntries = getSelectedPinnedWindowEntries();
  if (!selectedEntries.length) {
    return { ok: false, error: "请先选中至少一张置顶截图" };
  }

  const timingInfo = getSelectedWorkflowTimingInfo();
  runningHubActiveCount += 1;
  sendPinProgress({
    state: "running",
    workflowName: timingInfo.workflowName,
    estimatedDurationMs: timingInfo.estimatedDurationMs,
    startedAt: Date.now(),
  }, selectedEntries);
  try {
    const workflowNames = [];
    for (let index = 0; index < selectedEntries.length; index += 1) {
      const entry = selectedEntries[index];
      if (selectedEntries.length > 1) {
        sendPinProgress({
          state: "running",
          workflowName: timingInfo.workflowName,
          estimatedDurationMs: timingInfo.estimatedDurationMs,
          startedAt: Date.now(),
          prefix: `第 ${index + 1}/${selectedEntries.length} 张`,
        }, [entry]);
      }
      const result = await runRunningHubGeneration(entry.dataUrl);
      appendImageToPinEntry(entry, result.resultImageDataUrl);
      workflowNames.push(result.workflowName);
    }
    sendPinProgress({
      state: "done",
      workflowName: workflowNames.join("、") || timingInfo.workflowName,
    }, selectedEntries);
    return { ok: true, workflowName: workflowNames.join("、"), processedCount: selectedEntries.length };
  } catch (error) {
    const userError = formatUserFacingRunningHubError(error, {
      ...((error && error.runningHubContext) || {}),
      workflowName: (error && error.runningHubContext && error.runningHubContext.workflowName) || timingInfo.workflowName,
    });
    sendPinProgress({
      state: "error",
      workflowName: timingInfo.workflowName,
      title: userError.title,
      message: userError.message,
      rawMessage: userError.rawMessage,
    }, selectedEntries);
    return { ok: false, error: userError.message };
  } finally {
    runningHubActiveCount = Math.max(0, runningHubActiveCount - 1);
  }
});
ipcMain.handle("pin-set-click-through", (event, enable) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return false;
  const clickThrough = Boolean(enable);
  pinEntry.window.setIgnoreMouseEvents(clickThrough, { forward: true });
  pinEntry.window.webContents.send("pin-click-through-state", clickThrough);
  return clickThrough;
});
ipcMain.handle("pin-set-size", (event, payload = {}) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return false;
  const width = Math.max(120, Math.floor(Number(payload.width) || 0));
  const height = Math.max(80, Math.floor(Number(payload.height) || 0));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  pinEntry.window.setContentSize(width, height);
  const bounds = pinEntry.window.getBounds();
  pinEntry.preciseBounds = { ...bounds };
  return true;
});
ipcMain.handle("pin-scale-at", (event, payload = {}) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return false;
  const scale = Number(payload.scaleFactor) || 1;
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const windowBounds = pinEntry.window.getBounds();
  const preciseBounds = pinEntry.preciseBounds || { ...windowBounds };
  const ratioX = Math.min(1, Math.max(0, Number(payload.anchorRatioX)));
  const ratioY = Math.min(1, Math.max(0, Number(payload.anchorRatioY)));
  const safeRatioX = Number.isFinite(ratioX) ? ratioX : 0.5;
  const safeRatioY = Number.isFinite(ratioY) ? ratioY : 0.5;
  const anchorScreenX = preciseBounds.x + preciseBounds.width * safeRatioX;
  const anchorScreenY = preciseBounds.y + preciseBounds.height * safeRatioY;
  const minWidth = 120;
  const minHeight = 80;
  const minScale = Math.max(minWidth / Math.max(1, preciseBounds.width), minHeight / Math.max(1, preciseBounds.height));
  const safeScale = Math.max(scale, minScale);
  const nextWidth = preciseBounds.width * safeScale;
  const nextHeight = preciseBounds.height * safeScale;
  const nextBounds = {
    x: anchorScreenX - nextWidth * safeRatioX,
    y: anchorScreenY - nextHeight * safeRatioY,
    width: nextWidth,
    height: nextHeight,
  };
  pinEntry.preciseBounds = nextBounds;
  pinEntry.window.setBounds({
    x: Math.round(nextBounds.x),
    y: Math.round(nextBounds.y),
    width: Math.round(nextBounds.width),
    height: Math.round(nextBounds.height),
  }, false);
  return true;
});
ipcMain.handle("pin-set-opacity", (event, opacity) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return false;
  const value = Math.min(1, Math.max(0.18, Number(opacity) || 1));
  pinEntry.window.setOpacity(value);
  return true;
});
ipcMain.handle("pin-fit-to-image", (event, payload = {}) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return false;
  const imageWidth = Math.max(1, Number(payload.width) || 0);
  const imageHeight = Math.max(1, Number(payload.height) || 0);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return false;

  const bounds = pinEntry.window.getBounds();
  const currentWidth = Math.max(120, bounds.width);
  const currentHeight = Math.max(80, bounds.height);
  const currentArea = currentWidth * currentHeight;
  const imageRatio = imageWidth / imageHeight;
  let nextWidth = Math.max(120, Math.round(Math.sqrt(currentArea * imageRatio)));
  let nextHeight = Math.max(80, Math.round(nextWidth / imageRatio));

  if (nextHeight < 80) {
    nextHeight = 80;
    nextWidth = Math.max(120, Math.round(nextHeight * imageRatio));
  }
  if (nextWidth < 120) {
    nextWidth = 120;
    nextHeight = Math.max(80, Math.round(nextWidth / imageRatio));
  }

  const nextBounds = {
    x: Math.round(bounds.x + (bounds.width - nextWidth) / 2),
    y: Math.round(bounds.y + (bounds.height - nextHeight) / 2),
    width: nextWidth,
    height: nextHeight,
  };
  pinEntry.preciseBounds = { ...nextBounds };
  pinEntry.window.setBounds(nextBounds);
  return true;
});
ipcMain.handle("pin-switch-image", (event, payload = {}) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return false;
  const images = normalizePinnedImageList(pinEntry.images || []);
  if (!images.length) return false;
  const nextIndex = Math.max(0, Math.min(images.length - 1, Math.floor(Number(payload.index) || 0)));
  pinEntry.activeImageIndex = nextIndex;
  syncPinImages(pinEntry);
  return true;
});
ipcMain.on("pin-start-file-drag", (event, dataUrl) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return;
  try {
    const image = nativeImage.createFromDataURL(String(dataUrl || pinEntry.dataUrl || ""));
    if (image.isEmpty()) return;
    const dragDir = path.join(appDataRoot, "drag-cache");
    if (!fs.existsSync(dragDir)) fs.mkdirSync(dragDir, { recursive: true });
    const filePath = path.join(dragDir, `SnapAI-${Date.now()}.png`);
    fs.writeFileSync(filePath, image.toPNG());
    event.sender.startDrag({
      file: filePath,
      icon: image.resize({ width: 96, height: 96 }),
    });
  } catch (error) {
    logDebug("pin-start-file-drag failed", error && error.message ? error.message : String(error));
  }
});
ipcMain.on("pin-start-drag", (event, payload = {}) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return;
  pinDragState = {
    pinId: pinEntry.id,
    startBounds: pinEntry.preciseBounds || pinEntry.window.getBounds(),
    startX: Number(payload.screenX) || 0,
    startY: Number(payload.screenY) || 0,
  };
});
ipcMain.on("pin-drag", (_event, payload = {}) => {
  if (!pinDragState || !pinDragState.pinId || !pinnedImageWindows.has(pinDragState.pinId)) return;
  const pinEntry = pinnedImageWindows.get(pinDragState.pinId);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return;
  const currentX = Number(payload.screenX) || 0;
  const currentY = Number(payload.screenY) || 0;
  const deltaX = currentX - pinDragState.startX;
  const deltaY = currentY - pinDragState.startY;
  const nextBounds = {
    ...pinDragState.startBounds,
    x: Math.round(pinDragState.startBounds.x + deltaX),
    y: Math.round(pinDragState.startBounds.y + deltaY),
  };
  pinEntry.preciseBounds = { ...nextBounds };
  pinEntry.window.setBounds(nextBounds);
});
ipcMain.on("pin-end-drag", () => {
  pinDragState = null;
});
ipcMain.on("renderer-error", (_event, payload) => {
  const source = payload && payload.source ? payload.source : "unknown";
  const message = payload && payload.message ? payload.message : "empty message";
  logDebug("renderer-error", `${source}: ${message}`);
});
ipcMain.on("pin-show-context-menu", (event) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry || !pinEntry.window || pinEntry.window.isDestroyed()) return;
  const menu = buildPinContextMenu(pinEntry);
  menu.popup({ window: pinEntry.window });
});
ipcMain.on("pin-select", (event, payload = {}) => {
  const pinEntry = getPinnedWindowEntryByWebContents(event.sender);
  if (!pinEntry) return;
  lastFocusedPinWindowId = pinEntry.id;
  togglePinnedImageSelection(pinEntry.id, Boolean(payload.additive));
});
ipcMain.on("workflow-selector-close", () => {
  if (workflowWindow && !workflowWindow.isDestroyed()) {
    workflowWindow.close();
  }
});

ipcMain.handle("get-settings", () => {
  return getRunningHubConfig();
});
ipcMain.handle("save-settings", async (_event, payload = {}) => {
  try {
    const current = getRunningHubConfig();
    const nextSettings = {
      apiKey: String(payload.apiKey || "").trim(),
      uploadUrl: String(payload.uploadUrl || "").trim() || getDefaultAppSettings().uploadUrl,
      createTaskUrl:
        String(payload.createTaskUrl || "").trim() || getDefaultAppSettings().createTaskUrl,
      taskStatusUrl:
        String(payload.taskStatusUrl || "").trim() || getDefaultAppSettings().taskStatusUrl,
      webhookDetailUrl:
        String(payload.webhookDetailUrl || "").trim() ||
        getDefaultAppSettings().webhookDetailUrl,
      captureShortcut: normalizeShortcut(
        payload.captureShortcut,
        getDefaultAppSettings().captureShortcut
      ),
      workflowShortcut: normalizeShortcut(
        payload.workflowShortcut,
        getDefaultAppSettings().workflowShortcut
      ),
      togglePinnedShortcut: normalizeShortcut(
        payload.togglePinnedShortcut,
        getDefaultAppSettings().togglePinnedShortcut
      ),
      defaultClickThrough: Boolean(payload.defaultClickThrough),
      autoCopyToClipboard:
        typeof payload.autoCopyToClipboard === "boolean"
          ? payload.autoCopyToClipboard
          : true,
      launchAtStartup: Boolean(payload.launchAtStartup),
      defaultSaveDirectory:
        String(payload.defaultSaveDirectory || "").trim() ||
        current.defaultSaveDirectory ||
        getDefaultAppSettings().defaultSaveDirectory,
      selectedWorkflowFile: current.selectedWorkflowFile,
    };

    const saved = saveRunningHubConfig(nextSettings);
    app.setLoginItemSettings({
      openAtLogin: Boolean(saved.launchAtStartup),
    });
    const shortcutState = registerGlobalShortcuts();
    sendSettingsData();
    sendWorkflowSelectionData();
    refreshTrayMenu();

    if (
      !shortcutState.captureRegistered ||
      !shortcutState.workflowRegistered ||
      !shortcutState.toggleRegistered
    ) {
      return {
        ok: false,
        error: "部分快捷键注册失败，可能与其他软件冲突。请换一个组合键后重试。",
        settings: saved,
        shortcutState,
      };
    }

    return { ok: true, settings: saved, shortcutState };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    logDebug("save-settings failed", message);
    return { ok: false, error: message };
  }
});
ipcMain.handle("get-shortcut-registration-state", () => {
  const config = getRunningHubConfig();
  return {
    captureShortcut: config.captureShortcut,
    captureRegistered: globalShortcut.isRegistered(config.captureShortcut),
    workflowShortcut: config.workflowShortcut,
    workflowRegistered: globalShortcut.isRegistered(config.workflowShortcut),
    togglePinnedShortcut: config.togglePinnedShortcut,
    togglePinnedRegistered: globalShortcut.isRegistered(config.togglePinnedShortcut),
  };
});
ipcMain.on("settings-close", () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});

app.whenReady().then(() => {
  logDebug("app ready");
  ensureRunningHubFiles();
  createTray();
  app.setLoginItemSettings({
    openAtLogin: Boolean(getRunningHubConfig().launchAtStartup),
  });
  registerGlobalShortcuts();
});

app.on("window-all-closed", () => undefined);

app.on("activate", () => {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    return;
  }
  settingsWindow.show();
  settingsWindow.focus();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
