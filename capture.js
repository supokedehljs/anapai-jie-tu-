const bg = document.getElementById("bg");
const selection = document.getElementById("selection");
const selectionImage = document.getElementById("selectionImage");
const toolbar = document.getElementById("toolbar");
const btnCancel = document.getElementById("cancelBtn");
const btnCopy = document.getElementById("copyBtn");
const btnPin = document.getElementById("pinBtn");
const btnRun = document.getElementById("runBtn");
const sizeLabel = document.getElementById("sizeLabel");

let fullImage = "";
let sourceImage = null;
let displayInfo = null;
let rect = null;
let action = null;
let actionOriginRect = null;
let startX = 0;
let startY = 0;
let pendingRect = null;
let selectionFrameId = 0;
let completing = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { left, top, width, height };
}

function normalizeSquareRect(x1, y1, x2, y2) {
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const directionX = deltaX < 0 ? -1 : 1;
  const directionY = deltaY < 0 ? -1 : 1;
  const maxWidth = directionX > 0 ? window.innerWidth - x1 : x1;
  const maxHeight = directionY > 0 ? window.innerHeight - y1 : y1;
  const side = Math.min(Math.max(Math.abs(deltaX), Math.abs(deltaY)), maxWidth, maxHeight);
  const left = directionX > 0 ? x1 : x1 - side;
  const top = directionY > 0 ? y1 : y1 - side;
  return { left, top, width: side, height: side };
}

