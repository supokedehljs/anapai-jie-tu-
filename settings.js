const elements = {
  apiKey: document.getElementById("apiKey"),
  uploadUrl: document.getElementById("uploadUrl"),
  createTaskUrl: document.getElementById("createTaskUrl"),
  taskStatusUrl: document.getElementById("taskStatusUrl"),
  webhookDetailUrl: document.getElementById("webhookDetailUrl"),
  captureShortcut: document.getElementById("captureShortcut"),
  workflowShortcut: document.getElementById("workflowShortcut"),
  historyShortcut: document.getElementById("historyShortcut"),
  togglePinnedShortcut: document.getElementById("togglePinnedShortcut"),
  defaultClickThrough: document.getElementById("defaultClickThrough"),
  autoCopyToClipboard: document.getElementById("autoCopyToClipboard"),
  launchAtStartup: document.getElementById("launchAtStartup"),
  defaultSaveDirectory: document.getElementById("defaultSaveDirectory"),
  browseSaveDirectoryBtn: document.getElementById("browseSaveDirectoryBtn"),
  shortcutBadges: {
    capture: document.getElementById("captureShortcutState"),
    workflow: document.getElementById("workflowShortcutState"),
    history: document.getElementById("historyShortcutState"),
    togglePinned: document.getElementById("togglePinnedShortcutState"),
  },
  status: document.getElementById("status"),
  saveButtons: [document.getElementById("saveBtnTop")].filter(Boolean),
  closeButtons: [document.getElementById("closeBtnTop")].filter(Boolean),
};

const shortcutFields = [
  "captureShortcut",
  "workflowShortcut",
  "historyShortcut",
  "togglePinnedShortcut",
];
function displayShortcut(value = "") {
  return String(value || "").replace(/CommandOrControl/gi, "Ctrl");
}

function setStatus(message = "", isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", Boolean(isError));
}

function getShortcutBadgeText(ok) {
  return ok ? "已注册" : "未注册";
}

function setShortcutBadge(element, ok) {
  if (!element) return;
  element.textContent = getShortcutBadgeText(ok);
  element.classList.toggle("error", !ok);
}

function readShortcutRegisteredState(state, ...keys) {
  return keys.some((key) => state[key] === true);
}

function renderShortcutState(state = {}) {
  setShortcutBadge(
    elements.shortcutBadges.capture,
    readShortcutRegisteredState(state, "captureRegistered")
  );
  setShortcutBadge(
    elements.shortcutBadges.workflow,
    readShortcutRegisteredState(state, "workflowRegistered")
  );
  setShortcutBadge(
    elements.shortcutBadges.history,
    readShortcutRegisteredState(state, "historyRegistered")
  );
  setShortcutBadge(
    elements.shortcutBadges.togglePinned,
    readShortcutRegisteredState(state, "togglePinnedRegistered", "toggleRegistered")
  );
}

function normalizeShortcutParts(value = "") {
  const parts = displayShortcut(value)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = new Set();
  let key = "";
  parts.forEach((part) => {
    const lower = part.toLowerCase();
    if (lower === "shift") modifiers.add("Shift");
    else if (lower === "ctrl" || lower === "control" || lower === "cmd" || lower === "command") modifiers.add("Ctrl");
    else if (lower === "alt" || lower === "option") modifiers.add("Alt");
    else if (/^[a-z]$/i.test(part)) key = part.toUpperCase();
  });
  return { modifiers, key };
}

function getShortcutRow(fieldName) {
  return document.querySelector(`[data-shortcut="${fieldName}"]`);
}

function setShortcutBuilderValue(fieldName, value = "") {
  const row = getShortcutRow(fieldName);
  const input = elements[fieldName];
  if (!row || !input) return;
  const { modifiers, key } = normalizeShortcutParts(value);
  row.querySelectorAll("[data-modifier]").forEach((checkbox) => {
    checkbox.checked = modifiers.has(checkbox.dataset.modifier);
  });
  input.value = key;
  updateShortcutPreview(fieldName);
}

function buildShortcutValue(fieldName) {
  const row = getShortcutRow(fieldName);
  const input = elements[fieldName];
  if (!row || !input) return "";
  const parts = [];
  ["Shift", "Ctrl", "Alt"].forEach((modifier) => {
    const checkbox = row.querySelector(`[data-modifier="${modifier}"]`);
    if (checkbox && checkbox.checked) parts.push(modifier);
  });
  const key = String(input.value || "").trim().toUpperCase();
  if (!/^[A-Z]$/.test(key)) return "";
  if (!parts.length) return "";
  parts.push(key);
  return parts.join("+");
}

function updateShortcutPreview(fieldName) {
  const row = getShortcutRow(fieldName);
  if (!row) return;
  const preview = row.querySelector(`[data-preview-for="${fieldName}"]`);
  if (!preview) return;
  const value = buildShortcutValue(fieldName);
  preview.textContent = value ? `当前组合：${value}` : "请至少勾选一个修饰键，并输入 A-Z 字母";
}

