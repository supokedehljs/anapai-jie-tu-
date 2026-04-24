const img = document.getElementById("img");
const stage = document.getElementById("stage");
const frame = document.getElementById("frame");
const saveBtn = document.getElementById("saveBtn");
const runningStatus = document.getElementById("runningStatus");
const tabsBar = document.getElementById("tabsBar");

let currentDataUrl = "";
let currentImages = [];
let activeImageIndex = 0;
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
  activeImageIndex = nextIndex;
  currentDataUrl = currentImages[nextIndex];
  zoom = 1;
  baseImageWidth = 0;
  baseImageHeight = 0;
  updateTabSelection();
  img.src = currentDataUrl;
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
  return event.button === 0 && !event.target.closest("button");
}

function startDrag(event) {
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
    const step = event.deltaY < 0 ? 0.1 : -0.1;
    await setZoom(zoom + step);
  },
  { passive: false }
);

frame.addEventListener("pointerdown", startDrag);
frame.addEventListener("pointermove", moveDrag);
frame.addEventListener("pointerup", endDrag);
frame.addEventListener("pointercancel", endDrag);

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

window.addEventListener("keydown", async (event) => {
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
