import { escapeHtml, videoExtensions, promptBulkSaveOptions } from "./utils.js";
import {
  focusFirstControl,
  handleVerticalNavigation,
  isTypingTarget,
  makeKeyboardAction,
} from "./keyboard.js";

let currentSelectedVideoPath = null;
let currentSelectedVideoExtension = null;

export function initVideoEditor() {
  document
    .getElementById("video-folder-input")
    .addEventListener("keypress", (e) => {
      if (e.key === "Enter" && e.target.value.trim()) {
        loadVideoEditorFolder(e.target.value.trim());
      }
    });

  document.getElementById("video-edit-btn").addEventListener("click", () => {
    if (currentSelectedVideoPath) {
      
      document.getElementById('video-edit-btn').style.display = 'none';
      document.getElementById('video-right-resizer').style.display = 'block';
      document.getElementById('video-options-panel').style.display = 'flex';
      window.startVideoEditor({ filePath: currentSelectedVideoPath });

    }
  });

  setupBulkMuteLogic();
  setupBulkExtractFrameLogic();
}

let bulkMuteFilesList = [];
let bulkFrameFilesList = [];
let bulkFrameSourceFolder = null;

function setupBulkMuteLogic() {
  document.getElementById("bulk-mute-files-opt").addEventListener("click", async () => {
    const result = await window.electronAPI.selectFilesDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      // Filter out non-videos just in case
      bulkMuteFilesList = result.filePaths.filter(p => {
        const ext = p.split('.').pop().toLowerCase();
        return videoExtensions.includes(ext);
      });
      showBulkMuteContainer();
    }
  });

  document.getElementById("bulk-mute-folder-opt").addEventListener("click", async () => {
    const result = await window.electronAPI.selectFolderDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      const entries = await window.electronAPI.readDirectoryRecursive(folderPath);
      if (!entries.error) {
        bulkMuteFilesList = entries
          .filter(e => !e.isDirectory && videoExtensions.includes(e.extension))
          .map(e => e.path);
        showBulkMuteContainer();
      }
    }
  });

  document.getElementById("cancel-bulk-mute-btn").addEventListener("click", () => {
    bulkMuteFilesList = [];
    document.getElementById("video-bulk-mute-container").style.display = "none";
    document.getElementById("video-empty-state").style.display = "flex";
  });

  document.getElementById("perform-bulk-mute-btn").addEventListener("click", async () => {
    const checkboxes = document.querySelectorAll('.bulk-mute-cb:checked');
    const selectedFiles = Array.from(checkboxes).map(cb => cb.dataset.path);
    if (selectedFiles.length === 0) return;

    const saveOpt = await promptBulkSaveOptions({
      title: "Bulk Mute Save Options",
      description: "Choose how you want to save the muted videos:",
      allowReplace: true,
      newLabel: "Save as New Videos...",
      newDesc: "Choose a destination folder to export the muted videos",
    });

    if (saveOpt.choice === "cancel") return;
    
    // Show progress modal
    const progressModal = document.getElementById("progress-modal");
    const progressTitle = document.getElementById("progress-title");
    const progressFill = document.getElementById("progress-fill");
    const progressPercent = document.getElementById("progress-percent");
    const progressCount = document.getElementById("progress-count");
    const progressDetail = document.getElementById("progress-detail");
    const cancelBtn = document.getElementById("cancel-progress-btn");
    
    progressModal.classList.add("active");
    progressTitle.textContent = "Muting Videos";
    progressFill.style.width = "0%";
    progressPercent.textContent = "0%";
    progressCount.textContent = `0 / ${selectedFiles.length}`;
    progressDetail.textContent = "Starting...";
    if (cancelBtn) cancelBtn.style.display = "inline-flex";

    const res = await window.electronAPI.bulkMuteVideos({
      files: selectedFiles,
      saveMode: saveOpt.choice,
      outputDir: saveOpt.outputDir,
    });
    
    if (res.error) {
      progressTitle.textContent = "Muting Failed";
      progressDetail.textContent = res.error;
      if (cancelBtn) cancelBtn.style.display = "none";
      setTimeout(() => {
        progressModal.classList.remove("active");
        if (cancelBtn) cancelBtn.style.display = "inline-flex";
      }, 2500);
    } else {
      const successCount = res.results ? res.results.filter(r => r.success).length : 0;
      progressTitle.textContent = "Process Complete";
      progressFill.style.width = "100%";
      progressPercent.textContent = "100%";
      progressCount.textContent = `${successCount} / ${selectedFiles.length}`;
      progressDetail.textContent = `Successfully muted ${successCount} video(s).`;
      if (cancelBtn) cancelBtn.style.display = "none";
      
      setTimeout(() => {
        progressModal.classList.remove("active");
        if (cancelBtn) cancelBtn.style.display = "inline-flex";
        document.getElementById("cancel-bulk-mute-btn").click();
      }, 1600);
    }
  });
}

