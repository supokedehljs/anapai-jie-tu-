const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  async getScreenImageDataUrl(payload = {}) {
    return ipcRenderer.invoke("get-screen-image-data-url", payload);
  },
  getCaptureDisplayInfo() {
    return ipcRenderer.invoke("get-capture-display-info");
  },
  onCaptureReadyData(callback) {
    ipcRenderer.on("capture-ready-data", (_event, payload) =>
      callback(payload && typeof payload === "object" ? payload : {})
    );
  },
  onSetImage(callback) {
    ipcRenderer.on("set-image", (_event, payload) => callback(payload));
  },
  closeCapture() {
    ipcRenderer.send("close-capture");
  },
  captureComplete(dataUrl) {
    ipcRenderer.send("capture-complete", dataUrl);
  },
  saveImage(dataUrl) {
    return ipcRenderer.invoke("save-image", dataUrl);
  },
  copyImageToClipboard(dataUrl) {
    return ipcRenderer.invoke("copy-image-to-clipboard", dataUrl);
  },
  chooseDirectory() {
    return ipcRenderer.invoke("choose-directory");
  },
  recapture() {
    ipcRenderer.send("pin-recapture");
  },
  closePin() {
    ipcRenderer.send("pin-close");
  },
  openWorkflowSelector() {
    ipcRenderer.send("pin-open-workflow-selector");
  },
  getWorkflowSummaries() {
    return ipcRenderer.invoke("get-workflow-summaries");
  },
  getWorkflowConfig(fileName) {
    return ipcRenderer.invoke("get-workflow-config", fileName);
  },
  saveWorkflowConfig(payload) {
    return ipcRenderer.invoke("save-workflow-config", payload);
  },
  importWorkflowJson(payload) {
    return ipcRenderer.invoke("import-workflow-json", payload);
  },
  chooseWorkflowJsonFile() {
    return ipcRenderer.invoke("choose-workflow-json-file");
  },
  chooseWorkflowThumbnailFile() {
    return ipcRenderer.invoke("choose-workflow-thumbnail-file");
  },
  selectWorkflow(fileName) {
    return ipcRenderer.invoke("select-workflow", fileName);
  },
  deleteWorkflow(fileName) {
    return ipcRenderer.invoke("delete-workflow", fileName);
  },
  runSelectedWorkflow() {
    return ipcRenderer.invoke("run-selected-workflow");
  },
  getWorkflowInputContext() {
    return ipcRenderer.invoke("get-workflow-input-context");
  },
  getClipboardImageDataUrl() {
    return ipcRenderer.invoke("get-clipboard-image-data-url");
  },
  runWorkflowWithImage(dataUrl) {
    return ipcRenderer.invoke("run-workflow-with-image", dataUrl);
  },
  closeWorkflowSelector() {
    ipcRenderer.send("workflow-selector-close");
  },
  onWorkflowSelectionData(callback) {
    ipcRenderer.on("workflow-selection-data", (_event, workflows) =>
      callback(Array.isArray(workflows) ? workflows : [])
    );
  },
  onWorkflowEditRequest(callback) {
    ipcRenderer.on("workflow-edit-request", (_event, fileName) =>
      callback(String(fileName || ""))
    );
  },
  onWorkflowInputContext(callback) {
    ipcRenderer.on("workflow-input-context", (_event, payload) =>
      callback(payload && typeof payload === "object" ? payload : {})
    );
  },
  setPinClickThrough(enable) {
    return ipcRenderer.invoke("pin-set-click-through", enable);
  },
  setPinSize(width, height) {
    return ipcRenderer.invoke("pin-set-size", { width, height });
  },
  fitPinToImage(width, height) {
    return ipcRenderer.invoke("pin-fit-to-image", { width, height });
  },
  switchPinImage(index) {
    return ipcRenderer.invoke("pin-switch-image", { index });
  },
  startPinDrag(position) {
    ipcRenderer.send("pin-start-drag", position);
  },
  dragPin(position) {
    ipcRenderer.send("pin-drag", position);
  },
  endPinDrag() {
    ipcRenderer.send("pin-end-drag");
  },
  onPinClickThroughState(callback) {
    ipcRenderer.on("pin-click-through-state", (_event, enabled) =>
      callback(Boolean(enabled))
    );
  },
  selectPin(payload) {
    ipcRenderer.send("pin-select", payload && typeof payload === "object" ? payload : {});
  },
  onPinSelectionState(callback) {
    ipcRenderer.on("pin-selection-state", (_event, payload) =>
      callback(payload && typeof payload === "object" ? payload : {})
    );
  },
  onPinWindowMeta(callback) {
    ipcRenderer.on("pin-window-meta", (_event, payload) =>
      callback(payload && typeof payload === "object" ? payload : {})
    );
  },
  showPinContextMenu(dataUrl) {
    ipcRenderer.send("pin-show-context-menu", dataUrl);
  },
  onRunningHubStatus(callback) {
    ipcRenderer.on("runninghub-status", (_event, message) =>
      callback(String(message || ""))
    );
  },
  onRunningHubProgress(callback) {
    ipcRenderer.on("runninghub-progress", (_event, payload) =>
      callback(payload && typeof payload === "object" ? payload : {})
    );
  },
  getSettings() {
    return ipcRenderer.invoke("get-settings");
  },
  saveSettings(payload) {
    return ipcRenderer.invoke("save-settings", payload);
  },
  getShortcutRegistrationState() {
    return ipcRenderer.invoke("get-shortcut-registration-state");
  },
  closeSettings() {
    ipcRenderer.send("settings-close");
  },
  onSettingsData(callback) {
    ipcRenderer.on("settings-data", (_event, settings) =>
      callback(settings && typeof settings === "object" ? settings : {})
    );
  },
  reportError(source, message) {
    ipcRenderer.send("renderer-error", { source, message });
  },
});
