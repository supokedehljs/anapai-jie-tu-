const img = document.getElementById("img");
const stage = document.getElementById("stage");
const saveBtn = document.getElementById("saveBtn");
const recaptureBtn = document.getElementById("recaptureBtn");
const clickThroughBtn = document.getElementById("clickThroughBtn");
const closeBtn = document.getElementById("closeBtn");
const runningStatus = document.getElementById("runningStatus");

let currentDataUrl = "";
let clickThrough = false;
let zoom = 1;

function updateClickThroughUI() {
  document.body.classList.toggle("click-through", clickThrough);
  document.body.classList.toggle("toolbar-force", !clickThrough);
  clickThroughBtn.textContent = clickThrough ? "取消穿透" : "鼠标穿透";
}

function applyZoom() {
  img.style.transform = `scale(${zoom})`;
}

async function toggleClickThrough() {
  try {
    clickThrough = await window.api.setPinClickThrough(!clickThrough);
    updateClickThroughUI();
  } catch (error) {
    window.api.reportError("pin:toggleClickThrough", error.message || String(error));
  }
}

window.api.onSetImage((dataUrl) => {
  if (!dataUrl || typeof dataUrl !== "string") {
    window.api.reportError("pin:onSetImage", "invalid dataUrl");
    return;
  }
  currentDataUrl = dataUrl;
  zoom = 1;
  applyZoom();
  img.src = dataUrl;
});
window.api.onPinClickThroughState((enabled) => {
  clickThrough = Boolean(enabled);
  updateClickThroughUI();
});

saveBtn.addEventListener("click", async () => {
  if (!currentDataUrl) return;
  try {
    await window.api.saveImage(currentDataUrl);
  } catch (error) {
    window.api.reportError("pin:save", error.message || String(error));
    alert(`保存失败：${error.message || error}`);
  }
});

recaptureBtn.addEventListener("click", () => {
  window.api.recapture();
});

clickThroughBtn.addEventListener("click", () => {
  toggleClickThrough();
});

closeBtn.addEventListener("click", () => {
  window.api.closePin();
});

stage.addEventListener("dblclick", () => {
  window.api.closePin();
});

stage.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (!currentDataUrl) return;
  window.api.showPinContextMenu(currentDataUrl);
});

stage.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const step = event.deltaY < 0 ? 0.1 : -0.1;
    zoom = Math.max(0.2, Math.min(6, Number((zoom + step).toFixed(2))));
    applyZoom();
  },
  { passive: false }
);

img.addEventListener("load", () => {
  zoom = 1;
  applyZoom();
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

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.api.closePin();
  }
});