function normalizeBoundsRect(inputRect) {
  if (!inputRect) return null;
  const left = clamp(Math.round(inputRect.left || 0), 0, window.innerWidth);
  const top = clamp(Math.round(inputRect.top || 0), 0, window.innerHeight);
  const right = clamp(Math.round((inputRect.left || 0) + (inputRect.width || 0)), 0, window.innerWidth);
  const bottom = clamp(Math.round((inputRect.top || 0) + (inputRect.height || 0)), 0, window.innerHeight);
  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function isValidRect(nextRect) {
  return Boolean(nextRect && nextRect.width >= 4 && nextRect.height >= 4);
}

function updateToolbarPosition(nextRect) {
  if (!isValidRect(nextRect)) {
    toolbar.style.display = "none";
    sizeLabel.style.display = "none";
    return;
  }

  const toolbarWidth = toolbar.offsetWidth || 260;
  const toolbarHeight = toolbar.offsetHeight || 44;
  const labelWidth = sizeLabel.offsetWidth || 90;
  const topGap = 10;
  const bottomGap = 12;

  let toolbarLeft = clamp(nextRect.left + nextRect.width / 2 - toolbarWidth / 2, 12, window.innerWidth - toolbarWidth - 12);
  let toolbarTop = nextRect.top + nextRect.height + bottomGap;
  if (toolbarTop + toolbarHeight > window.innerHeight - 12) {
    toolbarTop = Math.max(12, nextRect.top - toolbarHeight - topGap);
  }

  let labelLeft = clamp(nextRect.left, 12, window.innerWidth - labelWidth - 12);
  let labelTop = nextRect.top - 34;
  if (labelTop < 12) {
    labelTop = nextRect.top + 10;
  }

  toolbar.style.display = "flex";
  toolbar.style.left = `${Math.round(toolbarLeft)}px`;
  toolbar.style.top = `${Math.round(toolbarTop)}px`;
  sizeLabel.style.display = "block";
  sizeLabel.style.left = `${Math.round(labelLeft)}px`;
  sizeLabel.style.top = `${Math.round(labelTop)}px`;
  sizeLabel.textContent = `${Math.round(nextRect.width)} × ${Math.round(nextRect.height)}`;
}

function renderSelectionBox(nextRect) {
  if (!isValidRect(nextRect)) {
    selection.style.display = "none";
    updateToolbarPosition(null);
    return;
  }

  selection.style.display = "block";
  selection.style.left = `${nextRect.left}px`;
  selection.style.top = `${nextRect.top}px`;
  selection.style.width = `${nextRect.width}px`;
  selection.style.height = `${nextRect.height}px`;
  selectionImage.style.backgroundImage = `url(${fullImage})`;
  selectionImage.style.backgroundSize = `${window.innerWidth}px ${window.innerHeight}px`;
  selectionImage.style.backgroundPosition = `-${nextRect.left}px -${nextRect.top}px`;
  updateToolbarPosition(nextRect);
}

function scheduleSelectionRender(nextRect) {
  pendingRect = nextRect;
  if (selectionFrameId) return;
  selectionFrameId = window.requestAnimationFrame(() => {
    selectionFrameId = 0;
    if (!pendingRect) return;
    renderSelectionBox(pendingRect);
  });
}

function cropImage() {
  if (!isValidRect(rect)) return null;
  if (!fullImage || !sourceImage) {
    throw new Error("未获取到屏幕图像，请重新截图");
  }

  const scaleX = sourceImage.naturalWidth / window.innerWidth;
  const scaleY = sourceImage.naturalHeight / window.innerHeight;
  const sx = Math.max(0, Math.floor(rect.left * scaleX));
  const sy = Math.max(0, Math.floor(rect.top * scaleY));
  const sw = Math.max(1, Math.floor(rect.width * scaleX));
  const sh = Math.max(1, Math.floor(rect.height * scaleY));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

function cancelCapture() {
  window.api.closeCapture();
}

function getSelectionRectOnScreen() {
  return {
    left: Math.round(rect.left + window.screenX),
    top: Math.round(rect.top + window.screenY),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

async function completeCapture(mode) {
  if (completing) return;
  try {
    const dataUrl = cropImage();
    if (!dataUrl) {
      alert("请先拖拽选中一个区域");
      return;
    }
    completing = true;
    if (mode === "copy") {
      await window.api.copyImageToClipboard(dataUrl);
      window.api.closeCapture();
      return;
    }
    window.api.captureComplete({
      dataUrl,
      selectionRect: getSelectionRectOnScreen(),
      runImmediately: mode === "run",
    });
  } catch (error) {
    completing = false;
    window.api.reportError(`capture:${mode}`, error.message || String(error));
    alert(`截图失败：${error.message || error}`);
  }
}

function updateRectByResize(direction, pointerX, pointerY) {
  const base = actionOriginRect;
  let left = base.left;
  let top = base.top;
  let right = base.left + base.width;
  let bottom = base.top + base.height;

  if (direction.includes("w")) left = clamp(pointerX, 0, right);
  if (direction.includes("e")) right = clamp(pointerX, left, window.innerWidth);
  if (direction.includes("n")) top = clamp(pointerY, 0, bottom);
  if (direction.includes("s")) bottom = clamp(pointerY, top, window.innerHeight);

  rect = normalizeBoundsRect({ left, top, width: right - left, height: bottom - top });
}

function updateRectByMove(pointerX, pointerY) {
  const deltaX = pointerX - startX;
  const deltaY = pointerY - startY;
  const maxLeft = window.innerWidth - actionOriginRect.width;
  const maxTop = window.innerHeight - actionOriginRect.height;
  rect = {
    left: clamp(Math.round(actionOriginRect.left + deltaX), 0, Math.max(0, maxLeft)),
    top: clamp(Math.round(actionOriginRect.top + deltaY), 0, Math.max(0, maxTop)),
    width: actionOriginRect.width,
    height: actionOriginRect.height,
  };
}

function pointerInsideRect(pointerX, pointerY, nextRect) {
  return nextRect && pointerX >= nextRect.left && pointerX <= nextRect.left + nextRect.width && pointerY >= nextRect.top && pointerY <= nextRect.top + nextRect.height;
}

async function initWithCaptureData(payload = {}) {
  try {
    displayInfo = payload.displayInfo || null;
    fullImage = String(payload.fullImage || "");
    if (!fullImage) {
      throw new Error("未收到屏幕图像，请重新截图");
    }
    sourceImage = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("截图图像解码失败，请重试"));
      img.src = fullImage;
    });
    bg.style.backgroundImage = `url(${fullImage})`;
    document.body.dataset.ready = "true";
  } catch (error) {
    window.api.reportError("capture:init", error.message || String(error));
    alert(`初始化截图失败：${error.message || error}`);
    cancelCapture();
  }
}

window.addEventListener("pointerdown", (event) => {
  if (!sourceImage) return;
  if (event.button === 2) {
    event.preventDefault();
    cancelCapture();
    return;
  }
  if (event.button !== 0) return;
  if (toolbar.contains(event.target)) return;

  const handle = event.target.closest(".handle");
  startX = event.clientX;
  startY = event.clientY;
  actionOriginRect = rect ? { ...rect } : null;

  if (handle && rect) {
    action = `resize:${handle.dataset.dir || "se"}`;
    selection.setPointerCapture(event.pointerId);
    return;
  }

  if (pointerInsideRect(event.clientX, event.clientY, rect)) {
    action = "move";
    selection.setPointerCapture(event.pointerId);
    return;
  }

  action = "create";
  rect = normalizeRect(startX, startY, startX, startY);
  scheduleSelectionRender(rect);
});

window.addEventListener("pointermove", (event) => {
  if (!action) return;
  if (action === "create") {
    const nextRect = event.shiftKey
      ? normalizeSquareRect(startX, startY, event.clientX, event.clientY)
      : normalizeRect(startX, startY, event.clientX, event.clientY);
    rect = normalizeBoundsRect(nextRect);
  } else if (action === "move") {
    updateRectByMove(event.clientX, event.clientY);
  } else if (action.startsWith("resize:")) {
    updateRectByResize(action.split(":")[1], event.clientX, event.clientY);
  }
  scheduleSelectionRender(rect);
});

window.addEventListener("pointerup", () => {
  action = null;
  actionOriginRect = rect ? { ...rect } : null;
  if (!isValidRect(rect)) {
    rect = null;
    scheduleSelectionRender(null);
  }
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  cancelCapture();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelCapture();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && isValidRect(rect)) {
    event.preventDefault();
    completeCapture("copy");
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t" && isValidRect(rect)) {
    event.preventDefault();
    completeCapture("pin");
    return;
  }
  if ((event.key === "Enter" || event.key === "NumpadEnter") && isValidRect(rect)) {
    event.preventDefault();
    completeCapture("pin");
  }
});

btnCancel.addEventListener("click", cancelCapture);
btnCopy.addEventListener("click", () => completeCapture("copy"));
btnPin.addEventListener("click", () => completeCapture("pin"));
btnRun.addEventListener("click", () => completeCapture("run"));

window.addEventListener("resize", () => {
  scheduleSelectionRender(rect);
});

window.api.onCaptureReadyData((payload) => initWithCaptureData(payload));
