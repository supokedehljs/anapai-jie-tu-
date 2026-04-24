const img = document.getElementById("img");
const stage = document.getElementById("stage");
const frame = document.getElementById("frame");
const saveBtn = document.getElementById("saveBtn");
const runningStatus = document.getElementById("runningStatus");
const tabsBar = document.getElementById("tabsBar");

let currentDataUrl = "";
let currentImages = [];
let activeImageIndex = 0;
let naturalImageWidth = 0;
let naturalImageHeight = 0;
let imageLoadToken = 0;
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

async function resizePinByScale(scaleFactor) {
  const rect = stage.getBoundingClientRect();
  const nextWidth = Math.max(120, Math.round(rect.width * scaleFactor));
  const nextHeight = Math.max(80, Math.round(rect.height * scaleFactor));
  await window.api.setPinSize(nextWidth, nextHeight);
  requestAnimationFrame(resetFrameToStage);
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
    const scaleFactor = event.deltaY < 0 ? 1.1 : 0.9;
    await resizePinByScale(scaleFactor);
  },
  { passive: false }
);

frame.addEventListener("pointerdown", startDrag);
frame.addEventListener("pointermove", moveDrag);
frame.addEventListener("pointerup", endDrag);
frame.addEventListener("pointercancel", endDrag);

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
