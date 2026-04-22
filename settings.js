const elements = {
  apiKey: document.getElementById("apiKey"),
  uploadUrl: document.getElementById("uploadUrl"),
  createTaskUrl: document.getElementById("createTaskUrl"),
  taskStatusUrl: document.getElementById("taskStatusUrl"),
  webhookDetailUrl: document.getElementById("webhookDetailUrl"),
  captureShortcut: document.getElementById("captureShortcut"),
  togglePinnedShortcut: document.getElementById("togglePinnedShortcut"),
  defaultClickThrough: document.getElementById("defaultClickThrough"),
  autoCopyToClipboard: document.getElementById("autoCopyToClipboard"),
  launchAtStartup: document.getElementById("launchAtStartup"),
  defaultSaveDirectory: document.getElementById("defaultSaveDirectory"),
  browseSaveDirectoryBtn: document.getElementById("browseSaveDirectoryBtn"),
  shortcutState: document.getElementById("shortcutState"),
  status: document.getElementById("status"),
  saveBtn: document.getElementById("saveBtn"),
  closeBtn: document.getElementById("closeBtn"),
  navButtons: Array.from(document.querySelectorAll(".navButton")),
  sections: Array.from(document.querySelectorAll(".section")),
};

const shortcutInputs = [elements.captureShortcut, elements.togglePinnedShortcut];
let recordingInput = null;

function setStatus(message = "", isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", Boolean(isError));
}

function getShortcutBadgeText(ok) {
  return ok ? "已注册" : "未注册或冲突";
}

function renderShortcutState(state = {}) {
  const captureOk = Boolean(state.captureRegistered);
  const toggleOk = Boolean(state.togglePinnedRegistered);
  elements.shortcutState.innerHTML = [
    `<div class="statusCard"><strong>区域截图 · ${getShortcutBadgeText(captureOk)}</strong><div class="statusValue">${state.captureShortcut || "-"}</div></div>`,
    `<div class="statusCard"><strong>显示/隐藏贴图 · ${getShortcutBadgeText(toggleOk)}</strong><div class="statusValue">${state.togglePinnedShortcut || "-"}</div></div>`,
  ].join("");
}

function applySettings(settings = {}) {
  elements.apiKey.value = settings.apiKey || "";
  elements.uploadUrl.value = settings.uploadUrl || "";
  elements.createTaskUrl.value = settings.createTaskUrl || "";
  elements.taskStatusUrl.value = settings.taskStatusUrl || "";
  elements.webhookDetailUrl.value = settings.webhookDetailUrl || "";
  elements.captureShortcut.value = settings.captureShortcut || "";
  elements.togglePinnedShortcut.value = settings.togglePinnedShortcut || "";
  elements.defaultClickThrough.checked = Boolean(settings.defaultClickThrough);
  elements.autoCopyToClipboard.checked = Boolean(settings.autoCopyToClipboard);
  elements.launchAtStartup.checked = Boolean(settings.launchAtStartup);
  elements.defaultSaveDirectory.value = settings.defaultSaveDirectory || "";
}

function collectSettings() {
  return {
    apiKey: elements.apiKey.value.trim(),
    uploadUrl: elements.uploadUrl.value.trim(),
    createTaskUrl: elements.createTaskUrl.value.trim(),
    taskStatusUrl: elements.taskStatusUrl.value.trim(),
    webhookDetailUrl: elements.webhookDetailUrl.value.trim(),
    captureShortcut: elements.captureShortcut.value.trim(),
    togglePinnedShortcut: elements.togglePinnedShortcut.value.trim(),
    defaultClickThrough: elements.defaultClickThrough.checked,
    autoCopyToClipboard: elements.autoCopyToClipboard.checked,
    launchAtStartup: elements.launchAtStartup.checked,
    defaultSaveDirectory: elements.defaultSaveDirectory.value.trim(),
  };
}

function activateSection(targetId) {
  elements.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.target === targetId);
  });
  elements.sections.forEach((section) => {
    section.classList.toggle("active", section.id === targetId);
  });
}

