const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const statusEl = document.getElementById("status");
const runBtn = document.getElementById("runBtn");
const uploadBtn = document.getElementById("uploadBtn");
const closeBtn = document.getElementById("closeBtn");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalHint = document.getElementById("modalHint");
const workflowForm = document.getElementById("workflowForm");
const saveWorkflowBtn = document.getElementById("saveWorkflowBtn");
const cancelWorkflowBtn = document.getElementById("cancelWorkflowBtn");

const formElements = {
  fileName: document.getElementById("workflowFileName"),
  displayName: document.getElementById("workflowDisplayName"),
  workflowId: document.getElementById("workflowId"),
  imageNodeId: document.getElementById("imageNodeId"),
  imageFieldName: document.getElementById("imageFieldName"),
};

let workflows = [];
let selectedFileName = "";
let running = false;
let modalMode = "import";
let editingFileName = "";

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
  uploadBtn.disabled = running;
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
        <div class="card${isSelected ? " selected" : ""}" data-file-name="${escapeHtml(workflow.fileName)}" tabindex="0" title="左键选择，右键编辑配置">
          ${isSelected ? '<div class="selectedBadge">已选中</div>' : ""}
          <div class="thumb">${thumb}</div>
          <div class="name">${escapeHtml(workflow.name || workflow.fileName)}</div>
          <div class="metaRow">
            <span class="metaTag">节点 #${escapeHtml(workflow.imageNodeId || "36")}</span>
            <span class="metaTag">字段 ${escapeHtml(workflow.imageFieldName || "image")}</span>
          </div>
          <div class="file">${escapeHtml(workflow.fileName)}</div>
          <button class="cardEditBtn" type="button" data-action="edit" data-file-name="${escapeHtml(workflow.fileName)}">编辑配置</button>
        </div>
      `;
    })
    .join("");

  updateRunButton();
}

async function refreshWorkflows() {
  const items = await window.api.getWorkflowSummaries();
  applyWorkflows(items);
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
    setStatus("请选择一个工作流后运行。右键卡片可编辑该 JSON 的独立配置。");
  } else {
    setStatus("你可以先点击“上传工作流”导入新的 JSON。");
  }
}

function openModal(mode, initialValues = {}) {
  modalMode = mode;
  editingFileName = String(initialValues.fileName || "");
  modal.dataset.open = "true";
  modalTitle.textContent = mode === "edit" ? "编辑工作流配置" : "上传新的工作流";
  modalHint.textContent =
    mode === "edit"
      ? "每个 JSON 都有自己的独立配置文件，你可以单独设置图像输入节点和字段。"
      : "先选择一个新的 JSON 文件，再填写这个工作流的基本信息与图像输入位置。";

  formElements.fileName.value = String(
    initialValues.fileName ? initialValues.fileName.replace(/\.json$/i, "") : ""
  );
  formElements.fileName.disabled = mode === "edit";
  formElements.displayName.value = initialValues.name || initialValues.displayName || "";
  formElements.workflowId.value = initialValues.workflowId || "";
  formElements.imageNodeId.value = initialValues.imageNodeId || "36";
  formElements.imageFieldName.value = initialValues.imageFieldName || "image";
  window.setTimeout(() => {
    const target = mode === "edit" ? formElements.displayName : formElements.fileName;
    if (target) target.focus();
  }, 10);
}

function closeModal() {
  modal.dataset.open = "false";
  editingFileName = "";
  workflowForm.reset();
  formElements.fileName.disabled = false;
}

function collectFormValues() {
  return {
    fileBaseName: formElements.fileName.value.trim(),
    displayName: formElements.displayName.value.trim(),
    workflowId: formElements.workflowId.value.trim(),
    imageNodeId: formElements.imageNodeId.value.trim() || "36",
    imageFieldName: formElements.imageFieldName.value.trim() || "image",
  };
}

async function openEditModal(fileName) {
  if (!fileName) return;
  try {
    const result = await window.api.getWorkflowConfig(fileName);
    if (!result || result.ok !== true || !result.workflow) {
      throw new Error((result && result.error) || "读取工作流配置失败");
    }
    openModal("edit", result.workflow);
  } catch (error) {
    window.api.reportError("workflow-selector:openEdit", error.message || String(error));
    setStatus(`读取配置失败：${error.message || error}`);
  }
}

async function submitModal() {
  const values = collectFormValues();

  if (!values.displayName) {
    setStatus("请填写工作流名称");
    formElements.displayName.focus();
    return;
  }
  if (modalMode === "import" && !values.fileBaseName) {
    setStatus("请填写 JSON 保存名称");
    formElements.fileName.focus();
    return;
  }

  saveWorkflowBtn.disabled = true;

  try {
    if (modalMode === "edit") {
      const result = await window.api.saveWorkflowConfig({
        fileName: editingFileName,
        displayName: values.displayName,
        workflowId: values.workflowId,
        imageNodeId: values.imageNodeId,
        imageFieldName: values.imageFieldName,
      });
      if (!result || result.ok !== true) {
        throw new Error((result && result.error) || "保存工作流配置失败");
      }
      await refreshWorkflows();
      closeModal();
      setStatus(`已更新配置：${values.displayName}`);
      return;
    }

    const result = await window.api.importWorkflowJson(values);
    if (result && result.cancelled) {
      closeModal();
      setStatus("已取消导入工作流");
      return;
    }
    if (!result || result.ok !== true) {
      throw new Error((result && result.error) || "导入工作流失败");
    }

    await refreshWorkflows();
    if (result.fileName) {
      await selectWorkflow(result.fileName);
    }
    closeModal();
    setStatus(`已导入工作流：${(result.workflow && result.workflow.name) || values.displayName}`);
  } catch (error) {
    window.api.reportError("workflow-selector:submitModal", error.message || String(error));
    setStatus(`操作失败：${error.message || error}`);
  } finally {
    saveWorkflowBtn.disabled = false;
  }
}

grid.addEventListener("click", (event) => {
  const editBtn = event.target.closest("[data-action='edit']");
  if (editBtn) {
    event.preventDefault();
    event.stopPropagation();
    openEditModal(editBtn.dataset.fileName || "");
    return;
  }

  const card = event.target.closest(".card");
  if (!card) return;
  selectWorkflow(card.dataset.fileName || "");
});

grid.addEventListener("contextmenu", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  event.preventDefault();
  openEditModal(card.dataset.fileName || "");
});

grid.addEventListener("keydown", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectWorkflow(card.dataset.fileName || "");
    return;
  }
  if (event.key.toLowerCase() === "e") {
    event.preventDefault();
    openEditModal(card.dataset.fileName || "");
  }
});

runBtn.addEventListener("click", () => {
  runSelectedWorkflow();
});

uploadBtn.addEventListener("click", () => {
  openModal("import", {});
});

closeBtn.addEventListener("click", () => {
  window.api.closeWorkflowSelector();
});

cancelWorkflowBtn.addEventListener("click", () => {
  closeModal();
});

workflowForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitModal();
});

modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

window.api.onWorkflowSelectionData((items) => {
  applyWorkflows(items);
});

window.api.onWorkflowEditRequest((fileName) => {
  openEditModal(fileName);
});

window.addEventListener("keydown", (event) => {
  if (modal.dataset.open === "true") {
    if (event.key === "Escape") {
      closeModal();
    }
    return;
  }

  if (event.key === "Escape") {
    window.api.closeWorkflowSelector();
    return;
  }
  if ((event.key === "Enter" && selectedFileName) || (event.ctrlKey && event.key === "Enter")) {
    event.preventDefault();
    runSelectedWorkflow();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
    event.preventDefault();
    openModal("import", {});
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
