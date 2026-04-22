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
} = require("electron");
const path = require("path");
const fs = require("fs");

let tray = null;
let captureWindow = null;
let pinWindow = null;
let workflowWindow = null;
let settingsWindow = null;
let pinDragState = null;
let pinnedWindowsHidden = false;
const isPackagedApp = app.isPackaged;
const bundledConfigPath = path.join(__dirname, "runninghub.config.json");
const bundledWorkflowDir = path.join(__dirname, "runninghub-workflows");
const appDataRoot = isPackagedApp
  ? path.join(app.getPath("userData"), "runninghub-data")
  : __dirname;
const logFilePath = path.join(appDataRoot, "snapai-debug.log");
const runningHubConfigPath = path.join(appDataRoot, "runninghub.config.json");
const runningHubWorkflowDir = isPackagedApp
  ? path.join(appDataRoot, "runninghub-workflows")
  : bundledWorkflowDir;
let runningHubUploading = false;
let currentPinnedImageDataUrl = "";

function getDefaultAppSettings() {
  return {
    apiKey: "",
    uploadUrl: "https://www.runninghub.cn/task/openapi/upload",
    createTaskUrl: "https://www.runninghub.cn/task/openapi/create",
    taskStatusUrl: "https://www.runninghub.cn/task/openapi/status",
    webhookDetailUrl: "https://www.runninghub.cn/task/openapi/getWebhookDetail",
    selectedWorkflowFile: "",
    captureShortcut: "CommandOrControl+Shift+A",
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
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
    <rect x="10" y="18" width="44" height="30" rx="6" fill="#2f7fff"/>
    <circle cx="32" cy="33" r="9" fill="#ffffff"/>
    <rect x="17" y="14" width="10" height="6" rx="2" fill="#2f7fff"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  );
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("SnapAI 简易截图");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "区域截图",
      click: () => startCapture(),
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
      webhookDetailUrl: String(parsed.webhookDetailUrl || defaults.webhookDetailUrl),
      selectedWorkflowFile: String(parsed.selectedWorkflowFile || defaults.selectedWorkflowFile),
      captureShortcut: String(parsed.captureShortcut || defaults.captureShortcut),
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
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
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

function getWorkflowSummaries() {
  const config = getRunningHubConfig();
  return getWorkflowFiles().map((fileName) => {
    const workflow = readWorkflow(fileName);
    const thumbnailPath = getWorkflowThumbnailPath(fileName);
    return {
      fileName,
      name: workflow.name,
      workflowId: workflow.workflowId,
      selected: config.selectedWorkflowFile === fileName,
      thumbnailDataUrl: thumbnailPath ? fileToDataUrl(thumbnailPath) : "",
    };
  });
}

function readWorkflow(fileName) {
  const fullPath = path.join(runningHubWorkflowDir, fileName);
  const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  return {
    fileName,
    name: String(parsed.name || fileName),
    workflowId: String(parsed.workflowId || ""),
    imagePlaceholder: String(parsed.imagePlaceholder || "{{RUNNINGHUB_IMAGE_URL}}"),
    requestTemplate: parsed.requestTemplate || {},
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

  const response = await fetch(config.createTaskUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
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

function pickResultImageUrl(data) {
  if (!data) return "";
  if (typeof data === "string") {
    return looksLikeImageRef(data) ? data.trim() : "";
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const url = pickResultImageUrl(item);
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
    const arrayKeys = ["results", "images", "outputs", "output", "fileList", "data"];
    for (const key of arrayKeys) {
      if (key in data) {
        const url = pickResultImageUrl(data[key]);
        if (url) return url;
      }
    }
    for (const value of Object.values(data)) {
      const url = pickResultImageUrl(value);
      if (url) return url;
    }
  }
  return "";
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

function createRunningHubWebSocketWatcher(wsUrl, taskId, onProgress) {
  let socket = null;
  let latestImageUrl = "";
  let settled = false;
  let timeoutId = null;

  const resultPromise = new Promise((resolve) => {
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
        const imageUrl = pickResultImageUrl(parsed);
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
    async waitForImage(timeoutMs = 8000) {
      const immediate = latestImageUrl;
      if (immediate) return immediate;
      return Promise.race([
        resultPromise,
        new Promise((resolve) => setTimeout(() => resolve(latestImageUrl || ""), timeoutMs)),
      ]);
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

async function waitRunningHubTaskResult(config, taskId, onProgress, options = {}) {
  const maxTries = 120;
  const wsWatcher =
    options.wsUrl && typeof options.wsUrl === "string"
      ? createRunningHubWebSocketWatcher(options.wsUrl, taskId, onProgress)
      : null;

  try {
    for (let i = 0; i < maxTries; i += 1) {
      const data = await queryRunningHubTaskStatus(config, taskId);
      const status = String(
        typeof data === "string"
          ? data
          : (data && (data.status || data.taskStatus || data.state)) || ""
      ).toUpperCase();
      const imageUrl = pickResultImageUrl(data) || (wsWatcher ? wsWatcher.getImageUrl() : "");
      if (onProgress) {
        const seconds = Math.round(((i + 1) * 2500) / 1000);
        onProgress(`任务 ${taskId} 状态: ${status || "UNKNOWN"}（已等待 ${seconds}s）`);
      }
      if (status === "FAILED") {
        const errMsg =
          (typeof data === "object" &&
            data &&
            (data.errorMessage || data.failedReason || data.msg)) ||
          "任务执行失败";
        throw new Error(String(errMsg));
      }
      if (status === "SUCCESS" && imageUrl) {
        return imageUrl;
      }
      if (status === "SUCCESS" && !imageUrl) {
        if (wsWatcher) {
          if (onProgress) {
            onProgress("状态已成功，正在等待任务结果通道返回图片...");
          }
          const wsImageUrl = await wsWatcher.waitForImage(12000);
          if (wsImageUrl) {
            return wsImageUrl;
          }
        }
        if (onProgress) {
          onProgress("状态接口未返回结果图，正在尝试 webhook 详情...");
        }
        try {
          const webhookData = await queryRunningHubWebhookDetail(config, taskId);
          const webhookImageUrl = pickResultImageUrl(webhookData);
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
        logDebug(
          "runninghub success without image",
          JSON.stringify({ taskId, statusData: data, wsUrl: options.wsUrl || "" }).slice(0, 2000)
        );
        throw new Error("任务已成功，但未获取到结果图链接");
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
  if (!looksLikeImageRef(imageUrl)) {
    throw new Error(`返回的结果不是可下载图片地址: ${imageUrl}`);
  }
  const response = await fetch(imageUrl);
  if (!response.ok) {
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
  if (onProgress) onProgress(`开始上传截图（工作流：${workflow.name}）...`);
  const imageUrl = await uploadImageToRunningHub(dataUrl, config);
  if (onProgress) onProgress("上传成功，开始创建任务...");
  const taskResult = await createRunningHubTask(config, workflow, imageUrl);
  const taskId = pickTaskId(taskResult);
  const wsUrl = pickRunningHubWebSocketUrl(taskResult);
  if (!taskId) {
    throw new Error(`已创建任务但未拿到 taskId: ${JSON.stringify(taskResult)}`);
  }
  logDebug(
    "runninghub create parsed",
    JSON.stringify({ taskId, wsUrl, taskStatus: taskResult && taskResult.taskStatus }).slice(0, 2000)
  );
  if (onProgress) onProgress(`任务已创建，taskId=${taskId}`);
  const resultImageUrl = await waitRunningHubTaskResult(config, taskId, onProgress, {
    wsUrl,
  });
  if (onProgress) onProgress("已拿到结果图链接，正在下载结果...");
  const resultImageDataUrl = await imageUrlToDataUrl(resultImageUrl);
  if (onProgress) onProgress("结果已下载，正在替换贴图...");
  return { workflowName: workflow.name, imageUrl, taskResult, taskId, resultImageDataUrl };
}

function sendPinStatus(message) {
  if (pinWindow && !pinWindow.isDestroyed()) {
    pinWindow.webContents.send("runninghub-status", message);
  }
}

function sendWorkflowSelectionData() {
  if (workflowWindow && !workflowWindow.isDestroyed()) {
    workflowWindow.webContents.send("workflow-selection-data", getWorkflowSummaries());
  }
}

function setSelectedWorkflow(fileName) {
  saveRunningHubConfig({ selectedWorkflowFile: fileName });
  sendWorkflowSelectionData();
  sendSettingsData();
}

function showWorkflowWindow() {
  if (!pinWindow || pinWindow.isDestroyed()) {
    return;
  }

  if (workflowWindow && !workflowWindow.isDestroyed()) {
    workflowWindow.show();
    workflowWindow.focus();
    sendWorkflowSelectionData();
    return;
  }

  workflowWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    parent: pinWindow,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  workflowWindow.setAlwaysOnTop(true, "screen-saver");
  workflowWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  workflowWindow.setMenuBarVisibility(false);
  workflowWindow.loadFile(path.join(__dirname, "workflow-selector.html"));
  workflowWindow.webContents.on("console-message", (_e, _level, msg) => {
    logDebug("workflow selector console", msg);
  });
  workflowWindow.webContents.once("did-finish-load", () => {
    sendWorkflowSelectionData();
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
  const togglePinnedShortcut = normalizeShortcut(
    config.togglePinnedShortcut,
    getDefaultAppSettings().togglePinnedShortcut
  );

  const captureRegistered = globalShortcut.register(captureShortcut, () => {
    startCapture();
  });
  const toggleRegistered = globalShortcut.register(togglePinnedShortcut, () => {
    togglePinnedImagesVisibility();
  });

  logDebug(
    "global shortcuts registered",
    JSON.stringify({
      captureShortcut,
      captureRegistered,
      togglePinnedShortcut,
      toggleRegistered,
    })
  );

  return {
    captureShortcut,
    captureRegistered,
    togglePinnedShortcut,
    toggleRegistered,
  };
}

function togglePinnedImagesVisibility(forceVisible) {
  if (!pinWindow || pinWindow.isDestroyed()) {
    return false;
  }
  const nextHidden =
    typeof forceVisible === "boolean" ? !forceVisible : !pinnedWindowsHidden;
  pinnedWindowsHidden = nextHidden;
  if (pinnedWindowsHidden) {
    pinWindow.hide();
    if (workflowWindow && !workflowWindow.isDestroyed()) {
      workflowWindow.hide();
    }
  } else {
    pinWindow.show();
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
    width: 1120,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    title: "SnapAI 设置",
    backgroundColor: "#0b1016",
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
function buildPinContextMenu(dataUrl) {
  return Menu.buildFromTemplate([
    {
      label: runningHubUploading ? "RunningHub 正在处理..." : "上传到 RunningHub 生图",
      enabled: !runningHubUploading && Boolean(dataUrl),
      click: async () => {
        runningHubUploading = true;
        sendPinStatus("RunningHub: 准备开始...");
        try {
          const result = await runRunningHubGeneration(dataUrl, (msg) =>
            sendPinStatus(`RunningHub: ${msg}`)
          );
          currentPinnedImageDataUrl = result.resultImageDataUrl;
          if (pinWindow && !pinWindow.isDestroyed()) {
            pinWindow.webContents.send("set-image", result.resultImageDataUrl);
          }
          sendPinStatus(`RunningHub 生图完成（${result.workflowName}）`);
        } catch (error) {
          sendPinStatus(`RunningHub 失败: ${error.message || error}`);
        } finally {
          runningHubUploading = false;
        }
      },
    },
    {
      label: "打开工作流选择器",
      enabled: !runningHubUploading,
      click: () => showWorkflowWindow(),
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

function startCapture() {
  logDebug("startCapture called");
  if (captureWindow) {
    logDebug("captureWindow already exists, focusing");
    captureWindow.focus();
    return;
  }

  captureWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  captureWindow.loadFile(path.join(__dirname, "capture.html"));
  captureWindow.webContents.on("console-message", (_e, _level, msg) => {
    logDebug("capture console", msg);
  });
  captureWindow.on("closed", () => {
    logDebug("captureWindow closed");
    captureWindow = null;
  });
}

function openPinnedImage(dataUrl, selectionRect) {
  logDebug("openPinnedImage called", `dataUrlLength=${dataUrl ? dataUrl.length : 0}`);
  currentPinnedImageDataUrl = typeof dataUrl === "string" ? dataUrl : "";
  pinnedWindowsHidden = false;
  const config = getRunningHubConfig();
  if (config.autoCopyToClipboard && currentPinnedImageDataUrl) {
    try {
      clipboard.writeImage(nativeImage.createFromDataURL(currentPinnedImageDataUrl));
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

  if (pinWindow && !pinWindow.isDestroyed()) {
    pinWindow.webContents.send("pin-click-through-state", config.defaultClickThrough);
    pinWindow.setIgnoreMouseEvents(Boolean(config.defaultClickThrough), { forward: true });
    if (hasSelectionRect) {
      pinWindow.setBounds({
        x: Math.round(selectionRect.left),
        y: Math.round(selectionRect.top),
        width: Math.max(120, Math.round(selectionRect.width)),
        height: Math.max(80, Math.round(selectionRect.height)),
      });
    }
    pinWindow.webContents.send("set-image", dataUrl);
    pinWindow.show();
    pinWindow.focus();
    refreshTrayMenu();
    return;
  }

  pinWindow = new BrowserWindow({
    width: 560,
    height: 360,
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

  pinWindow.setAlwaysOnTop(true, "screen-saver");
  pinWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pinWindow.setMenuBarVisibility(false);
  pinWindow.setIgnoreMouseEvents(Boolean(config.defaultClickThrough), {
    forward: true,
  });
  pinWindow.loadFile(path.join(__dirname, "pin.html"));
  pinWindow.webContents.on("console-message", (_e, _level, msg) => {
    logDebug("pin console", msg);
  });
  pinWindow.webContents.once("did-finish-load", () => {
    logDebug("pin did-finish-load, sending image");
    if (hasSelectionRect) {
      pinWindow.setBounds({
        x: Math.round(selectionRect.left),
        y: Math.round(selectionRect.top),
        width: Math.max(120, Math.round(selectionRect.width)),
        height: Math.max(80, Math.round(selectionRect.height)),
      });
    }
    pinWindow.webContents.send("set-image", dataUrl);
    pinWindow.webContents.send("pin-click-through-state", config.defaultClickThrough);
  });
  pinWindow.on("closed", () => {
    logDebug("pinWindow closed");
    pinDragState = null;
    pinnedWindowsHidden = false;
    currentPinnedImageDataUrl = "";
    if (workflowWindow && !workflowWindow.isDestroyed()) {
      workflowWindow.close();
    }
    refreshTrayMenu();
    pinWindow = null;
  });
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
    openPinnedImage(dataUrl, selectionRect);
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

  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(targetPath, Buffer.from(base64Data, "base64"));
  return { ok: true, filePath: targetPath };
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

ipcMain.handle("get-screen-image-data-url", async (_event, payload = {}) => {
  const width = Number.isFinite(payload.width) ? payload.width : 1920;
  const height = Number.isFinite(payload.height) ? payload.height : 1080;
  logDebug("get-screen-image-data-url", `${width}x${height}`);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });

  if (!sources.length) {
    throw new Error("未获取到可用屏幕源");
  }

  const sourceWithImage =
    sources.find((item) => !item.thumbnail.isEmpty()) || sources[0];
  const dataUrl = sourceWithImage.thumbnail.toDataURL();

  if (!dataUrl || dataUrl === "data:image/png;base64,") {
    throw new Error("屏幕截图数据为空");
  }

  return dataUrl;
});

ipcMain.on("pin-recapture", () => startCapture());
ipcMain.on("pin-close", () => {
  if (workflowWindow && !workflowWindow.isDestroyed()) {
    workflowWindow.close();
  }
  if (pinWindow && !pinWindow.isDestroyed()) pinWindow.close();
});
ipcMain.on("pin-open-workflow-selector", () => {
  showWorkflowWindow();
});
ipcMain.handle("get-workflow-summaries", () => {
  return getWorkflowSummaries();
});
ipcMain.handle("select-workflow", (_event, fileName) => {
  if (!fileName || typeof fileName !== "string") {
    return { ok: false, error: "无效的工作流文件名" };
  }
  setSelectedWorkflow(fileName);
  return { ok: true };
});
ipcMain.handle("run-selected-workflow", async () => {
  if (runningHubUploading) {
    return { ok: false, error: "RunningHub 正在处理，请稍后再试" };
  }
  if (!currentPinnedImageDataUrl) {
    return { ok: false, error: "当前没有可用截图" };
  }

  runningHubUploading = true;
  sendPinStatus("RunningHub: 准备开始...");
  try {
    const result = await runRunningHubGeneration(currentPinnedImageDataUrl, (msg) =>
      sendPinStatus(`RunningHub: ${msg}`)
    );
    currentPinnedImageDataUrl = result.resultImageDataUrl;
    if (pinWindow && !pinWindow.isDestroyed()) {
      pinWindow.webContents.send("set-image", result.resultImageDataUrl);
    }
    sendPinStatus(`RunningHub 生图完成（${result.workflowName}）`);
    return { ok: true, workflowName: result.workflowName };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    sendPinStatus(`RunningHub 失败: ${message}`);
    return { ok: false, error: message };
  } finally {
    runningHubUploading = false;
  }
});
ipcMain.handle("pin-set-click-through", (_event, enable) => {
  if (!pinWindow || pinWindow.isDestroyed()) return false;
  const clickThrough = Boolean(enable);
  pinWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  pinWindow.webContents.send("pin-click-through-state", clickThrough);
  return clickThrough;
});
ipcMain.handle("pin-set-size", (_event, payload = {}) => {
  if (!pinWindow || pinWindow.isDestroyed()) return false;
  const width = Math.max(120, Math.floor(Number(payload.width) || 0));
  const height = Math.max(80, Math.floor(Number(payload.height) || 0));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  pinWindow.setContentSize(width, height);
  return true;
});
ipcMain.on("pin-start-drag", (_event, payload = {}) => {
  if (!pinWindow || pinWindow.isDestroyed()) return;
  pinDragState = {
    startBounds: pinWindow.getBounds(),
    startX: Number(payload.screenX) || 0,
    startY: Number(payload.screenY) || 0,
  };
});
ipcMain.on("pin-drag", (_event, payload = {}) => {
  if (!pinWindow || pinWindow.isDestroyed() || !pinDragState) return;
  const currentX = Number(payload.screenX) || 0;
  const currentY = Number(payload.screenY) || 0;
  const deltaX = currentX - pinDragState.startX;
  const deltaY = currentY - pinDragState.startY;
  pinWindow.setBounds({
    ...pinDragState.startBounds,
    x: Math.round(pinDragState.startBounds.x + deltaX),
    y: Math.round(pinDragState.startBounds.y + deltaY),
  });
});
ipcMain.on("pin-end-drag", () => {
  pinDragState = null;
});
ipcMain.on("renderer-error", (_event, payload) => {
  const source = payload && payload.source ? payload.source : "unknown";
  const message = payload && payload.message ? payload.message : "empty message";
  logDebug("renderer-error", `${source}: ${message}`);
});
ipcMain.on("pin-show-context-menu", (_event, dataUrl) => {
  if (!pinWindow || pinWindow.isDestroyed()) return;
  const menu = buildPinContextMenu(dataUrl);
  menu.popup({ window: pinWindow });
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

    if (!shortcutState.captureRegistered || !shortcutState.toggleRegistered) {
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
