const img = document.getElementById("img");
const stage = document.getElementById("stage");
const saveBtn = document.getElementById("saveBtn");
const runningStatus = document.getElementById("runningStatus");

let currentDataUrl = "";
let zoom = 1;
let baseImageWidth = 0;
let baseImageHeight = 0;
let dragState = null;
let pinWindowId = "";
let isSelected = false;

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

function getScaledSize(nextZoom = zoom) {
  const width = Math.max(120, Math.round(baseImageWidth * nextZoom));
  const height = Math.max(80, Math.round(baseImageHeight * nextZoom));
  return { width, height };
}

async function applyZoom() {
  if (!baseImageWidth || !baseImageHeight) return;
  const { width, height } = getScaledSize();
  await window.api.setPinSize(width, height);
}

async function setZoom(nextZoom) {
  zoom = Math.max(0.2, Math.min(6, Number(nextZoom.toFixed(2))));
  await applyZoom();
}

function shouldStartDrag(event) {
  return event.button === 0 && !event.target.closest("button");
}

function startDrag(event) {
  if (!shouldStartDrag(event)) return;
  requestSelection(event);
  event.preventDefault();
  dragState = {
    pointerId: event.pointerId,
  };
  stage.setPointerCapture(event.pointerId);
  window.api.startPinDrag({ screenX: event.screenX, screenY: event.screenY });
}

function moveDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  window.api.dragPin({ screenX: event.screenX, screenY: event.screenY });
}

function endDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  try {
    stage.releasePointerCapture(event.pointerId);
  } catch (_error) {
    // Ignore pointer capture release errors.
  }
  dragState = null;
  window.api.endPinDrag();
}

window.api.onSetImage((dataUrl) => {
  if (!dataUrl || typeof dataUrl !== "string") {
    window.api.reportError("pin:onSetImage", "invalid dataUrl");
    return;
  }
  currentDataUrl = dataUrl;
  zoom = 1;
  baseImageWidth = 0;
  baseImageHeight = 0;
  img.src = dataUrl;
});

saveBtn.addEventListener("click", async () => {
  requestSelection({});
  if (!currentDataUrl) return;
  try {
    const result = await window.api.saveImage(currentDataUrl);
    if (!result || result.ok !== true) {
      throw new Error((result && result.error) || "保存失败");
    }
    runningStatus.textContent = `已保存到：${result.filePath || "默认位置"}`;
    document.body.classList.add("show-running-status");
    setTimeout(() => {
      document.body.classList.remove("show-running-status");
    }, 3000);
  } catch (error) {
    window.api.reportError("pin:save", error.message || String(error));
    alert(`保存失败：${error.message || error}`);
  }
});

stage.addEventListener("dblclick", () => {
  window.api.closePin();
});

stage.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  requestSelection(event);
});

stage.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  requestSelection(event);
  if (!currentDataUrl) return;
  window.api.showPinContextMenu(currentDataUrl);
});

stage.addEventListener(
  "wheel",
  async (event) => {
    event.preventDefault();
    const step = event.deltaY < 0 ? 0.1 : -0.1;
    await setZoom(zoom + step);
  },
  { passive: false }
);

stage.addEventListener("pointerdown", startDrag);
stage.addEventListener("pointermove", moveDrag);
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);

img.addEventListener("load", async () => {
  baseImageWidth = img.naturalWidth || img.width || 0;
  baseImageHeight = img.naturalHeight || img.height || 0;
  zoom = 1;
  await applyZoom();
});

window.api.onRunningHubStatus((message) => {
  if (!message) return;
  runningStatus.textContent = message;
  document.body.classList.add("show-running-status");
  if (message.includes("生图完成") || message.includes("失败")) {
    setTimeout(() => {
      document.body.classList.remove("show-running-status");
    }, 4000);
  }
});

window.api.onPinSelectionState((payload) => {
  applySelectionState(Boolean(payload.selected));
});

window.api.onPinWindowMeta((payload) => {
  pinWindowId = String(payload.id || "");
});

window.addEventListener("keydown", (event) => {
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    window.api.openWorkflowSelector();
  }
  if ((event.key === "Enter" || event.key === "NumpadEnter") && pinWindowId) {
    event.preventDefault();
    requestSelection(event);
  }
});