function applySettings(settings = {}) {
  elements.apiKey.value = settings.apiKey || "";
  if (elements.uploadUrl) elements.uploadUrl.value = settings.uploadUrl || "";
  if (elements.createTaskUrl) elements.createTaskUrl.value = settings.createTaskUrl || "";
  if (elements.taskStatusUrl) elements.taskStatusUrl.value = settings.taskStatusUrl || "";
  if (elements.webhookDetailUrl) elements.webhookDetailUrl.value = settings.webhookDetailUrl || "";
  setShortcutBuilderValue("captureShortcut", settings.captureShortcut || "");
  setShortcutBuilderValue("workflowShortcut", settings.workflowShortcut || "");
  setShortcutBuilderValue("historyShortcut", settings.historyShortcut || "");
  setShortcutBuilderValue("togglePinnedShortcut", settings.togglePinnedShortcut || "");
  elements.defaultClickThrough.checked = Boolean(settings.defaultClickThrough);
  elements.autoCopyToClipboard.checked = Boolean(settings.autoCopyToClipboard);
  elements.launchAtStartup.checked = Boolean(settings.launchAtStartup);
  elements.defaultSaveDirectory.value = settings.defaultSaveDirectory || "";
}

function collectSettings() {
  return {
    apiKey: elements.apiKey.value.trim(),
    uploadUrl: elements.uploadUrl ? elements.uploadUrl.value.trim() : undefined,
    createTaskUrl: elements.createTaskUrl ? elements.createTaskUrl.value.trim() : undefined,
    taskStatusUrl: elements.taskStatusUrl ? elements.taskStatusUrl.value.trim() : undefined,
    webhookDetailUrl: elements.webhookDetailUrl ? elements.webhookDetailUrl.value.trim() : undefined,
    captureShortcut: buildShortcutValue("captureShortcut"),
    workflowShortcut: buildShortcutValue("workflowShortcut"),
    historyShortcut: buildShortcutValue("historyShortcut"),
    togglePinnedShortcut: buildShortcutValue("togglePinnedShortcut"),
    defaultClickThrough: elements.defaultClickThrough.checked,
    autoCopyToClipboard: elements.autoCopyToClipboard.checked,
    launchAtStartup: elements.launchAtStartup.checked,
    defaultSaveDirectory: elements.defaultSaveDirectory.value.trim(),
  };
}

function validateShortcutBuilders() {
  const missing = shortcutFields.filter((fieldName) => !buildShortcutValue(fieldName));
  if (missing.length) {
    setStatus("请为每个快捷键至少勾选一个修饰键，并输入 A-Z 字母", true);
    return false;
  }
  const values = shortcutFields.map((fieldName) => buildShortcutValue(fieldName));
  if (new Set(values).size !== values.length) {
    setStatus("快捷键不能重复，请修改后再保存", true);
    return false;
  }
  return true;
}

function bindShortcutBuilder(fieldName) {
  const row = getShortcutRow(fieldName);
  const input = elements[fieldName];
  if (!row || !input) return;
  row.querySelectorAll("[data-modifier]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => updateShortcutPreview(fieldName));
  });
  input.addEventListener("input", () => {
    const match = String(input.value || "").toUpperCase().match(/[A-Z]/);
    input.value = match ? match[0] : "";
    updateShortcutPreview(fieldName);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "Tab") return;
    if (!/^[a-z]$/i.test(event.key)) {
      event.preventDefault();
    }
  });
}

async function refreshShortcutState() {
  try {
    const state = await window.api.getShortcutRegistrationState();
    renderShortcutState(state || {});
  } catch (error) {
    window.api.reportError("settings:refreshShortcutState", error.message || String(error));
  }
}

async function chooseSaveDirectory() {
  try {
    const result = await window.api.chooseDirectory();
    if (result && result.ok && result.directoryPath) {
      elements.defaultSaveDirectory.value = result.directoryPath;
      setStatus("已选择默认保存位置");
    }
  } catch (error) {
    window.api.reportError("settings:chooseDirectory", error.message || String(error));
    setStatus(`选择目录失败：${error.message || error}`, true);
  }
}

async function saveSettings() {
  if (!validateShortcutBuilders()) return;
  setStatus("正在保存...");
  elements.saveButtons.forEach((btn) => { btn.disabled = true; });
  try {
    const result = await window.api.saveSettings(collectSettings());
    if (result && result.settings) applySettings(result.settings);
    renderShortcutState((result && result.shortcutState) || {});
    if (!result || result.ok !== true) throw new Error((result && result.error) || "保存失败");
    setStatus("设置已保存并已尝试重新注册快捷键");
  } catch (error) {
    window.api.reportError("settings:save", error.message || String(error));
    setStatus(`保存失败：${error.message || error}`, true);
  } finally {
    elements.saveButtons.forEach((btn) => { btn.disabled = false; });
  }
}

shortcutFields.forEach((fieldName) => bindShortcutBuilder(fieldName));
elements.browseSaveDirectoryBtn.addEventListener("click", () => chooseSaveDirectory());
elements.saveButtons.forEach((btn) => btn.addEventListener("click", () => saveSettings()));
elements.closeButtons.forEach((btn) => btn.addEventListener("click", () => window.api.closeSettings()));
window.api.onSettingsData((settings) => applySettings(settings));

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.api.closeSettings();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveSettings();
  }
});

(async function init() {
  try {
    const settings = await window.api.getSettings();
    applySettings(settings || {});
    await refreshShortcutState();
    setStatus("设置已加载");
  } catch (error) {
    window.api.reportError("settings:init", error.message || String(error));
    setStatus(`加载设置失败：${error.message || error}`, true);
  }
})();