function keyEventToAccelerator(event) {
  const key = event.key;
  const code = event.code;

  if (["Control", "Shift", "Alt", "Meta"].includes(key)) {
    return "";
  }

  const parts = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push("CommandOrControl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }

  let mainKey = "";

  if (/^Key[A-Z]$/.test(code)) {
    mainKey = code.slice(3);
  } else if (/^Digit\d$/.test(code)) {
    mainKey = code.slice(5);
  } else if (/^F\d{1,2}$/i.test(key)) {
    mainKey = key.toUpperCase();
  } else {
    const map = {
      Escape: "Escape",
      Enter: "Enter",
      Tab: "Tab",
      Backspace: "Backspace",
      Delete: "Delete",
      Insert: "Insert",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Space: "Space",
      " ": "Space",
      Minus: "-",
      Equal: "=",
      BracketLeft: "[",
      BracketRight: "]",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Backslash: "\\",
      Backquote: "`",
    };

    mainKey = map[code] || map[key] || "";

    if (!mainKey && typeof key === "string" && key.length === 1) {
      mainKey = key.toUpperCase();
    }
  }

  if (!mainKey) {
    return "";
  }

  const hasModifier = parts.length > 0;
  const isFunctionKey = /^F\d{1,2}$/.test(mainKey);
  if (!hasModifier && !isFunctionKey) {
    return "";
  }

  return [...parts, mainKey].join("+");
}

function stopShortcutRecording(commit = false, nextValue = "") {
  if (!recordingInput) return;
  const input = recordingInput;
  input.dataset.recording = "false";
  input.blur();
  if (commit) {
    input.value = nextValue;
  } else {
    input.value = input.dataset.previousValue || input.value || "";
  }
  recordingInput = null;
}

function startShortcutRecording(input) {
  if (!input) return;
  if (recordingInput && recordingInput !== input) {
    stopShortcutRecording(false);
  }
  recordingInput = input;
  input.dataset.previousValue = input.value;
  input.dataset.recording = "true";
  input.value = "请按下快捷键...";
  input.focus();
  setStatus("请直接按下快捷键。Backspace/Delete 清空，Escape 取消。", false);
}

function bindShortcutRecorder(input) {
  if (!input) return;

  input.addEventListener("click", () => {
    startShortcutRecording(input);
  });

  input.addEventListener("focus", () => {
    if (recordingInput !== input) {
      startShortcutRecording(input);
    }
  });

  input.addEventListener("blur", () => {
    if (recordingInput === input) {
      stopShortcutRecording(false);
      setStatus("快捷键录制已取消", false);
    }
  });

  input.addEventListener("keydown", (event) => {
    if (recordingInput !== input) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      stopShortcutRecording(false);
      setStatus("已取消本次快捷键录制", false);
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      stopShortcutRecording(true, "");
      setStatus("快捷键已清空，保存后生效", false);
      return;
    }

    const accelerator = keyEventToAccelerator(event);
    if (!accelerator) {
      setStatus("请至少包含一个修饰键，或直接使用 F1-F12 这类功能键", true);
      return;
    }

    stopShortcutRecording(true, accelerator);
    setStatus(`已录入快捷键：${accelerator}`);
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
  if (recordingInput) {
    stopShortcutRecording(false);
  }
  setStatus("正在保存...");
  elements.saveBtn.disabled = true;
  try {
    const result = await window.api.saveSettings(collectSettings());
    if (result && result.settings) {
      applySettings(result.settings);
    }
    renderShortcutState((result && result.shortcutState) || {});
    if (!result || result.ok !== true) {
      throw new Error((result && result.error) || "保存失败");
    }
    setStatus("设置已保存并已尝试重新注册快捷键");
  } catch (error) {
    window.api.reportError("settings:save", error.message || String(error));
    setStatus(`保存失败：${error.message || error}`, true);
  } finally {
    elements.saveBtn.disabled = false;
  }
}

elements.navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateSection(button.dataset.target || "section-runninghub");
  });
});

shortcutInputs.forEach((input) => {
  bindShortcutRecorder(input);
});

elements.browseSaveDirectoryBtn.addEventListener("click", () => {
  chooseSaveDirectory();
});

elements.saveBtn.addEventListener("click", () => {
  saveSettings();
});

elements.closeBtn.addEventListener("click", () => {
  window.api.closeSettings();
});

window.api.onSettingsData((settings) => {
  applySettings(settings);
});

window.addEventListener("keydown", (event) => {
  if (recordingInput) {
    return;
  }
  if (event.key === "Escape") {
    window.api.closeSettings();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveSettings();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key >= "1" && event.key <= "3") {
    event.preventDefault();
    const index = Number(event.key) - 1;
    const button = elements.navButtons[index];
    if (button) {
      activateSection(button.dataset.target || "section-runninghub");
    }
  }
});

(async function init() {
  try {
    const settings = await window.api.getSettings();
    applySettings(settings || {});
    activateSection("section-runninghub");
    await refreshShortcutState();
    setStatus("设置已加载");
  } catch (error) {
    window.api.reportError("settings:init", error.message || String(error));
    setStatus(`加载设置失败：${error.message || error}`, true);
  }
})();