function showBulkMuteContainer() {
  document.getElementById("video-empty-state").style.display = "none";
  document.getElementById("video-preview-container").style.display = "none";
  document.getElementById("video-bulk-frame-container").style.display = "none";
  document.getElementById("video-bulk-mute-container").style.display = "flex";
  
  document.getElementById("bulk-mute-count").textContent = `${bulkMuteFilesList.length} video(s) selected`;
  
  const listEl = document.getElementById("bulk-mute-list");
  listEl.innerHTML = "";
  
  if (bulkMuteFilesList.length === 0) {
    listEl.innerHTML = "<div style='color: var(--text-muted); padding: 10px;'>No valid video files found in the selection.</div>";
    document.getElementById("perform-bulk-mute-btn").disabled = true;
    return;
  }
  
  document.getElementById("perform-bulk-mute-btn").disabled = false;
  
  bulkMuteFilesList.forEach(path => {
    const item = document.createElement("label");
    item.style.padding = "8px";
    item.style.borderBottom = "1px solid var(--border-color)";
    item.style.fontSize = "13px";
    item.style.wordBreak = "break-all";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "10px";
    item.style.cursor = "pointer";
    item.style.transition = "background 0.2s";
    
    item.addEventListener("mouseenter", () => item.style.background = "var(--bg-hover)");
    item.addEventListener("mouseleave", () => item.style.background = "transparent");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.className = "bulk-mute-cb";
    cb.dataset.path = path;
    cb.style.cursor = "pointer";
    cb.style.width = "14px";
    cb.style.height = "14px";
    cb.style.accentColor = "var(--gts-teal)";
    cb.style.margin = "0";
    
    cb.addEventListener("change", () => {
       const selectedCount = document.querySelectorAll('.bulk-mute-cb:checked').length;
       document.getElementById("bulk-mute-count").textContent = `${selectedCount} video(s) selected`;
       document.getElementById("perform-bulk-mute-btn").disabled = selectedCount === 0;
       item.setAttribute("aria-checked", cb.checked ? "true" : "false");
    });

    const labelSpan = document.createElement("span");
    labelSpan.textContent = path;
    labelSpan.style.flex = "1";

    item.appendChild(cb);
    item.appendChild(labelSpan);
    item.tabIndex = 0;
    item.setAttribute("role", "checkbox");
    item.setAttribute("aria-checked", "true");
    item.setAttribute("aria-label", `Select ${path}`);
    makeKeyboardAction(item, () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    }, null);
    item.addEventListener("keydown", (e) =>
      handleVerticalNavigation(e, item, "#bulk-mute-list label"),
    );
    listEl.appendChild(item);
  });
}

