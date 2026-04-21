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
  recapture() {
    ipcRenderer.send("pin-recapture");
  },
  closePin() {
    ipcRenderer.send("pin-close");
  },
  setPinClickThrough(enable) {
    return ipcRenderer.invoke("pin-set-click-through", enable);
  },
  setPinSize(width, height) {
    return ipcRenderer.invoke("pin-set-size", { width, height });
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
  reportError(source, message) {
    ipcRenderer.send("renderer-error", { source, message });
  },
});
