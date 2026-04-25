const img = document.getElementById("img");
const stage = document.getElementById("stage");
const frame = document.getElementById("frame");
const saveBtn = document.getElementById("saveBtn");
const runningStatus = document.getElementById("runningStatus");
const runningStatusLeft = document.getElementById("runningStatusLeft");
const runningStatusRight = document.getElementById("runningStatusRight");
const errorStatusTitle = document.getElementById("errorStatusTitle");
const errorStatusMessage = document.getElementById("errorStatusMessage");
const errorStatusClose = document.getElementById("errorStatusClose");
const tabsBar = document.getElementById("tabsBar");
const scaleAnchor = document.getElementById("scaleAnchor");

let currentDataUrl = "";
let currentImages = [];
let activeImageIndex = 0;
let naturalImageWidth = 0;
let naturalImageHeight = 0;
let imageLoadToken = 0;
let dragState = null;
let pinWindowId = "";
let isSelected = false;
let runningCountdownTimer = null;
let runningCountdownPayload = null;
let altAdjusting = false;
let scaleAnchorPoint = { x: 0.5, y: 0.5 };
let scaleAnchorPinned = false;
let lastPointerPosition = null;
let ctrlFileDragStarted = false;
let pendingScaleFactor = 1;
let pendingScaleOptions = null;
let scaleFrameRequest = 0;
let scaleInFlight = false;

function scheduleScaleOperation(scaleFactor, options = {}) {
  pendingScaleFactor *= scaleFactor;
  pendingScaleOptions = { ...options };
  if (scaleFrameRequest || scaleInFlight) return;
  scaleFrameRequest = requestAnimationFrame(async () => {
    scaleFrameRequest = 0;
    const factor = pendingScaleFactor;
    const nextOptions = pendingScaleOptions || {};
    pendingScaleFactor = 1;
    pendingScaleOptions = null;
    scaleInFlight = true;
    try {
      await resizePinByScale(factor, nextOptions);
    } finally {
      scaleInFlight = false;
      if (Math.abs(pendingScaleFactor - 1) > 0.0001) {
        scheduleScaleOperation(1, pendingScaleOptions || nextOptions);
      }
    }
  });
}

function updateScaleAnchorVisual() {
  const rect = stage.getBoundingClientRect();
  const x = scaleAnchorPoint.x * rect.width;
  const y = scaleAnchorPoint.y * rect.height;
  scaleAnchor.style.left = `${x}px`;
  scaleAnchor.style.top = `${y}px`;
}

function setAltAdjusting(enabled) {
  altAdjusting = Boolean(enabled);
  document.body.classList.toggle("alt-adjusting", altAdjusting);
  window.api.setPinOpacity(altAdjusting ? 0.72 : 1);
  if (altAdjusting) updateScaleAnchorVisual();
}

function setScaleAnchorFromEvent(event, options = {}) {
  const rect = stage.getBoundingClientRect();
  scaleAnchorPoint = {
    x: Math.min(1, Math.max(0, event.clientX / Math.max(1, rect.width))),
    y: Math.min(1, Math.max(0, event.clientY / Math.max(1, rect.height))),
  };
  if (options.pin) {
    scaleAnchorPinned = true;
    document.body.classList.add("scale-anchor-pinned", "scale-anchor-pulse");
    setTimeout(() => document.body.classList.remove("scale-anchor-pulse"), 260);
  }
  updateScaleAnchorVisual();
}

function setRunningStatus(left = "", right = "") {
  runningStatusLeft.textContent = left;
  runningStatusRight.textContent = right;
  document.body.classList.toggle("show-running-status", Boolean(left || right));
}

function showPersistentError(payload = {}) {
  stopRunningCountdown();
  setRunningStatus("", "");
  errorStatusTitle.textContent = payload.title || "运行失败";
  errorStatusMessage.textContent = payload.message || "发生未知错误";
  document.body.classList.add("show-error-status");
}

