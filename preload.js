const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  async getScreenImageDataUrl(width = 1920, height = 1080) {
    return ipcRenderer.invoke("get-screen-image-data-url", {
      width,
      height,
    });
  },
  onSetImage(callback) {
    ipcRenderer.on("set-image", (_event, dataUrl) => callback(dataUrl));
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
  selectWorkflow(fileName) {
    return ipcRenderer.invoke("select-workflow", fileName);
  },
  runSelectedWorkflow() {
    return ipcRenderer.invoke("run-selected-workflow");
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
  setPinClickThrough(enable) {
    return ipcRenderer.invoke("pin-set-click-through", enable);
  },
  setPinSize(width, height) {
    return ipcRenderer.invoke("pin-set-size", { width, height });
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
  showPinContextMenu(dataUrl) {
    ipcRenderer.send("pin-show-context-menu", dataUrl);
  },
  onRunningHubStatus(callback) {
    ipcRenderer.on("runninghub-status", (_event, message) =>
      callback(String(message || ""))
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
