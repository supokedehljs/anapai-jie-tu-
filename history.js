const historyGridEl = document.getElementById("historyGrid");
const emptyEl = document.getElementById("empty");
const summaryEl = document.getElementById("summary");
const refreshBtn = document.getElementById("refreshBtn");
const openFolderBtn = document.getElementById("openFolderBtn");
const closeBtn = document.getElementById("closeBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");

function formatSessionTime(isoString) {
  try {
    const d = new Date(isoString);
    const pad = (v) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (_) {
    return "";
  }
}

let selectedSessionIds = new Set();
let currentSessions = [];

function updateDeleteButton() {
  if (deleteSelectedBtn) {
    deleteSelectedBtn.disabled = selectedSessionIds.size === 0;
  }
}

function toggleSelection(sessionId) {
  if (selectedSessionIds.has(sessionId)) {
    selectedSessionIds.delete(sessionId);
  } else {
    selectedSessionIds.add(sessionId);
  }
  updateDeleteButton();
  renderHistory(currentSessions);
}

async function openSession(filePath) {
  try {
    const result = await window.api.openHistoryImage(filePath);
    if (!result || result.ok !== true) {
      throw new Error((result && result.error) || "打开失败");
    }
  } catch (error) {
    window.api.reportError("history:open-image", error.message || String(error));
    alert(`打开历史图片失败：${error.message || error}`);
  }
}

let historyFolderPath = "";

function renderHistory(sessions = []) {
  currentSessions = sessions;
  historyGridEl.innerHTML = "";
  const totalImages = sessions.reduce((sum, s) => sum + (s.images || []).length, 0);
  const pathInfo = historyFolderPath ? ` | 目录: ${historyFolderPath}` : "";
  summaryEl.textContent = sessions.length
    ? `共 ${sessions.length} 组记录，${totalImages} 张图片。单击选中，双击打开。${pathInfo}`
    : `查看所有截图和 AI 生成图片，点击图片可重新钉回屏幕。${pathInfo}`;
  emptyEl.classList.toggle("show", sessions.length === 0);

  sessions.forEach((session) => {
    const images = session.images || [];
    const firstImage = images[0];
    if (!firstImage) return;

    const isSelected = selectedSessionIds.has(session.id);

    const card = document.createElement("div");
    card.className = "card group-card" + (isSelected ? " selected" : "");
    card.style.position = "relative";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb-wrap";

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.loading = "lazy";
    thumb.src = firstImage.dataUrl;
    thumb.alt = firstImage.fileName || "历史图片";

    thumbWrap.appendChild(thumb);

if (images.length > 1) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = images.length;
      thumbWrap.appendChild(badge);
    }

    card.appendChild(thumbWrap);

    const label = document.createElement("div");
    label.className = "group-label";
    label.textContent = formatSessionTime(session.createdAt);
    card.appendChild(label);

    card.addEventListener("click", () => {
      toggleSelection(session.id);
    });

    card.addEventListener("dblclick", () => {
      openSession(firstImage.filePath);
    });

    historyGridEl.appendChild(card);
  });
}

async function loadHistory() {
  try {
    const sessions = await window.api.getHistorySessions();
    renderHistory(Array.isArray(sessions) ? sessions : []);
  } catch (error) {
    window.api.reportError("history:load", error.message || String(error));
    renderHistory([]);
  }
}

refreshBtn.addEventListener("click", loadHistory);
openFolderBtn.addEventListener("click", async () => {
  await window.api.openHistoryFolder();
});
closeBtn.addEventListener("click", () => window.api.closeHistory());
window.api.onHistoryData(renderHistory);

deleteSelectedBtn?.addEventListener("click", async () => {
  if (!selectedSessionIds.size) return;
  const idsToDelete = Array.from(selectedSessionIds);
  console.log("Deleting session IDs:", idsToDelete);
  try {
    const result = await window.api.deleteHistorySessions(idsToDelete);
    console.log("Delete result:", result);
    selectedSessionIds.clear();
    updateDeleteButton();
    loadHistory();
  } catch (e) {
    window.api.reportError("history:delete-selected", e?.message || String(e));
    console.error("Delete error:", e);
  }
});

(async () => {
  try {
    historyFolderPath = await window.api.getHistoryFolderPath();
    loadHistory();
  } catch (e) {
    loadHistory();
  }
})();