function clearPersistentError() {
  document.body.classList.remove("show-error-status");
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}秒`;
  return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

function stopRunningCountdown(delay = 0) {
  if (runningCountdownTimer) {
    clearInterval(runningCountdownTimer);
    runningCountdownTimer = null;
  }
  runningCountdownPayload = null;
  if (delay > 0) {
    setTimeout(() => {
      setRunningStatus("", "");
    }, delay);
  }
}

function renderRunningCountdown() {
  if (!runningCountdownPayload) return;
  const startedAt = Number(runningCountdownPayload.startedAt) || Date.now();
  const estimatedDurationMs = Math.max(1000, Number(runningCountdownPayload.estimatedDurationMs) || 180000);
  const remainingMs = Math.max(0, estimatedDurationMs - (Date.now() - startedAt));
  const workflowName = runningCountdownPayload.workflowName || "当前工作流";
  const prefix = runningCountdownPayload.prefix ? `${runningCountdownPayload.prefix} · ` : "";
  setRunningStatus(`${prefix}${workflowName}`, `预计 ${formatRemainingTime(remainingMs)}`);
}

function startRunningCountdown(payload = {}) {
  if (runningCountdownTimer) clearInterval(runningCountdownTimer);
  runningCountdownPayload = {
    ...payload,
    startedAt: Number(payload.startedAt) || Date.now(),
    estimatedDurationMs: Number(payload.estimatedDurationMs) || 180000,
  };
  renderRunningCountdown();
  runningCountdownTimer = setInterval(renderRunningCountdown, 1000);
}

function applySelectionState(nextSelected) {
  isSelected = Boolean(nextSelected);
  document.body.classList.toggle("selected", isSelected);
}

function shouldUseAdditiveSelection(event) {
  return Boolean(event.ctrlKey || event.metaKey || event.shiftKey);
}

function requestSelection(event) {
  window.api.selectPin({ additive: shouldUseAdditiveSelection(event) });
}

function resetFrameToStage() {
  frame.style.left = "0px";
  frame.style.top = "0px";
  frame.style.width = "100%";
  frame.style.height = "100%";
}

async function fitWindowToCurrentImage() {
  if (!naturalImageWidth || !naturalImageHeight) return;
  await window.api.fitPinToImage(naturalImageWidth, naturalImageHeight);
  requestAnimationFrame(resetFrameToStage);
}

async function updateDisplayedImage(dataUrl) {
  const token = ++imageLoadToken;
  img.src = dataUrl;

  try {
    if (typeof img.decode === "function") {
      await img.decode();
    }
  } catch (_error) {
  }

  if (token !== imageLoadToken || dataUrl !== currentDataUrl) return;
  naturalImageWidth = img.naturalWidth || img.width || 0;
  naturalImageHeight = img.naturalHeight || img.height || 0;
  await fitWindowToCurrentImage();
}

async function resizePinByScale(scaleFactor, options = {}) {
  const rect = stage.getBoundingClientRect();
  const shouldUseAnchor = options.useAnchor !== false;
  if (shouldUseAnchor) {
    await window.api.scalePinAt({
      scaleFactor,
      anchorRatioX: scaleAnchorPoint.x,
      anchorRatioY: scaleAnchorPoint.y,
    });
  } else {
    const nextWidth = Math.max(120, Math.round(rect.width * scaleFactor));
    const nextHeight = Math.max(80, Math.round(rect.height * scaleFactor));
    await window.api.setPinSize(nextWidth, nextHeight);
  }
  requestAnimationFrame(updateScaleAnchorVisual);
}

function updateTabSelection() {
  const tabElements = tabsBar.querySelectorAll(".tab");
  tabElements.forEach((tabElement) => {
    const tabIndex = Number(tabElement.dataset.index || -1);
    const isActive = tabIndex === activeImageIndex;
    tabElement.classList.toggle("active", isActive);
    tabElement.setAttribute("aria-selected", String(isActive));
  });
}

async function switchToImage(index, options = {}) {
  const nextIndex = Math.max(0, Math.min(currentImages.length - 1, Number(index) || 0));
  if (!currentImages.length || !currentImages[nextIndex]) return;
  const nextDataUrl = currentImages[nextIndex];
  activeImageIndex = nextIndex;
  currentDataUrl = nextDataUrl;
  updateTabSelection();
  updateDisplayedImage(nextDataUrl);
  if (!options.skipSync) {
    await window.api.switchPinImage(nextIndex);
  }
}

function renderTabs() {
  tabsBar.innerHTML = "";
  const shouldShowTabs = currentImages.length > 1;
  document.body.classList.toggle("has-tabs", shouldShowTabs);
  if (!shouldShowTabs) return;

  currentImages.forEach((_image, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab";
    tab.dataset.index = String(index);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-label", `图片 ${index + 1}`);
    tab.textContent = String(index + 1);
    tab.addEventListener("click", async (event) => {
      event.stopPropagation();
      requestSelection(event);
      await switchToImage(index);
    });
    tabsBar.appendChild(tab);
  });

  updateTabSelection();
}

function applyImagePayload(payload) {
  if (typeof payload === "string") {
    currentImages = payload ? [payload] : [];
    activeImageIndex = 0;
  } else if (payload && typeof payload === "object") {
    currentImages = Array.isArray(payload.images)
      ? payload.images.filter((item) => typeof item === "string" && item)
      : [];
    activeImageIndex = Math.max(
      0,
      Math.min(currentImages.length - 1, Number(payload.activeIndex) || 0)
    );
  } else {
    currentImages = [];
    activeImageIndex = 0;
  }

  renderTabs();

  if (!currentImages.length) {
    window.api.reportError("pin:onSetImage", "invalid image payload");
    return;
  }

  switchToImage(activeImageIndex, { skipSync: true });
}

function shouldStartDrag(event) {
  return event.button === 0 && !event.target.closest("button") && !event.altKey;
}

function startDrag(event) {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  if (event.altKey) {
    event.preventDefault();
    requestSelection(event);
    setAltAdjusting(true);
    setScaleAnchorFromEvent(event, { pin: true });
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    requestSelection(event);
    ctrlFileDragStarted = true;
    if (currentDataUrl) window.api.startDragImageFile(currentDataUrl);
    return;
  }
  if (!shouldStartDrag(event)) return;
  requestSelection(event);
  event.preventDefault();
  dragState = {
    pointerId: event.pointerId,
  };
  frame.setPointerCapture(event.pointerId);
  window.api.startPinDrag({ screenX: event.screenX, screenY: event.screenY });
}

function moveDrag(event) {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  if ((altAdjusting || event.altKey) && !dragState && !scaleAnchorPinned) {
    setScaleAnchorFromEvent(event);
  }
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  window.api.dragPin({ screenX: event.screenX, screenY: event.screenY });
}

function endDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  try {
    frame.releasePointerCapture(event.pointerId);
  } catch (_error) {
  }
  dragState = null;
  ctrlFileDragStarted = false;
  window.api.endPinDrag();
}

window.api.onSetImage((payload) => {
  applyImagePayload(payload);
});

saveBtn.addEventListener("click", async () => {
  requestSelection({});
  if (!currentDataUrl) return;
  try {
    const result = await window.api.saveImage(currentDataUrl);
    if (!result || result.ok !== true) {
      throw new Error((result && result.error) || "保存失败");
    }
    setRunningStatus(`已保存到：${result.filePath || "默认位置"}`, "");
    setTimeout(() => {
      setRunningStatus("", "");
    }, 3000);
  } catch (error) {
    window.api.reportError("pin:save", error.message || String(error));
    alert(`保存失败：${error.message || error}`);
  }
});

frame.addEventListener("dblclick", () => {
  window.api.closePin();
});

stage.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  requestSelection(event);
});

frame.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  requestSelection(event);
  if (!currentDataUrl) return;
  window.api.showPinContextMenu(currentDataUrl);
});

frame.addEventListener(
  "wheel",
  async (event) => {
    event.preventDefault();
    if (event.altKey) {
      const direction = event.deltaY < 0 ? 1 : -1;
      const scaleFactor = 1 + direction * 0.025;
      scheduleScaleOperation(scaleFactor, { useAnchor: true });
      return;
    }
    const scaleFactor = event.deltaY < 0 ? 1.1 : 0.9;
    scheduleScaleOperation(scaleFactor);
  },
  { passive: false }
);

frame.addEventListener("pointerdown", startDrag);
frame.addEventListener("pointermove", moveDrag);
frame.addEventListener("pointerup", endDrag);
frame.addEventListener("pointercancel", endDrag);
errorStatusClose.addEventListener("click", clearPersistentError);
window.addEventListener("pointermove", (event) => {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
  if (event.altKey && !altAdjusting) {
    setAltAdjusting(true);
  }
  if (altAdjusting || event.altKey) {
    if (!scaleAnchorPinned) setScaleAnchorFromEvent(event);
  }
});

img.addEventListener("load", async () => {
  if (img.src !== currentDataUrl) return;
  naturalImageWidth = img.naturalWidth || img.width || 0;
  naturalImageHeight = img.naturalHeight || img.height || 0;
  await fitWindowToCurrentImage();
});

if (typeof ResizeObserver === "function") {
  const resizeObserver = new ResizeObserver(() => resetFrameToStage());
  resizeObserver.observe(stage);
} else {
  window.addEventListener("resize", resetFrameToStage);
}

window.api.onRunningHubStatus((message) => {
  if (!message) return;
  stopRunningCountdown();
  setRunningStatus(message, "");
  if (message.includes("生图完成")) {
    setTimeout(() => {
      setRunningStatus("", "");
    }, 4000);
  }
  if (message.includes("失败")) {
    showPersistentError({ title: "运行失败", message });
  }
});

window.api.onRunningHubProgress((payload) => {
  if (!payload || typeof payload !== "object") return;
  if (payload.state === "running") {
    startRunningCountdown(payload);
    return;
  }
  if (payload.state === "done") {
    stopRunningCountdown();
    setRunningStatus(payload.workflowName || "工作流", "已完成");
    stopRunningCountdown(3500);
    return;
  }
  if (payload.state === "error") {
    stopRunningCountdown();
    showPersistentError({
      title: payload.title || `${payload.workflowName || "工作流"} · 失败`,
      message: payload.message || "运行失败，但没有返回详细原因。",
    });
  }
});

window.api.onPinSelectionState((payload) => {
  applySelectionState(Boolean(payload.selected));
});

window.api.onPinWindowMeta((payload) => {
  pinWindowId = String(payload.id || "");
});

window.addEventListener("keydown", async (event) => {
  if (event.key === "Alt") {
    setAltAdjusting(true);
    if (lastPointerPosition) {
      const syntheticEvent = { clientX: lastPointerPosition.x, clientY: lastPointerPosition.y };
      if (!scaleAnchorPinned) setScaleAnchorFromEvent(syntheticEvent);
    }
  }
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    window.api.openWorkflowSelector();
    return;
  }
  if ((event.key === "Enter" || event.key === "NumpadEnter") && pinWindowId) {
    event.preventDefault();
    requestSelection(event);
    return;
  }
  if (event.key === "ArrowLeft" && currentImages.length > 1) {
    event.preventDefault();
    requestSelection(event);
    await switchToImage(activeImageIndex - 1);
    return;
  }
  if (event.key === "ArrowRight" && currentImages.length > 1) {
    event.preventDefault();
    requestSelection(event);
    await switchToImage(activeImageIndex + 1);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "Alt") {
    setAltAdjusting(false);
  }
});

window.addEventListener("blur", () => {
  setAltAdjusting(false);
  ctrlFileDragStarted = false;
});
