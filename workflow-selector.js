const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const statusEl = document.getElementById("status");
const runBtn = document.getElementById("runBtn");
const closeBtn = document.getElementById("closeBtn");

let workflows = [];
let selectedFileName = "";
let running = false;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function updateRunButton() {
  runBtn.disabled = running || !selectedFileName;
}

function setStatus(message = "") {
  statusEl.textContent = message;
}

function render() {
  const hasItems = workflows.length > 0;
  empty.style.display = hasItems ? "none" : "flex";
  grid.style.display = hasItems ? "grid" : "none";

  if (!hasItems) {
    grid.innerHTML = "";
    updateRunButton();
    return;
  }

  grid.innerHTML = workflows
    .map((workflow) => {
      const isSelected = workflow.fileName === selectedFileName;
      const thumb = workflow.thumbnailDataUrl
        ? `<img src="${workflow.thumbnailDataUrl}" alt="${escapeHtml(workflow.name)}">`
        : `<div class="thumbPlaceholder">暂无缩略图</div>`;

      return `
        <div class="card${isSelected ? " selected" : ""}" data-file-name="${escapeHtml(workflow.fileName)}" tabindex="0">
          ${isSelected ? '<div class="selectedBadge">已选中</div>' : ""}
          <div class="thumb">${thumb}</div>
          <div class="name">${escapeHtml(workflow.name || workflow.fileName)}</div>
          <div class="file">${escapeHtml(workflow.fileName)}</div>
        </div>
      `;
    })
    .join("");

  updateRunButton();
}

async function selectWorkflow(fileName) {
  if (!fileName || running) return;
  selectedFileName = fileName;
  render();

  try {
    const result = await window.api.selectWorkflow(fileName);
    if (!result || result.ok !== true) {
      throw new Error((result && result.error) || "选择工作流失败");
    }
    const selectedWorkflow = workflows.find((item) => item.fileName === fileName);
    setStatus(`已选择工作流：${(selectedWorkflow && selectedWorkflow.name) || fileName}`);
  } catch (error) {
    window.api.reportError("workflow-selector:select", error.message || String(error));
    setStatus(`选择失败：${error.message || error}`);
  }
}

async function runSelectedWorkflow() {
  if (!selectedFileName || running) return;
  running = true;
  updateRunButton();
  setStatus("正在运行工作流，请稍候...");

  try {
    const result = await window.api.runSelectedWorkflow();
    if (!result || result.ok !== true) {
      throw new Error((result && result.error) || "运行工作流失败");
    }
    setStatus(`运行完成：${result.workflowName || selectedFileName}`);
    window.api.closeWorkflowSelector();
  } catch (error) {
    window.api.reportError("workflow-selector:run", error.message || String(error));
    setStatus(`运行失败：${error.message || error}`);
  } finally {
    running = false;
    updateRunButton();
  }
}

function applyWorkflows(nextWorkflows) {
  workflows = Array.isArray(nextWorkflows) ? nextWorkflows : [];
  const selected = workflows.find((item) => item.selected);
  selectedFileName = selected ? selected.fileName : workflows[0]?.fileName || "";
  render();
  if (selected) {
    setStatus(`当前已选：${selected.name || selected.fileName}`);
  } else if (selectedFileName) {
    setStatus("请选择一个工作流后运行。");
  } else {
    setStatus("");
  }
}

grid.addEventListener("click", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  selectWorkflow(card.dataset.fileName || "");
});

grid.addEventListener("keydown", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectWorkflow(card.dataset.fileName || "");
  }
});

runBtn.addEventListener("click", () => {
  runSelectedWorkflow();
});

closeBtn.addEventListener("click", () => {
  window.api.closeWorkflowSelector();
});

window.api.onWorkflowSelectionData((items) => {
  applyWorkflows(items);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.api.closeWorkflowSelector();
    return;
  }
  if ((event.key === "Enter" && selectedFileName) || (event.ctrlKey && event.key === "Enter")) {
    event.preventDefault();
    runSelectedWorkflow();
  }
});

(async function init() {
  try {
    const items = await window.api.getWorkflowSummaries();
    applyWorkflows(items);
  } catch (error) {
    window.api.reportError("workflow-selector:init", error.message || String(error));
    setStatus(`加载工作流失败：${error.message || error}`);
  }
})();
