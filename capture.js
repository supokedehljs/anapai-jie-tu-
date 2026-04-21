const bg = document.getElementById("bg");
const selection = document.getElementById("selection");
const btnConfirm = document.getElementById("confirm");
const btnCancel = document.getElementById("cancel");
const toolbar = document.getElementById("toolbar");

let fullImage = "";
let sourceImage = null;
let isSelecting = false;
let startX = 0;
let startY = 0;
let rect = null;
let pendingRect = null;
let selectionFrameId = 0;

function normalizeRect(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { left, top, width, height };
}

function renderSelectionBox(r) {
  selection.style.display = "block";
  selection.style.left = `${r.left}px`;
  selection.style.top = `${r.top}px`;
  selection.style.width = `${r.width}px`;
  selection.style.height = `${r.height}px`;
  selection.style.backgroundImage = `url(${fullImage})`;
  selection.style.backgroundSize = `${window.innerWidth}px ${window.innerHeight}px`;
  selection.style.backgroundPosition = `-${r.left}px -${r.top}px`;
}

function scheduleSelectionRender(r) {
  pendingRect = r;
  if (selectionFrameId) return;
  selectionFrameId = window.requestAnimationFrame(() => {
    selectionFrameId = 0;
    if (!pendingRect) return;
    renderSelectionBox(pendingRect);
  });
}

function cropImage() {
  if (!rect || rect.width < 4 || rect.height < 4) return null;
  if (!fullImage || !sourceImage) {
    throw new Error("未获取到屏幕图像，请重新截图");
  }
  const scaleX = sourceImage.naturalWidth / window.innerWidth;
  const scaleY = sourceImage.naturalHeight / window.innerHeight;

  const sx = Math.max(0, Math.floor(rect.left * scaleX));
  const sy = Math.max(0, Math.floor(rect.top * scaleY));
  const sw = Math.max(1, Math.floor(rect.width * scaleX));
  const sh = Math.max(1, Math.floor(rect.height * scaleY));

  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d");
  ctx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL("image/png");
}

async function init() {
  try {
    document.body.style.visibility = "hidden";
    const captureWidth = Math.floor(window.innerWidth * window.devicePixelRatio);
    const captureHeight = Math.floor(window.innerHeight * window.devicePixelRatio);
    fullImage = await window.api.getScreenImageDataUrl(captureWidth, captureHeight);
    sourceImage = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("截图图像解码失败，请重试"));
      img.src = fullImage;
    });
    bg.style.backgroundImage = `url(${fullImage})`;
    document.body.style.visibility = "visible";
  } catch (error) {
    window.api.reportError("capture:init", error.message || String(error));
    alert(`初始化截图失败：${error.message || error}`);
    window.api.closeCapture();
  }
}

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (toolbar.contains(e.target)) return;
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;
  rect = normalizeRect(startX, startY, startX, startY);
  scheduleSelectionRender(rect);
});

window.addEventListener("mousemove", (e) => {
  if (!isSelecting) return;
  rect = normalizeRect(startX, startY, e.clientX, e.clientY);
  scheduleSelectionRender(rect);
});

window.addEventListener("mouseup", () => {
  isSelecting = false;
});

btnCancel.addEventListener("click", () => window.api.closeCapture());
btnConfirm.addEventListener("click", async () => {
  try {
    const dataUrl = await cropImage();
    if (!dataUrl) {
      alert("请先拖拽选中一个区域再点击完成截图");
      return;
    }
    const selectionRect = {
      left: Math.round(rect.left + window.screenX),
      top: Math.round(rect.top + window.screenY),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
    window.api.captureComplete({ dataUrl, selectionRect });
  } catch (error) {
    window.api.reportError("capture:confirm", error.message || String(error));
    alert(`截图失败：${error.message || error}`);
  }
});

init();