function setupBulkExtractFrameLogic() {
  document.getElementById("bulk-frame-files-opt").addEventListener("click", async () => {
    const result = await window.electronAPI.selectFilesDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      bulkFrameSourceFolder = null;
      bulkFrameFilesList = result.filePaths.filter(p => {
        const ext = p.split('.').pop().toLowerCase();
        return videoExtensions.includes(ext);
      });
      showBulkFrameContainer();
    }
  });

  document.getElementById("bulk-frame-folder-opt").addEventListener("click", async () => {
    const result = await window.electronAPI.selectFolderDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      bulkFrameSourceFolder = folderPath;
      const entries = await window.electronAPI.readDirectoryRecursive(folderPath);
      if (!entries.error) {
        bulkFrameFilesList = entries
          .filter(e => !e.isDirectory && videoExtensions.includes(e.extension))
          .map(e => e.path);
        showBulkFrameContainer();
      }
    }
  });

  document.getElementById("cancel-bulk-frame-btn").addEventListener("click", () => {
    bulkFrameFilesList = [];
    bulkFrameSourceFolder = null;
    document.getElementById("video-bulk-frame-container").style.display = "none";
    document.getElementById("video-empty-state").style.display = "flex";
  });

  document.getElementById("perform-bulk-frame-btn").addEventListener("click", async () => {
    const checkboxes = document.querySelectorAll('.bulk-frame-cb:checked');
    const selectedFiles = Array.from(checkboxes).map(cb => cb.dataset.path);
    if (selectedFiles.length === 0) return;

    const frameNumberInput = document.getElementById("bulk-frame-number-input");
    const frameNum = Math.max(1, parseInt(frameNumberInput?.value, 10) || 1);

    const saveOpt = await promptBulkSaveOptions({
      title: "Extract Frames Destination",
      description: `Choose a destination folder to export frame #${frameNum} from the selected videos:`,
      allowReplace: false,
      newLabel: "Select Destination Folder...",
      newDesc: "Choose where the extracted frame images should be saved",
    });

    if (saveOpt.choice === "cancel") return;
    
    // Show progress modal
    const progressModal = document.getElementById("progress-modal");
    const progressTitle = document.getElementById("progress-title");
    const progressFill = document.getElementById("progress-fill");
    const progressPercent = document.getElementById("progress-percent");
    const progressCount = document.getElementById("progress-count");
    const progressDetail = document.getElementById("progress-detail");
    const cancelBtn = document.getElementById("cancel-progress-btn");
    
    progressModal.classList.add("active");
    progressTitle.textContent = "Extracting Frames";
    progressFill.style.width = "0%";
    progressPercent.textContent = "0%";
    progressCount.textContent = `0 / ${selectedFiles.length}`;
    progressDetail.textContent = "Starting...";
    if (cancelBtn) cancelBtn.style.display = "inline-flex";

    const res = await window.electronAPI.bulkExtractFrame({
      files: selectedFiles,
      frameNumber: frameNum,
      sourceFolder: bulkFrameSourceFolder,
      outputDir: saveOpt.outputDir,
    });
    
    if (res.error) {
      progressTitle.textContent = "Extraction Failed";
      progressDetail.textContent = res.error;
      if (cancelBtn) cancelBtn.style.display = "none";
      setTimeout(() => {
        progressModal.classList.remove("active");
        if (cancelBtn) cancelBtn.style.display = "inline-flex";
      }, 2500);
    } else {
      const successCount = res.results ? res.results.filter(r => r.success).length : 0;
      progressTitle.textContent = "Process Complete";
      progressFill.style.width = "100%";
      progressPercent.textContent = "100%";
      progressCount.textContent = `${successCount} / ${selectedFiles.length}`;
      progressDetail.textContent = `Successfully extracted frame ${frameNum} for all ${successCount} video(s).`;
      if (cancelBtn) cancelBtn.style.display = "none";
      
      setTimeout(() => {
        progressModal.classList.remove("active");
        if (cancelBtn) cancelBtn.style.display = "inline-flex";
        document.getElementById("cancel-bulk-frame-btn").click();
      }, 1600);
    }
  });
}

function showBulkFrameContainer() {
  document.getElementById("video-empty-state").style.display = "none";
  document.getElementById("video-preview-container").style.display = "none";
  document.getElementById("video-bulk-mute-container").style.display = "none";
  document.getElementById("video-bulk-frame-container").style.display = "flex";
  
  document.getElementById("bulk-frame-count").textContent = `${bulkFrameFilesList.length} video(s) selected`;
  
  const listEl = document.getElementById("bulk-frame-list");
  listEl.innerHTML = "";
  
  if (bulkFrameFilesList.length === 0) {
    listEl.innerHTML = "<div style='color: var(--text-muted); padding: 10px;'>No valid video files found in the selection.</div>";
    document.getElementById("perform-bulk-frame-btn").disabled = true;
    return;
  }
  
  document.getElementById("perform-bulk-frame-btn").disabled = false;
  
  bulkFrameFilesList.forEach(path => {
    const item = document.createElement("label");
    item.style.padding = "8px";
    item.style.borderBottom = "1px solid var(--border-color)";
    item.style.fontSize = "13px";
    item.style.wordBreak = "break-all";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "10px";
    item.style.cursor = "pointer";
    item.style.transition = "background 0.2s";
    
    item.addEventListener("mouseenter", () => item.style.background = "var(--bg-hover)");
    item.addEventListener("mouseleave", () => item.style.background = "transparent");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.className = "bulk-frame-cb";
    cb.dataset.path = path;
    cb.style.cursor = "pointer";
    cb.style.width = "14px";
    cb.style.height = "14px";
    cb.style.accentColor = "var(--gts-teal)";
    cb.style.margin = "0";
    
    cb.addEventListener("change", () => {
      const selectedCount = document.querySelectorAll('.bulk-frame-cb:checked').length;
      document.getElementById("bulk-frame-count").textContent = `${selectedCount} video(s) selected`;
      document.getElementById("perform-bulk-frame-btn").disabled = selectedCount === 0;
      item.setAttribute("aria-checked", cb.checked ? "true" : "false");
    });

    const labelSpan = document.createElement("span");
    labelSpan.textContent = path;
    labelSpan.style.flex = "1";

    item.appendChild(cb);
    item.appendChild(labelSpan);
    item.tabIndex = 0;
    item.setAttribute("role", "checkbox");
    item.setAttribute("aria-checked", "true");
    item.setAttribute("aria-label", `Select ${path}`);
    makeKeyboardAction(item, () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    }, null);
    item.addEventListener("keydown", (e) =>
      handleVerticalNavigation(e, item, "#bulk-frame-list label"),
    );
    listEl.appendChild(item);
  });
}

