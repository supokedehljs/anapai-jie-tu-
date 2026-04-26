const historyGridEl = document.getElementById("historyGrid");
const emptyEl = document.getElementById("empty");
const summaryEl = document.getElementById("summary");
const refreshBtn = document.getElementById("refreshBtn");
const openFolderBtn = document.getElementById("openFolderBtn");
const closeBtn = document.getElementById("closeBtn");

function getAllHistoryImages(sessions = []) {
  return sessions.flatMap((session) => {
    const images = Array.isArray(session.images) ? session.images : [];
    return images.map((image) => ({
      ...image,
      sessionId: session.id,
      sessionDirName: session.dirName,
      sessionImageCount: images.length,
      sessionCreatedAt: session.createdAt,
    }));
  });
}

function renderHistory(sessions = []) {
  historyGridEl.innerHTML = "";
  const allImages = getAllHistoryImages(sessions);
  summaryEl.textContent = allImages.length
    ? `共 ${sessions.length} 次记录，${allImages.length} 张图片。点击任意图片会恢复同组截图和 AI 图。`
    : "查看所有截图和 AI 生成图片，点击图片可重新钉回屏幕";
  emptyEl.classList.toggle("show", allImages.length === 0);

  allImages.forEach((image) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.title = `点击恢复这一组 ${image.sessionImageCount || 1} 张图片`;

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.loading = "lazy";
    thumb.src = image.dataUrl;
    thumb.alt = image.fileName || "历史图片";

    card.appendChild(thumb);
    card.addEventListener("click", async () => {
      try {
        const result = await window.api.openHistoryImage(image.filePath);
        if (!result || result.ok !== true) {
          throw new Error((result && result.error) || "打开失败");
        }
      } catch (error) {
        window.api.reportError("history:open-image", error.message || String(error));
        alert(`打开历史图片失败：${error.message || error}`);
      }
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
openFolderBtn.addEventListener("click", () => window.api.openHistoryFolder());
closeBtn.addEventListener("click", () => window.api.closeHistory());
window.api.onHistoryData(renderHistory);

loadHistory();
