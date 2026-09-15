const { contextBridge, webUtils, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getFilePath: (file) => webUtils.getPathForFile(file),
  windowControl: (action) => ipcRenderer.invoke("window-control", action),
  onWindowMaximizedState: (callback) =>
    ipcRenderer.on("window-maximized-state", (event, isMaximized) =>
      callback(isMaximized),
    ),
  readDirectory: (dirPath) => ipcRenderer.invoke("read-dir", dirPath),
  readDirectoryRecursive: (dirPath) =>
    ipcRenderer.invoke("read-dir-recursive", dirPath),
  getFileDetails: (filePath) =>
    ipcRenderer.invoke("get-file-details", filePath),
  getExifData: (filePath) => ipcRenderer.invoke("get-exif-data", filePath),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  readText: () => ipcRenderer.invoke("read-text"),
  pasteExifMetadata: (sourcePath, targetPath) =>
    ipcRenderer.invoke("paste-exif-metadata", sourcePath, targetPath),
  applyExifEdits: (payload) => ipcRenderer.invoke("apply-exif-edits", payload),
  randomizeExifDate: (payload) =>
    ipcRenderer.invoke("randomize-exif-date", payload),
  convertMediaFiles: (payload) =>
    ipcRenderer.invoke("convert-media-files", payload),

  // NEW: Progress & Cancel Trackers
  onTaskProgress: (callback) =>
    ipcRenderer.on("task-progress", (event, payload) => callback(payload)),
  cancelTask: () => ipcRenderer.send("cancel-task"),
  startWindowsSetup: () => ipcRenderer.invoke("start-windows-setup"),
  onShowSetupScreen: (callback) => ipcRenderer.on("show-setup-screen", callback),
  onSetupProgress: (callback) => ipcRenderer.on("setup-progress", (event, p) => callback(p)),

  // Popup Window Controls
  openExifWindow: (payload) => ipcRenderer.send("open-exif-window", payload),
  onRenderExif: (callback) =>
    ipcRenderer.on("render-exif", (event, payload) => callback(payload)),
  openImageEditorWindow: (payload) => ipcRenderer.send("open-image-editor-window", payload),
  onInitEditor: (callback) =>
    ipcRenderer.on("init-editor", (event, payload) => callback(payload)),
  saveImage: (payload) => ipcRenderer.invoke("save-image", payload),
  runYoloRedact: (dataUrl, mode, target) => ipcRenderer.invoke("run-yolo-redact", dataUrl, mode, target),
  openVideoEditorWindow: (payload) => ipcRenderer.send("open-video-editor-window", payload),
  onInitVideoEditor: (callback) =>
    ipcRenderer.on("init-video-editor", (event, payload) => callback(payload)),
  prepareVideoProxy: (payload) => ipcRenderer.invoke("prepare-video-proxy", payload),
  onProxyProgress: (callback) => ipcRenderer.on("proxy-progress", (event, p) => callback(p)),
  saveVideo: (payload) => ipcRenderer.invoke("save-video", payload),
  runYoloVideoRedact: (inputFilePath, mode, target) => ipcRenderer.invoke("run-yolo-video-redact", inputFilePath, mode, target),
  onMetadataUpdated: (callback) =>
    ipcRenderer.on("metadata-updated", (event, paths) => callback(paths)),
  selectFilesDialog: (options) => ipcRenderer.invoke("select-files-dialog", options),
  selectFolderDialog: (options) => ipcRenderer.invoke("select-folder-dialog", options),
  bulkMuteVideos: (payload) => ipcRenderer.invoke("bulk-mute-videos", payload),
  bulkExtractFrame: (payload) => ipcRenderer.invoke("bulk-extract-frame", payload),
  bulkRedactImages: (payload) => ipcRenderer.invoke("bulk-redact-images", payload),
});