export async function loadVideoEditorFolder(path) {
  document.getElementById("video-folder-input").value = path;
  document.getElementById("video-empty-state").style.display = "flex";
  document.getElementById("video-bulk-mute-container").style.display = "none";
  document.getElementById("video-bulk-frame-container").style.display = "none";
  document.getElementById("video-preview-container").style.display = "none";
  currentSelectedVideoPath = null;
  currentSelectedVideoExtension = null;

  const tree = document.getElementById("video-file-tree");
  await renderVideoEditorDirectory(path, tree);
}

async function renderVideoEditorDirectory(path, containerElement) {
  containerElement.innerHTML = '<div class="tree-item" style="color: #888; padding-left: 25px;">Loading...</div>';
  const entries = await window.electronAPI.readDirectory(path);
  if (entries.error) {
    containerElement.innerHTML = `<div class="tree-item" style="color: #f48771; padding-left: 10px;">Error: ${entries.error}</div>`;
    return;
  }
  containerElement.innerHTML = "";

  // Filter to show only directories and videos
  const filteredEntries = entries.filter(entry => {
    if (entry.isDirectory) return true;
    return videoExtensions.includes(entry.extension.toLowerCase());
  });

  filteredEntries.forEach((entry) => {
    const node = document.createElement("div");
    node.className = "tree-node";
    const item = document.createElement("div");
    item.className = `tree-item ${entry.isDirectory ? "folder" : "file"}`;

    const toggle = entry.isDirectory
      ? '<span class="material-symbols-rounded folder-toggle">chevron_right</span>'
      : '<span class="folder-toggle empty"></span>';
    
    let iconName = entry.isDirectory ? "folder" : "movie";

    const content = document.createElement("div");
    content.className = "item-content";
    content.style.display = "flex";
    content.style.alignItems = "center";
    content.style.flex = "1";
    content.style.minWidth = "0";
    content.innerHTML = `${toggle}<span class="material-symbols-rounded icon">${iconName}</span><span class="name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>`;
    
    item.appendChild(content);
    node.appendChild(item);

    if (entry.isDirectory) {
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "children-container";
      node.appendChild(childrenContainer);
      let isLoaded = false;
      const syncExpandedState = () => {
        content.setAttribute(
          "aria-expanded",
          item.classList.contains("open") ? "true" : "false",
        );
      };
      const toggleDirectory = async (forceOpen = null) => {
        const shouldOpen =
          forceOpen === null ? !item.classList.contains("open") : forceOpen;
        if (shouldOpen) {
          item.classList.add("open");
          childrenContainer.classList.add("open");
          if (!isLoaded) {
            await renderVideoEditorDirectory(entry.path, childrenContainer);
            isLoaded = true;
          }
        } else {
          item.classList.remove("open");
          childrenContainer.classList.remove("open");
        }
        syncExpandedState();
      };
      content.setAttribute("aria-label", `Open ${entry.name}`);
      makeKeyboardAction(content, () => toggleDirectory());
      content.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          toggleDirectory(true);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          toggleDirectory(false);
        } else {
          handleVerticalNavigation(e, content, "#video-file-tree .item-content");
        }
      });
      syncExpandedState();
      
      content.addEventListener("mousedown", async (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        toggleDirectory();
      });
    } else {
      const selectVideo = (e = {}) => {
        if (e.stopPropagation) e.stopPropagation();
        
        document
          .querySelectorAll("#video-file-tree .tree-item.selected")
          .forEach((el) => el.classList.remove("selected"));
        item.classList.add("selected");

        currentSelectedVideoPath = entry.path;
        currentSelectedVideoExtension = entry.extension;
        
        document.getElementById("video-empty-state").style.display = "none";
        document.getElementById("video-bulk-mute-container").style.display = "none";
        document.getElementById("video-bulk-frame-container").style.display = "none";
        const previewContainer = document.getElementById("video-preview-container");
        previewContainer.style.display = "flex";
        
        const previewVid = document.getElementById("video-preview-vid");
        
        previewVid.src = 'file://' + entry.path;
      };
      content.setAttribute("aria-label", `Preview ${entry.name}`);
      makeKeyboardAction(content, selectVideo);
      content.addEventListener("keydown", (e) =>
        handleVerticalNavigation(e, content, "#video-file-tree .item-content"),
      );
      content.addEventListener("mousedown", async (e) => {
        if (e.button !== 0) return;
        selectVideo(e);
      });
    }
    containerElement.appendChild(node);
  });
}

let isEdited = false;
let currentFilePath = null;

// --- Injected Video Editor Logic ---

      
      let isCroppingMode = false;
      let isBlurringMode = false;
      let isMuted = false;
      let cropper = null;
      let cropData = null; // { x, y, width, height }
      let blurData = null; // { x, y, w, h, start, end }
      
      const video = document.getElementById('video-preview-vid');
      const trimStart = document.getElementById("trim-start");
      const trimEnd = document.getElementById("trim-end");
      
      function showToast(message) {
        const toast = document.getElementById("status-toast");
        toast.textContent = message;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3000);
      }
      
      function enableSave() {
        isEdited = true;
        document.getElementById("btn-save-vid").disabled = false;
        document.getElementById("btn-cancel-vid").disabled = false;
      }
      
	      function disableSave() {
	        isEdited = false;
	        document.getElementById("btn-save-vid").disabled = true;
        document.getElementById("btn-cancel-vid").disabled = true;
        document.getElementById("save-dropdown-vid").classList.remove("show");
        cropData = null;
        blurData = null;
        isMuted = false;
        updateMuteUI();
        trimStart.value = "";
        trimEnd.value = "";
        video.style.objectViewBox = "none";
        exitCropMode();
        exitBlurMode();
	        if (typeof updateBlurPreview === 'function') updateBlurPreview();
	      }

	      document.addEventListener("keydown", (e) => {
	        if (!cropper || (!isCroppingMode && !isBlurringMode)) return;
	        if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey) return;

	        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
	          const data = cropper.getData(true);
	          if (!data || data.width <= 0 || data.height <= 0) return;

	          const step = e.altKey ? 1 : 10;
	          const next = { ...data };
	          e.preventDefault();

	          if (e.shiftKey) {
	            if (e.key === "ArrowLeft") next.width = Math.max(4, data.width - step);
	            if (e.key === "ArrowRight") next.width = Math.min(video.videoWidth - data.x, data.width + step);
	            if (e.key === "ArrowUp") next.height = Math.max(4, data.height - step);
	            if (e.key === "ArrowDown") next.height = Math.min(video.videoHeight - data.y, data.height + step);
	          } else {
	            if (e.key === "ArrowLeft") next.x = Math.max(0, data.x - step);
	            if (e.key === "ArrowRight") next.x = Math.min(video.videoWidth - data.width, data.x + step);
	            if (e.key === "ArrowUp") next.y = Math.max(0, data.y - step);
	            if (e.key === "ArrowDown") next.y = Math.min(video.videoHeight - data.height, data.y + step);
	          }

	          cropper.setData(next);
	        } else if (e.key === "Enter") {
	          e.preventDefault();
	          if (isCroppingMode) {
	            document.getElementById("btn-crop-mode")?.click();
	          } else if (isBlurringMode) {
	            document.getElementById("btn-apply-blur")?.focus();
	          }
	        } else if (e.key === "Escape") {
	          e.preventDefault();
	          if (isCroppingMode) exitCropMode();
	          if (isBlurringMode) exitBlurMode();
	        }
	      });
	      
	      document.getElementById("btn-set-start").addEventListener("click", () => {
        trimStart.value = video.currentTime.toFixed(2);
        enableSave();
      });
      document.getElementById("btn-set-end").addEventListener("click", () => {
        trimEnd.value = video.currentTime.toFixed(2);
        enableSave();
      });
      
      trimStart.addEventListener("input", enableSave);
      trimEnd.addEventListener("input", enableSave);
      
      document.getElementById("btn-cancel-vid").addEventListener("click", disableSave);
      
      function updateMuteUI() {
        document.getElementById("mute-icon").textContent = isMuted ? "volume_off" : "volume_up";
        document.getElementById("mute-text").textContent = isMuted ? "Unmute" : "Mute";
        if (isMuted) {
          document.getElementById("btn-mute-mode").classList.add("primary");
        } else {
          document.getElementById("btn-mute-mode").classList.remove("primary");
        }
      }

      document.getElementById("btn-mute-mode").addEventListener("click", () => {
        isMuted = !isMuted;
        updateMuteUI();
        enableSave();
      });

      function exitCropMode() {
        isCroppingMode = false;
        document.getElementById("crop-text").textContent = "Crop";
        document.getElementById("crop-icon").textContent = "crop";
        document.getElementById("btn-crop-mode").classList.remove("primary");
        document.getElementById("crop-overlay-container").style.display = "none";
        if (cropper) {
          cropper.destroy();
          cropper = null;
        }
        video.style.display = "block";
      }
      
      document.getElementById("btn-crop-mode").addEventListener("click", () => {
        if (isCroppingMode) {
          // Apply Crop
          if (cropper) {
            const data = cropper.getData();
            if (data.width > 0 && data.height > 0) {
              cropData = { x: Math.round(data.x), y: Math.round(data.y), w: Math.round(data.width), h: Math.round(data.height) };
              enableSave();
              
              const top = cropData.y;
              const left = cropData.x;
              const right = video.videoWidth - (cropData.x + cropData.w);
              const bottom = video.videoHeight - (cropData.y + cropData.h);
              video.style.objectViewBox = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
            }
          }
          exitCropMode();
        } else {
          // Enter Crop
          if (!video.videoWidth) {
            alert("Video is not fully loaded yet. Please play the video first.");
            return;
          }
          isCroppingMode = true;
          document.getElementById("crop-text").textContent = "Apply Crop";
          document.getElementById("crop-icon").textContent = "check";
          document.getElementById("btn-crop-mode").classList.add("primary");
          
          video.pause();
          
          try {
            const tempBox = video.style.objectViewBox;
            video.style.objectViewBox = "none";
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            video.style.objectViewBox = tempBox;
            
            const cropImg = document.getElementById("crop-image");
            
            // Assign onload before setting src for dataURIs
            cropImg.onload = () => {
              if (cropper) cropper.destroy();
              cropper = new Cropper(cropImg, {
                viewMode: 1,
                dragMode: 'crop',
                autoCrop: false,
                restore: false,
                zoomable: false,
                guides: true
              });
              if (cropData) {
                cropper.setData({ x: cropData.x, y: cropData.y, width: cropData.w, height: cropData.h });
              }
            };
            
            cropImg.src = canvas.toDataURL("image/jpeg");
            
            video.style.display = "none";
            document.getElementById("crop-overlay-container").style.display = "flex";
          } catch (err) {
            alert("Failed to grab video frame for cropping: " + err.message);
            exitCropMode();
          }
        }
      });
      
      function exitBlurMode() {
        isBlurringMode = false;
        document.getElementById("blur-dropdown-wrapper").style.display = "none";
        document.getElementById("btn-blur-mode").style.display = "flex";
        document.getElementById("crop-overlay-container").style.display = "none";
        if (cropper) {
          cropper.destroy();
          cropper = null;
        }
        video.style.display = "block";
      }

      document.getElementById("btn-blur-mode").addEventListener("click", () => {
        if (!video.videoWidth) {
          alert("Video is not fully loaded yet. Please play the video first.");
          return;
        }
        exitCropMode(); // Exit crop mode if active
        isBlurringMode = true;
        document.getElementById("btn-blur-mode").style.display = "none";
        document.getElementById("blur-dropdown-wrapper").style.display = "inline-flex";
        
        video.pause();
        try {
          const tempBox = video.style.objectViewBox;
          video.style.objectViewBox = "none";
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          video.style.objectViewBox = tempBox;
          
          const cropImg = document.getElementById("crop-image");
          cropImg.onload = () => {
            if (cropper) cropper.destroy();
            cropper = new Cropper(cropImg, {
              viewMode: 1,
              dragMode: 'crop',
              autoCrop: false,
              restore: false,
              zoomable: false,
              guides: true
            });
            if (blurData) {
              cropper.setData({ x: blurData.x, y: blurData.y, width: blurData.w, height: blurData.h });
            }
          };
          cropImg.src = canvas.toDataURL("image/jpeg");
          video.style.display = "none";
          document.getElementById("crop-overlay-container").style.display = "flex";
        } catch (err) {
          alert("Failed to grab video frame for blurring: " + err.message);
          exitBlurMode();
        }
      });

	      document.getElementById("btn-apply-blur").addEventListener("click", (e) => {
	        e.stopPropagation();
	        const applyBlurDropdown = document.getElementById("apply-blur-dropdown");
	        applyBlurDropdown.classList.toggle("show");
	        if (applyBlurDropdown.classList.contains("show")) {
	          focusFirstControl(applyBlurDropdown);
	        }
	      });

      function updateBlurPreview() {
        let overlay = document.getElementById("blur-preview-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "blur-preview-overlay";
          overlay.style.position = "absolute";
          overlay.style.backdropFilter = "blur(15px)";
          overlay.style.webkitBackdropFilter = "blur(15px)";
          overlay.style.pointerEvents = "none";
          overlay.style.zIndex = "10";
          overlay.style.border = "1px solid rgba(255,255,255,0.4)";
          overlay.style.borderRadius = "4px";
          document.getElementById("video-preview-container").appendChild(overlay);
        }
        
        if (!blurData || !video.videoWidth || video.style.display === "none") {
          overlay.style.display = "none";
          return;
        }

        if (blurData.start !== null && blurData.end !== null) {
          const t = video.currentTime;
          if (t < blurData.start || t > blurData.end) {
            overlay.style.display = "none";
            return;
          }
        }
        overlay.style.display = "block";

        const videoRect = video.getBoundingClientRect();
        const containerRect = document.getElementById("video-preview-container").getBoundingClientRect();
        
        let intrinsicW = video.videoWidth;
        let intrinsicH = video.videoHeight;
        let leftOffset = 0;
        let topOffset = 0;
        
        if (cropData) {
          intrinsicW = cropData.w;
          intrinsicH = cropData.h;
          leftOffset = cropData.x;
          topOffset = cropData.y;
        }

        const intrinsicRatio = intrinsicW / intrinsicH;
        const elementRatio = videoRect.width / videoRect.height;
        
        let renderWidth = videoRect.width;
        let renderHeight = videoRect.height;

        if (elementRatio > intrinsicRatio) {
          renderWidth = videoRect.height * intrinsicRatio;
        } else {
          renderHeight = videoRect.width / intrinsicRatio;
        }

        const renderX = videoRect.left - containerRect.left + (videoRect.width - renderWidth) / 2;
        const renderY = videoRect.top - containerRect.top + (videoRect.height - renderHeight) / 2;

        const scaleX = renderWidth / intrinsicW;
        const scaleY = renderHeight / intrinsicH;

        let bx = (blurData.x - leftOffset) * scaleX;
        let by = (blurData.y - topOffset) * scaleY;
        let bw = blurData.w * scaleX;
        let bh = blurData.h * scaleY;

        if (bx < 0) { bw += bx; bx = 0; }
        if (by < 0) { bh += by; by = 0; }
        if (bx + bw > renderWidth) { bw = renderWidth - bx; }
        if (by + bh > renderHeight) { bh = renderHeight - by; }

        if (bw <= 0 || bh <= 0) {
          overlay.style.display = "none";
          return;
        }

        overlay.style.left = (renderX + bx) + "px";
        overlay.style.top = (renderY + by) + "px";
        overlay.style.width = bw + "px";
        overlay.style.height = bh + "px";
      }

      video.addEventListener("timeupdate", updateBlurPreview);
      window.addEventListener("resize", updateBlurPreview);

      function applyBlurSettings(start, end) {
        if (cropper) {
          const data = cropper.getData();
          if (data.width > 0 && data.height > 0) {
            blurData = { x: Math.round(data.x), y: Math.round(data.y), w: Math.round(data.width), h: Math.round(data.height), start, end };
            enableSave();
          }
        }
        exitBlurMode();
        updateBlurPreview();
      }

      document.getElementById("btn-blur-entire").addEventListener("click", () => {
        applyBlurSettings(null, null);
      });

	      document.getElementById("btn-blur-timeframe").addEventListener("click", () => {
	        document.getElementById("apply-blur-dropdown").classList.remove("show");
	        document.getElementById("blur-start").value = trimStart.value || "0";
	        document.getElementById("blur-end").value = trimEnd.value || video.duration.toFixed(2);
	        document.getElementById("blur-time-modal").style.display = "flex";
	        focusFirstControl(document.getElementById("blur-time-modal"));
	      });

      document.getElementById("btn-cancel-blur-time").addEventListener("click", () => {
        document.getElementById("blur-time-modal").style.display = "none";
      });

	      document.getElementById("btn-confirm-blur-time").addEventListener("click", () => {
        const st = parseFloat(document.getElementById("blur-start").value);
        const en = parseFloat(document.getElementById("blur-end").value);
        if (isNaN(st) || isNaN(en) || st >= en) {
          alert("Invalid timeframe.");
          return;
        }
	        document.getElementById("blur-time-modal").style.display = "none";
	        applyBlurSettings(st, en);
	      });

	      document.addEventListener("keydown", (e) => {
	        if (
	          e.key === "Escape" &&
	          document.getElementById("blur-time-modal").style.display === "flex"
	        ) {
	          e.preventDefault();
	          document.getElementById("blur-time-modal").style.display = "none";
	          document.getElementById("btn-apply-blur")?.focus();
	        }
	      });
      
      const autoRedactBtn = document.getElementById("btn-auto-redact-video");
      if (autoRedactBtn) {
        autoRedactBtn.addEventListener("click", () => {
          showToast("Auto Face Redaction is currently under construction. Stay tuned!");
        });
      }

	      document.getElementById("btn-save-vid").addEventListener("click", (e) => {
	        if (!isEdited) return;
	        e.stopPropagation();
	        const saveDropdown = document.getElementById("save-dropdown-vid");
	        saveDropdown.classList.toggle("show");
	        if (saveDropdown.classList.contains("show")) {
	          focusFirstControl(saveDropdown);
	        }
	      });
      document.addEventListener("click", () => {
        document.getElementById("save-dropdown-vid").classList.remove("show");
      });
      
      async function triggerSave(replace) {
        document.getElementById("save-dropdown-vid").classList.remove("show");
        
        const saveBtn = document.getElementById("btn-save-vid");
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size: 18px; animation: spin 1s linear infinite;">sync</span> Saving...';
        saveBtn.disabled = true;

        const ts = parseFloat(trimStart.value);
        const te = parseFloat(trimEnd.value);
        
        const payload = {
          filePath: currentFilePath,
          replace,
          trimStart: isNaN(ts) ? null : ts,
          trimEnd: isNaN(te) ? null : te,
          cropX: cropData ? cropData.x : null,
          cropY: cropData ? cropData.y : null,
          cropW: cropData ? cropData.w : null,
          cropH: cropData ? cropData.h : null,
          mute: isMuted,
          blurData: blurData
        };
        
        const toast = document.getElementById("status-toast");
        toast.textContent = "Saving video...";
        toast.classList.add("show");
        
        const res = await window.electronAPI.saveVideo(payload);
        
        saveBtn.innerHTML = originalText;
        if (!isEdited) saveBtn.disabled = true;
        
        if (res.error) {
          toast.textContent = "Error: " + res.error;
          setTimeout(() => toast.classList.remove("show"), 3000);
        } else {
          currentFilePath = res.newPath;
          disableSave();
          showToast("Video saved successfully!");
        }
      }
      
      document.getElementById("btn-save-replace-vid").addEventListener("click", () => triggerSave(true));
      document.getElementById("btn-save-new-vid").addEventListener("click", () => triggerSave(false));
      
      window.startVideoEditor = async function(payload) {
        if (payload.theme === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
        }
        
        currentFilePath = payload.filePath;
        document.getElementById('video-filename-display').textContent = payload.filePath.split(/[/\\]/).pop();
        
        const overlay = document.createElement("div");
        overlay.id = "proxy-overlay";
        overlay.style = "display: flex; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg-base); z-index: 100; flex-direction: column; align-items: center; justify-content: center; color: var(--text-main);";
        overlay.innerHTML = `
          <div style="font-size: 16px; margin-bottom: 12px; font-weight: 500;">Generating Playable Preview...</div>
          <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 24px;">Format not natively supported. Transcoding...</div>
          <div style="width: 300px; height: 6px; background: var(--border-color); border-radius: 3px; overflow: hidden;">
            <div id="proxy-progress-bar" style="width: 0%; height: 100%; background: var(--text-main); transition: width 0.2s;"></div>
          </div>
          <div id="proxy-text" style="font-size: 12px; margin-top: 8px; color: var(--text-muted);">0%</div>
        `;
        document.getElementById('video-preview-container').appendChild(overlay);
        overlay.style.display = "none";
        
        let proxyStarted = false;
        
        window.electronAPI.onProxyProgress((percent) => {
          if (!proxyStarted) {
            proxyStarted = true;
            overlay.style.display = "flex";
          }
          document.getElementById("proxy-progress-bar").style.width = percent + "%";
          document.getElementById("proxy-text").textContent = percent + "%";
        });
        
        const res = await window.electronAPI.prepareVideoProxy(payload.filePath);
        if (overlay) overlay.remove();
        
        if (res.error) {
          alert(res.error);
        } else {
          video.src = 'file://' + res.proxyPath;
        }
      };
    

document.getElementById('video-back-normal-btn').addEventListener('click', () => {
    document.getElementById('video-right-resizer').style.display = 'none';
    document.getElementById('video-options-panel').style.display = 'none';
    document.getElementById('video-edit-btn').style.display = 'flex';
    
    // reset UI
    const btnCancel = document.getElementById("btn-cancel-vid");
    if(btnCancel) btnCancel.click();
});
