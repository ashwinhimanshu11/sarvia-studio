import { escapeHtml, imageExtensions, promptBulkSaveOptions } from "./utils.js";
import {
  focusFirstControl,
  handleVerticalNavigation,
  isTypingTarget,
  makeKeyboardAction,
} from "./keyboard.js";

let currentSelectedImagePath = null;
let currentSelectedImageExtension = null;
let bulkRedactFilesList = [];

export function initEditor() {
  document
    .getElementById("editor-folder-input")
    .addEventListener("keypress", (e) => {
      if (e.key === "Enter" && e.target.value.trim()) {
        loadEditorFolder(e.target.value.trim());
      }
    });

  document.getElementById("editor-edit-btn").addEventListener("click", () => {
    if (currentSelectedImagePath) {
      document.getElementById('editor-edit-btn').style.display = 'none';
      document.getElementById('editor-right-resizer').style.display = 'block';
      document.getElementById('editor-options-panel').style.display = 'flex';
      window.startImageEditor({ filePath: currentSelectedImagePath });
    }
  });

  setupBulkRedactLogic();
}

function setupBulkRedactLogic() {
  const filesOpt = document.getElementById("bulk-redact-files-opt");
  if (filesOpt) {
    filesOpt.addEventListener("click", async () => {
      const result = await window.electronAPI.selectFilesDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        bulkRedactFilesList = result.filePaths.filter((p) => {
          const ext = p.split(".").pop().toLowerCase();
          return imageExtensions.includes(ext);
        });
        showBulkRedactContainer();
      }
    });
  }

  const folderOpt = document.getElementById("bulk-redact-folder-opt");
  if (folderOpt) {
    folderOpt.addEventListener("click", async () => {
      const result = await window.electronAPI.selectFolderDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        const folderPath = result.filePaths[0];
        const entries = await window.electronAPI.readDirectoryRecursive(folderPath);
        if (!entries.error) {
          bulkRedactFilesList = entries
            .filter((e) => !e.isDirectory && imageExtensions.includes(e.extension))
            .map((e) => e.path);
          showBulkRedactContainer();
        }
      }
    });
  }

  const cancelBtn = document.getElementById("cancel-bulk-redact-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      bulkRedactFilesList = [];
      const bulkContainer = document.getElementById("editor-bulk-redact-container");
      if (bulkContainer) bulkContainer.style.display = "none";
      const emptyState = document.getElementById("editor-empty-state");
      if (emptyState) emptyState.style.display = "flex";
    });
  }

  const performBtn = document.getElementById("perform-bulk-redact-btn");
  if (performBtn) {
    performBtn.addEventListener("click", async () => {
      const checkboxes = document.querySelectorAll(".bulk-redact-cb:checked");
      const selectedFiles = Array.from(checkboxes).map((cb) => cb.dataset.path);
      if (selectedFiles.length === 0) return;

      const saveOpt = await promptBulkSaveOptions({
        title: "Bulk Auto-Redaction Save Options",
        description: "Choose how you want to save the redacted images:",
        allowReplace: true,
        newLabel: "Save as New Images...",
        newDesc: "Choose a destination folder to export the redacted images",
      });

      if (saveOpt.choice === "cancel") return;

      const mode = document.getElementById("bulk-redact-mode")?.value || "blur";

      // Show progress modal
      const progressModal = document.getElementById("progress-modal");
      const progressTitle = document.getElementById("progress-title");
      const progressFill = document.getElementById("progress-fill");
      const progressPercent = document.getElementById("progress-percent");
      const progressCount = document.getElementById("progress-count");
      const progressDetail = document.getElementById("progress-detail");
      const cancelProgressBtn = document.getElementById("cancel-progress-btn");

      progressModal.classList.add("active");
      progressTitle.textContent = "Auto-Redacting Images";
      progressFill.style.width = "0%";
      progressPercent.textContent = "0%";
      progressCount.textContent = `0 / ${selectedFiles.length}`;
      progressDetail.textContent = "Starting...";
      if (cancelProgressBtn) cancelProgressBtn.style.display = "inline-flex";

      const res = await window.electronAPI.bulkRedactImages({
        files: selectedFiles,
        mode: mode,
        target: "faces",
        saveMode: saveOpt.choice,
        outputDir: saveOpt.outputDir,
      });

      if (res.error) {
        progressTitle.textContent = "Redaction Failed";
        progressDetail.textContent = res.error;
        if (cancelProgressBtn) cancelProgressBtn.style.display = "none";
        setTimeout(() => {
          progressModal.classList.remove("active");
          if (cancelProgressBtn) cancelProgressBtn.style.display = "inline-flex";
        }, 2500);
      } else {
        const successCount = res.results ? res.results.filter((r) => r.success).length : 0;
        progressTitle.textContent = "Process Complete";
        progressFill.style.width = "100%";
        progressPercent.textContent = "100%";
        progressCount.textContent = `${successCount} / ${selectedFiles.length}`;
        progressDetail.textContent = `Successfully redacted ${successCount} image(s).`;
        if (cancelProgressBtn) cancelProgressBtn.style.display = "none";

        setTimeout(() => {
          progressModal.classList.remove("active");
          if (cancelProgressBtn) cancelProgressBtn.style.display = "inline-flex";
          document.getElementById("cancel-bulk-redact-btn").click();
        }, 1600);
      }
    });
  }
}

function showBulkRedactContainer() {
  const emptyState = document.getElementById("editor-empty-state");
  if (emptyState) emptyState.style.display = "none";
  const previewContainer = document.getElementById("editor-preview-container");
  if (previewContainer) previewContainer.style.display = "none";
  const bulkContainer = document.getElementById("editor-bulk-redact-container");
  if (!bulkContainer) return;
  bulkContainer.style.display = "flex";

  const countEl = document.getElementById("bulk-redact-count");
  if (countEl) countEl.textContent = `${bulkRedactFilesList.length} image(s) selected`;

  const listEl = document.getElementById("bulk-redact-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const performBtn = document.getElementById("perform-bulk-redact-btn");

  if (bulkRedactFilesList.length === 0) {
    listEl.innerHTML = "<div style='color: var(--text-muted); padding: 10px;'>No valid image files found in the selection.</div>";
    if (performBtn) performBtn.disabled = true;
    return;
  }

  if (performBtn) performBtn.disabled = false;

  bulkRedactFilesList.forEach((path) => {
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

    item.addEventListener("mouseenter", () => (item.style.background = "var(--bg-hover)"));
    item.addEventListener("mouseleave", () => (item.style.background = "transparent"));

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.className = "bulk-redact-cb";
    cb.dataset.path = path;
    cb.style.cursor = "pointer";
    cb.style.width = "14px";
    cb.style.height = "14px";
    cb.style.accentColor = "var(--gts-teal)";
    cb.style.margin = "0";

    cb.addEventListener("change", () => {
      const selectedCount = document.querySelectorAll(".bulk-redact-cb:checked").length;
      if (countEl) countEl.textContent = `${selectedCount} image(s) selected`;
      if (performBtn) performBtn.disabled = selectedCount === 0;
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
      handleVerticalNavigation(e, item, "#bulk-redact-list label"),
    );
    listEl.appendChild(item);
  });
}

export async function loadEditorFolder(path) {
  document.getElementById("editor-folder-input").value = path;
  const bulkContainer = document.getElementById("editor-bulk-redact-container");
  if (bulkContainer) bulkContainer.style.display = "none";
  document.getElementById("editor-empty-state").style.display = "flex";
  document.getElementById("editor-preview-container").style.display = "none";
  currentSelectedImagePath = null;
  currentSelectedImageExtension = null;

  const tree = document.getElementById("editor-file-tree");
  await renderEditorDirectory(path, tree);
}

async function renderEditorDirectory(path, containerElement) {
  containerElement.innerHTML = '<div class="tree-item" style="color: #888; padding-left: 25px;">Loading...</div>';
  const entries = await window.electronAPI.readDirectory(path);
  if (entries.error) {
    containerElement.innerHTML = `<div class="tree-item" style="color: #f48771; padding-left: 10px;">Error: ${entries.error}</div>`;
    return;
  }
  containerElement.innerHTML = "";

  // Filter to show only directories and images
  const filteredEntries = entries.filter(entry => {
    if (entry.isDirectory) return true;
    return imageExtensions.includes(entry.extension.toLowerCase());
  });

  filteredEntries.forEach((entry) => {
    const node = document.createElement("div");
    node.className = "tree-node";
    const item = document.createElement("div");
    item.className = `tree-item ${entry.isDirectory ? "folder" : "file"}`;

    const toggle = entry.isDirectory
      ? '<span class="material-symbols-rounded folder-toggle">chevron_right</span>'
      : '<span class="folder-toggle empty"></span>';
    
    let iconName = entry.isDirectory ? "folder" : "image";

    const content = document.createElement("div");
    content.className = "item-content";
    content.style.display = "flex";
    content.style.alignItems = "center";
    content.style.flex = "1";
    content.style.minWidth = "0";
    content.innerHTML = `${toggle}<span class="material-symbols-rounded icon">${iconName}</span><span class="name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>`;
    
      if (!entry.isDirectory) {
        const printBtn = document.createElement("span");
        printBtn.className = "material-symbols-rounded icon-action";
        printBtn.textContent = "print";
        printBtn.tabIndex = 0;
        printBtn.setAttribute("role", "button");
        printBtn.setAttribute("aria-label", `Print ${entry.name}`);
        printBtn.style.marginLeft = "auto";
        printBtn.style.padding = "4px";
        printBtn.style.fontSize = "16px";
      printBtn.style.cursor = "pointer";
      printBtn.style.display = "none";
      printBtn.title = "Print Image";
      printBtn.style.color = "var(--text-muted)";
      
      printBtn.addEventListener("mouseenter", () => printBtn.style.color = "var(--text-main)");
      printBtn.addEventListener("mouseleave", () => printBtn.style.color = "var(--text-muted)");
      
      printBtn.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        printImage(entry.path);
      });
      makeKeyboardAction(printBtn, (e) => {
        e.stopPropagation();
        printImage(entry.path);
      });
      
      content.appendChild(printBtn);
      
      item.addEventListener("mouseenter", () => printBtn.style.display = "block");
      item.addEventListener("mouseleave", () => printBtn.style.display = "none");
      item.addEventListener("focusin", () => printBtn.style.display = "block");
      item.addEventListener("focusout", (e) => {
        if (!item.contains(e.relatedTarget)) printBtn.style.display = "none";
      });
    }
    
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
            await renderEditorDirectory(entry.path, childrenContainer);
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
          handleVerticalNavigation(e, content, "#editor-file-tree .item-content");
        }
      });
      syncExpandedState();
      
      content.addEventListener("mousedown", async (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        toggleDirectory();
      });
    } else {
      const selectImage = async (e = {}) => {
        if (e.stopPropagation) e.stopPropagation();
        
        document
          .querySelectorAll("#editor-file-tree .tree-item.selected")
          .forEach((el) => el.classList.remove("selected"));
        item.classList.add("selected");

        currentSelectedImagePath = entry.path;
        currentSelectedImageExtension = entry.extension;
        
        document.getElementById("editor-empty-state").style.display = "none";
        const bulkContainer = document.getElementById("editor-bulk-redact-container");
        if (bulkContainer) bulkContainer.style.display = "none";
        const previewContainer = document.getElementById("editor-preview-container");
        previewContainer.style.display = "flex";
        
        const previewImg = document.getElementById("editor-preview-img");
        
        document.body.style.cursor = "wait";
        const details = await window.electronAPI.getFileDetails(entry.path);
        document.body.style.cursor = "default";
        
        if (details.thumbnail) {
          previewImg.src = details.thumbnail;
        } else {
          previewImg.src = "";
          previewImg.alt = "Preview not available for this large file.";
        }
      };
      content.setAttribute("aria-label", `Preview ${entry.name}`);
      makeKeyboardAction(content, selectImage);
      content.addEventListener("keydown", (e) =>
        handleVerticalNavigation(e, content, "#editor-file-tree .item-content"),
      );
      content.addEventListener("mousedown", async (e) => {
        if (e.button !== 0) return;
        await selectImage(e);
      });
    }
    containerElement.appendChild(node);
  });
}

function printImage(imagePath) {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <html>
      <head>
        <style>
          @page { margin: 0; size: auto; }
          body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background: white; }
          img { max-width: 100%; max-height: 100%; object-fit: contain; }
        </style>
      </head>
      <body>
        <img src="file://${imagePath}" onload="window.print();" />
      </body>
    </html>
  `);
  doc.close();
  
  setTimeout(() => {
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
  }, 10000);
}

let isEdited = false;
let currentFilePath = null;

// --- Injected Image Editor Logic ---

      let originalSrc = null;
      let cropper = null;
      
      let isCroppingMode = false;
      let isManualRedactMode = false;
      let a4Mode = null;
      let baseRotation = 0;
      let straightenAngle = 0;

      let activeRedactionBoxes = [];
      let unredactedImageSrc = null;
      let currentRedactionMode = "blur";

      function applyBoxesToCanvas(baseImg, boxes, mode) {
        const canvas = document.createElement("canvas");
        canvas.width = baseImg.naturalWidth || baseImg.width;
        canvas.height = baseImg.naturalHeight || baseImg.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(baseImg, 0, 0);

        boxes.forEach((box) => {
          const rx = Math.max(0, Math.round(box.x));
          const ry = Math.max(0, Math.round(box.y));
          const rw = Math.min(canvas.width - rx, Math.round(box.w));
          const rh = Math.min(canvas.height - ry, Math.round(box.h));

          if (rw > 0 && rh > 0) {
            if (mode === "black") {
              ctx.fillStyle = "#000000";
              ctx.fillRect(rx, ry, rw, rh);
            } else if (mode === "white") {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(rx, ry, rw, rh);
            } else {
              // Multi-pass smooth Gaussian + box blur simulation
              const blockSize = Math.max(8, Math.min(rw, rh) / 10);
              const tw = Math.max(1, Math.round(rw / blockSize));
              const th = Math.max(1, Math.round(rh / blockSize));

              const tempCanvas = document.createElement("canvas");
              tempCanvas.width = tw;
              tempCanvas.height = th;
              const tempCtx = tempCanvas.getContext("2d");
              tempCtx.imageSmoothingEnabled = true;
              tempCtx.drawImage(canvas, rx, ry, rw, rh, 0, 0, tw, th);

              ctx.save();
              ctx.imageSmoothingEnabled = false;
              ctx.filter = "blur(3px)";
              ctx.drawImage(tempCanvas, 0, 0, tw, th, rx, ry, rw, rh);
              ctx.restore();
            }
          }
        });

        return canvas;
      }

      function clearRedactionOverlays() {
        const existing = document.querySelectorAll(".redact-overlay-container");
        existing.forEach((el) => el.remove());
      }

      function syncOverlayPosition() {
        const overlayContainer = document.querySelector(".redact-overlay-container");
        if (!overlayContainer || !cropper) return;
        const canvasData = cropper.getCanvasData();
        if (!canvasData || !canvasData.width || !canvasData.height) return;
        overlayContainer.style.left = `${canvasData.left}px`;
        overlayContainer.style.top = `${canvasData.top}px`;
        overlayContainer.style.width = `${canvasData.width}px`;
        overlayContainer.style.height = `${canvasData.height}px`;
      }

	      window.addEventListener("resize", syncOverlayPosition);

	      function syncBoxElement(boxEl, box, imgW, imgH) {
	        boxEl.style.left = `${(box.x / imgW) * 100}%`;
	        boxEl.style.top = `${(box.y / imgH) * 100}%`;
	        boxEl.style.width = `${(box.w / imgW) * 100}%`;
	        boxEl.style.height = `${(box.h / imgH) * 100}%`;
	      }

      function applyRedactionsToImage() {
        const image = document.getElementById("editor-preview-img");
        if (!image || !unredactedImageSrc) return;

        const cleanImg = new Image();
        cleanImg.crossOrigin = "anonymous";
        cleanImg.onload = () => {
          const canvas = applyBoxesToCanvas(cleanImg, activeRedactionBoxes, currentRedactionMode);
          const dataUrl = canvas.toDataURL("image/png");
          if (cropper) {
            cropper.replace(dataUrl, true);
          } else {
            image.src = dataUrl;
          }
          isEdited = true;
          enableSave();
        };
        cleanImg.src = unredactedImageSrc;
      }

      function attachBoxDrag(boxEl, box) {
        let startX = 0;
        let startY = 0;
        let origBoxX = box.x;
        let origBoxY = box.y;
        let isDragging = false;

        boxEl.addEventListener("mousedown", (e) => {
          if (e.target.closest(".redact-remove-btn") || e.target.closest(".redact-resize-handle")) {
            return;
          }
          e.stopPropagation();
          e.preventDefault();

          startX = e.clientX;
          startY = e.clientY;
          origBoxX = box.x;
          origBoxY = box.y;
          isDragging = true;
          boxEl.classList.add("dragging");

          const image = document.getElementById("editor-preview-img");
          const imgW = image.naturalWidth || image.width;
          const imgH = image.naturalHeight || image.height;
          const canvasData = cropper ? cropper.getCanvasData() : { width: imgW, height: imgH };
          const scaleX = canvasData.width / imgW;
          const scaleY = canvasData.height / imgH;

          function onMouseMove(moveEvent) {
            if (!isDragging) return;
            const dx = (moveEvent.clientX - startX) / (scaleX || 1);
            const dy = (moveEvent.clientY - startY) / (scaleY || 1);

            let newX = Math.round(origBoxX + dx);
            let newY = Math.round(origBoxY + dy);

            newX = Math.max(0, Math.min(imgW - box.w, newX));
            newY = Math.max(0, Math.min(imgH - box.h, newY));

            box.x = newX;
            box.y = newY;

            boxEl.style.left = `${(newX / imgW) * 100}%`;
            boxEl.style.top = `${(newY / imgH) * 100}%`;
          }

          function onMouseUp() {
            if (!isDragging) return;
            isDragging = false;
            boxEl.classList.remove("dragging");
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);

            applyRedactionsToImage();
          }

          window.addEventListener("mousemove", onMouseMove);
          window.addEventListener("mouseup", onMouseUp);
        });
      }

      function attachBoxResize(handleEl, boxEl, box) {
        let startX = 0;
        let startY = 0;
        let origW = box.w;
        let origH = box.h;
        let isResizing = false;

        handleEl.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();

          startX = e.clientX;
          startY = e.clientY;
          origW = box.w;
          origH = box.h;
          isResizing = true;
          boxEl.classList.add("resizing");

          const image = document.getElementById("editor-preview-img");
          const imgW = image.naturalWidth || image.width;
          const imgH = image.naturalHeight || image.height;
          const canvasData = cropper ? cropper.getCanvasData() : { width: imgW, height: imgH };
          const scaleX = canvasData.width / imgW;
          const scaleY = canvasData.height / imgH;

          function onMouseMove(moveEvent) {
            if (!isResizing) return;
            const dw = (moveEvent.clientX - startX) / (scaleX || 1);
            const dh = (moveEvent.clientY - startY) / (scaleY || 1);

            let newW = Math.round(origW + dw);
            let newH = Math.round(origH + dh);

            newW = Math.max(15, Math.min(imgW - box.x, newW));
            newH = Math.max(15, Math.min(imgH - box.y, newH));

            box.w = newW;
            box.h = newH;

            boxEl.style.width = `${(newW / imgW) * 100}%`;
            boxEl.style.height = `${(newH / imgH) * 100}%`;
          }

          function onMouseUp() {
            if (!isResizing) return;
            isResizing = false;
            boxEl.classList.remove("resizing");
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);

            applyRedactionsToImage();
          }

          window.addEventListener("mousemove", onMouseMove);
          window.addEventListener("mouseup", onMouseUp);
        });
      }

      function renderRedactionOverlays() {
        clearRedactionOverlays();
        if (!activeRedactionBoxes || activeRedactionBoxes.length === 0) return;

        const image = document.getElementById("editor-preview-img");
        if (!image) return;

        const cropperContainer = document.querySelector(".cropper-container");
        if (!cropperContainer || !cropper) return;

        const overlayContainer = document.createElement("div");
        overlayContainer.className = "redact-overlay-container";
        cropperContainer.appendChild(overlayContainer);

        syncOverlayPosition();

        const imgW = image.naturalWidth || image.width;
        const imgH = image.naturalHeight || image.height;

        activeRedactionBoxes.forEach((box) => {
          const leftPct = (box.x / imgW) * 100;
          const topPct = (box.y / imgH) * 100;
          const widthPct = (box.w / imgW) * 100;
          const heightPct = (box.h / imgH) * 100;

          const boxEl = document.createElement("div");
          boxEl.className = "redact-box-overlay";
          boxEl.style.left = `${leftPct}%`;
          boxEl.style.top = `${topPct}%`;
	          boxEl.style.width = `${widthPct}%`;
	          boxEl.style.height = `${heightPct}%`;
	          boxEl.title = "Drag to move, corner to resize";
	          boxEl.tabIndex = 0;
	          boxEl.setAttribute("role", "group");
	          boxEl.setAttribute(
	            "aria-label",
	            "Redaction box. Use arrow keys to move, Shift plus arrow keys to resize, Delete to remove.",
	          );
	          boxEl.addEventListener("keydown", (e) => {
	            const handledKeys = [
	              "ArrowUp",
	              "ArrowDown",
	              "ArrowLeft",
	              "ArrowRight",
	              "Delete",
	              "Backspace",
	            ];
	            if (!handledKeys.includes(e.key)) return;

	            e.preventDefault();
	            e.stopPropagation();

	            if (e.key === "Delete" || e.key === "Backspace") {
	              removeRedactionBox(box.id);
	              return;
	            }

	            const step = e.altKey ? 1 : 10;
	            if (e.shiftKey) {
	              if (e.key === "ArrowLeft") box.w = Math.max(4, box.w - step);
	              if (e.key === "ArrowRight") box.w = Math.min(imgW - box.x, box.w + step);
	              if (e.key === "ArrowUp") box.h = Math.max(4, box.h - step);
	              if (e.key === "ArrowDown") box.h = Math.min(imgH - box.y, box.h + step);
	            } else {
	              if (e.key === "ArrowLeft") box.x = Math.max(0, box.x - step);
	              if (e.key === "ArrowRight") box.x = Math.min(imgW - box.w, box.x + step);
	              if (e.key === "ArrowUp") box.y = Math.max(0, box.y - step);
	              if (e.key === "ArrowDown") box.y = Math.min(imgH - box.h, box.y + step);
	            }

	            syncBoxElement(boxEl, box, imgW, imgH);
	            applyRedactionsToImage();
	          });

	          const removeBtn = document.createElement("button");
          removeBtn.className = "redact-remove-btn";
          removeBtn.title = "Remove this redaction";
          removeBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';

          removeBtn.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
          });

          removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            removeRedactionBox(box.id);
          });

          const resizeHandle = document.createElement("div");
          resizeHandle.className = "redact-resize-handle";
          resizeHandle.title = "Drag to resize";

          boxEl.appendChild(removeBtn);
          boxEl.appendChild(resizeHandle);

          attachBoxDrag(boxEl, box);
          attachBoxResize(resizeHandle, boxEl, box);

          overlayContainer.appendChild(boxEl);
        });
      }

      function removeRedactionBox(boxId) {
        activeRedactionBoxes = activeRedactionBoxes.filter((b) => b.id !== boxId);
        const image = document.getElementById("editor-preview-img");

        if (activeRedactionBoxes.length === 0) {
          clearRedactionOverlays();
          if (unredactedImageSrc) {
            if (cropper) {
              cropper.replace(unredactedImageSrc, true);
            } else {
              image.src = unredactedImageSrc;
            }
          }
          showToast("All face redactions removed.");
        } else {
          if (unredactedImageSrc) {
            const cleanImg = new Image();
            cleanImg.crossOrigin = "anonymous";
            cleanImg.onload = () => {
              const canvas = applyBoxesToCanvas(cleanImg, activeRedactionBoxes, currentRedactionMode);
              const dataUrl = canvas.toDataURL("image/png");
              if (cropper) {
                cropper.replace(dataUrl, true);
              } else {
                image.src = dataUrl;
              }
              renderRedactionOverlays();
              showToast(`Redaction removed (${activeRedactionBoxes.length} remaining).`);
            };
            cleanImg.src = unredactedImageSrc;
          }
        }
      }

      function applyRotation() {
        clearRedactionOverlays();
        activeRedactionBoxes = [];
        if (!cropper) return;
        const totalAngle = baseRotation + straightenAngle;
        cropper.rotateTo(totalAngle);
        
        // Calculate the maximum inscribed rectangle to auto-crop transparent corners
        const imageData = cropper.getImageData();
        const isRotated90 = Math.abs(baseRotation) % 180 === 90;
        const w = isRotated90 ? imageData.naturalHeight : imageData.naturalWidth;
        const h = isRotated90 ? imageData.naturalWidth : imageData.naturalHeight;
        
        const rad = Math.abs(straightenAngle * Math.PI / 180);
        const sin = Math.sin(rad);
        const cos = Math.cos(rad);
        
        let currentAspectRatio = w / h;
        if (isCroppingMode && a4Mode === "portrait") {
          currentAspectRatio = 0.7071;
        } else if (isCroppingMode && a4Mode === "landscape") {
          currentAspectRatio = 1.4142;
        }
        
        // Calculate max inscribed crop dimensions
        const cropWLimit1 = w / (cos + sin / currentAspectRatio);
        const cropWLimit2 = h / (sin + cos / currentAspectRatio);
        const maxCropW = Math.min(cropWLimit1, cropWLimit2);
        const maxCropH = maxCropW / currentAspectRatio;
        
        if (!cropper.cropped) {
          cropper.crop();
        }
        
        cropper.setAspectRatio(currentAspectRatio);
        
        const canvasData = cropper.getCanvasData();
        const boundingW = w * cos + h * sin;
        const boundingH = w * sin + h * cos;
        
        // The scale of the canvas on screen vs natural
        const canvasScale = canvasData.width / boundingW;
        
        const cropWOnScreen = maxCropW * canvasScale;
        const cropHOnScreen = maxCropH * canvasScale;
        
        cropper.setCropBoxData({
          left: canvasData.left + (canvasData.width - cropWOnScreen) / 2,
          top: canvasData.top + (canvasData.height - cropHOnScreen) / 2,
          width: cropWOnScreen,
          height: cropHOnScreen
        });
        
        enableSave();
      }

      function showToast(message) {
        const toast = document.getElementById("status-toast");
        toast.textContent = message;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3000);
      }

      function enableSave() {
        isEdited = true;
        document.getElementById("btn-save").disabled = false;
        document.getElementById("btn-cancel").disabled = false;
      }
      
	      function disableSave() {
	        isEdited = false;
	        document.getElementById("btn-save").disabled = true;
	        document.getElementById("btn-cancel").disabled = true;
	        document.getElementById("save-dropdown").classList.remove("show");
	      }

	      document.addEventListener("keydown", (e) => {
	        if (!cropper || (!isCroppingMode && !isManualRedactMode)) return;
	        if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey) return;

	        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
	          const data = cropper.getData(true);
	          if (!data || data.width <= 0 || data.height <= 0) return;

	          const image = document.getElementById("editor-preview-img");
	          const imgW = image.naturalWidth || image.width;
	          const imgH = image.naturalHeight || image.height;
	          const step = e.altKey ? 1 : 10;
	          const next = { ...data };

	          e.preventDefault();
	          if (e.shiftKey) {
	            if (e.key === "ArrowLeft") next.width = Math.max(4, data.width - step);
	            if (e.key === "ArrowRight") next.width = Math.min(imgW - data.x, data.width + step);
	            if (e.key === "ArrowUp") next.height = Math.max(4, data.height - step);
	            if (e.key === "ArrowDown") next.height = Math.min(imgH - data.y, data.height + step);
	          } else {
	            if (e.key === "ArrowLeft") next.x = Math.max(0, data.x - step);
	            if (e.key === "ArrowRight") next.x = Math.min(imgW - data.width, data.x + step);
	            if (e.key === "ArrowUp") next.y = Math.max(0, data.y - step);
	            if (e.key === "ArrowDown") next.y = Math.min(imgH - data.height, data.y + step);
	          }

	          cropper.setData(next);
	        } else if (e.key === "Enter") {
	          e.preventDefault();
	          document
	            .getElementById(isManualRedactMode ? "btn-redact-apply" : "btn-crop")
	            ?.click();
	        } else if (e.key === "Escape" && isManualRedactMode) {
	          e.preventDefault();
	          document.getElementById("btn-redact-cancel")?.click();
	        }
	      });
	      
	      document.getElementById("btn-save").addEventListener("click", (e) => {
	        if (!isEdited) return;
	        e.stopPropagation();
	        const saveDropdown = document.getElementById("save-dropdown");
	        saveDropdown.classList.toggle("show");
	        if (saveDropdown.classList.contains("show")) {
	          focusFirstControl(saveDropdown);
	        }
	      });
      
      document.addEventListener("click", () => {
        document.getElementById("save-dropdown").classList.remove("show");
      });

      window.startImageEditor = async function(payload) {
        if (payload.theme === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
        }
        
        currentFilePath = payload.filePath;
        document.getElementById('editor-filename-display').textContent = payload.filePath.split(/[/\\]/).pop();
        
        activeRedactionBoxes = [];
        unredactedImageSrc = null;
        clearRedactionOverlays();

        const details = await window.electronAPI.getFileDetails(payload.filePath);
        const image = document.getElementById('editor-preview-img');
        if (details.thumbnail) {
          image.src = details.thumbnail;
        } else {
          image.src = 'file://' + payload.filePath;
        }
        originalSrc = image.src;
        
        image.onload = () => {
          if (cropper) cropper.destroy();
          cropper = new Cropper(image, {
            viewMode: 2,
            dragMode: 'move', // Allows panning with mouse drag
            autoCrop: false, // Don't show crop box by default
            guides: false,
            center: false,
            highlight: false,
            cropBoxMovable: false,
            cropBoxResizable: false,
            toggleDragModeOnDblclick: false,
            wheelZoomRatio: 0.1, // Zoom via mouse wheel or 2-finger scroll
            ready: function () {
              const splash = document.getElementById("splash-screen");
              if (splash) {
                splash.style.opacity = '0';
                setTimeout(() => splash.remove(), 400);
              }
              renderRedactionOverlays();
            }
          });
        };
      };

      document.getElementById("btn-crop").addEventListener("click", () => {
        clearRedactionOverlays();
        activeRedactionBoxes = [];
        if (!cropper) return;
        
        if (!isCroppingMode) {
          if (isManualRedactMode) {
            isManualRedactMode = false;
            document.getElementById("btn-manual-redact").style.display = "flex";
            document.getElementById("btn-redact-apply").style.display = "none";
            document.getElementById("btn-redact-cancel").style.display = "none";
          }
          // Enter crop mode
          isCroppingMode = true;
          document.getElementById("crop-text").textContent = "Apply Crop";
          document.getElementById("crop-icon").textContent = "check";
          document.getElementById("btn-a4-portrait").style.display = "flex";
          document.getElementById("btn-a4-landscape").style.display = "flex";
          
          // Re-init cropper without default crop box so user draws it initially
          cropper.destroy();
          const image = document.getElementById('editor-preview-img');
          cropper = new Cropper(image, {
            viewMode: 2,
            dragMode: 'crop', 
            autoCrop: false,
            restore: false,
            guides: true,
            center: true,
            highlight: true,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            wheelZoomRatio: 0.1,
            ready() {
              if (baseRotation !== 0 || straightenAngle !== 0) {
                applyRotation();
              }
            }
          });
        } else {
          // Apply the crop
          if (!cropper.cropped) {
            showToast("Please drag on the image to draw a crop box first.");
            return;
          }
          const canvas = cropper.getCroppedCanvas();
          if (!canvas) return;
          
          cropper.destroy();
          cropper = null;
          
          const image = document.getElementById('editor-preview-img');
          image.src = canvas.toDataURL("image/png");
          
          isEdited = true;
          isCroppingMode = false;
          
          document.getElementById("crop-text").textContent = "Crop";
          document.getElementById("crop-icon").textContent = "crop";
          document.getElementById("btn-a4-portrait").style.display = "none";
          document.getElementById("btn-a4-landscape").style.display = "none";
          
          // Re-initialize cropper for zooming/panning on the cropped image
          image.onload = () => {
            if (!cropper) {
              cropper = new Cropper(image, {
                viewMode: 2,
                dragMode: 'move',
                autoCrop: false,
                guides: false,
                center: false,
                cropBoxMovable: false,
                cropBoxResizable: false,
                toggleDragModeOnDblclick: false,
                wheelZoomRatio: 0.1,
              });
            }
          };

          // Enable save options
          enableSave();
        }
      });

      document.getElementById("straighten-slider").addEventListener("input", (e) => {
        clearRedactionOverlays();
        activeRedactionBoxes = [];
        straightenAngle = parseFloat(e.target.value);
        applyRotation();
      });

      document.getElementById("btn-rotate-left").addEventListener("click", () => {
        clearRedactionOverlays();
        activeRedactionBoxes = [];
        baseRotation -= 90;
        applyRotation();
      });

      document.getElementById("btn-rotate-right").addEventListener("click", () => {
        clearRedactionOverlays();
        activeRedactionBoxes = [];
        baseRotation += 90;
        applyRotation();
      });

      function setA4Mode(mode) {
        if (a4Mode === mode) {
          a4Mode = null; // toggle off
        } else {
          a4Mode = mode;
        }
        
        const btnP = document.getElementById("btn-a4-portrait");
        const btnL = document.getElementById("btn-a4-landscape");
        
        btnP.style.background = a4Mode === "portrait" ? "var(--bg-hover)" : "";
        btnP.style.borderColor = a4Mode === "portrait" ? "var(--gts-blue)" : "";
        
        btnL.style.background = a4Mode === "landscape" ? "var(--bg-hover)" : "";
        btnL.style.borderColor = a4Mode === "landscape" ? "var(--gts-blue)" : "";
        
        applyRotation();
        
        if (!a4Mode) {
          cropper.setAspectRatio(NaN);
        }
      }

      document.getElementById("btn-a4-portrait").addEventListener("click", () => {
        if (!cropper || !isCroppingMode) return;
        setA4Mode("portrait");
      });

      document.getElementById("btn-a4-landscape").addEventListener("click", () => {
        if (!cropper || !isCroppingMode) return;
        setA4Mode("landscape");
      });

      function exitManualRedactMode() {
        if (!isManualRedactMode) return;
        isManualRedactMode = false;
        document.getElementById("btn-manual-redact").style.display = "flex";
        document.getElementById("btn-redact-apply").style.display = "none";
        document.getElementById("btn-redact-cancel").style.display = "none";

        if (cropper) {
          cropper.destroy();
          cropper = null;
        }

        const image = document.getElementById("editor-preview-img");
        if (image && image.src) {
          cropper = new Cropper(image, {
            viewMode: 2,
            dragMode: "move",
            autoCrop: false,
            guides: false,
            center: false,
            cropBoxMovable: false,
            cropBoxResizable: false,
            toggleDragModeOnDblclick: false,
            wheelZoomRatio: 0.1,
            ready() {
              renderRedactionOverlays();
            }
          });
        }
      }

      function enterManualRedactMode() {
        clearRedactionOverlays();
        activeRedactionBoxes = [];
        if (!cropper) return;
        if (isCroppingMode) {
          isCroppingMode = false;
          document.getElementById("crop-text").textContent = "Crop";
          document.getElementById("crop-icon").textContent = "crop";
          document.getElementById("btn-a4-portrait").style.display = "none";
          document.getElementById("btn-a4-landscape").style.display = "none";
        }

        isManualRedactMode = true;
        document.getElementById("btn-manual-redact").style.display = "none";
        document.getElementById("btn-redact-apply").style.display = "flex";
        document.getElementById("btn-redact-cancel").style.display = "flex";

        cropper.destroy();
        const image = document.getElementById("editor-preview-img");
        cropper = new Cropper(image, {
          viewMode: 2,
          dragMode: "crop",
          autoCrop: true,
          autoCropArea: 0.35,
          guides: true,
          center: true,
          highlight: true,
          cropBoxMovable: true,
          cropBoxResizable: true,
          toggleDragModeOnDblclick: false,
          wheelZoomRatio: 0.1,
        });
      }

      document.getElementById("btn-manual-redact").addEventListener("click", () => {
        enterManualRedactMode();
      });

      document.getElementById("btn-redact-cancel").addEventListener("click", () => {
        exitManualRedactMode();
      });

      document.getElementById("btn-redact-apply").addEventListener("click", () => {
        if (!cropper || !isManualRedactMode) return;

        const cropData = cropper.getData(true);
        if (!cropData || cropData.width <= 0 || cropData.height <= 0) {
          showToast("Please drag or resize the selection box over the area to redact.");
          return;
        }

        const image = document.getElementById("editor-preview-img");
        
        // Add new box
        const newBox = {
          id: "box_" + Date.now(),
          x: cropData.x,
          y: cropData.y,
          w: cropData.width,
          h: cropData.height
        };
        activeRedactionBoxes.push(newBox);
        
        // If first box, set unredacted source
        if (!unredactedImageSrc) {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0);
            unredactedImageSrc = canvas.toDataURL("image/png");
        }

        // Re-render
        const cleanImg = new Image();
        cleanImg.onload = () => {
            const canvas = applyBoxesToCanvas(cleanImg, activeRedactionBoxes, document.getElementById("redact-mode").value || "blur");
            image.src = canvas.toDataURL("image/png");
        };
        cleanImg.src = unredactedImageSrc;

        isEdited = true;
        enableSave();
        
        // Re-init cropper
        cropper.destroy();
        cropper = new Cropper(image, {
          viewMode: 2,
          dragMode: "crop",
          autoCrop: true,
          autoCropArea: 0.35,
          guides: true,
          center: true,
          highlight: true,
          cropBoxMovable: true,
          cropBoxResizable: true,
          toggleDragModeOnDblclick: false,
          wheelZoomRatio: 0.1,
          ready() { renderRedactionOverlays(); }
        });

        showToast("Redaction added! Click ✕ to remove any.");
      });

      document.getElementById("btn-redact").addEventListener("click", async () => {
        const image = document.getElementById("editor-preview-img");
        if (!image || !image.src) {
          showToast("Please open an image first.");
          return;
        }

        if (isManualRedactMode) {
          exitManualRedactMode();
        }

        if (isCroppingMode) {
          isCroppingMode = false;
          document.getElementById("crop-text").textContent = "Crop";
          document.getElementById("crop-icon").textContent = "crop";
          document.getElementById("btn-a4-portrait").style.display = "none";
          document.getElementById("btn-a4-landscape").style.display = "none";
        }

        const btn = document.getElementById("btn-redact");
        const icon = document.getElementById("redact-icon");
        const text = document.getElementById("redact-text");
        const origIcon = icon ? icon.textContent : "blur_on";
        const origText = text ? text.textContent : "Auto-Redact";

        if (btn) btn.disabled = true;
        if (icon) {
          icon.textContent = "sync";
          icon.classList.add("spinning");
        }
        if (text) text.textContent = "Scanning Faces...";

        try {
          // Render full resolution image to canvas
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const dataUrl = canvas.toDataURL("image/png");

          unredactedImageSrc = dataUrl;

          const mode = document.getElementById("redact-mode").value || "blur";
          const target = document.getElementById("redact-target").value || "faces";
          currentRedactionMode = mode;

          const result = await window.electronAPI.runYoloRedact(dataUrl, mode, target);

          if (result && result.success) {
            const boxes = result.boxes || [];
            if (result.count > 0 || boxes.length > 0) {
              activeRedactionBoxes = boxes.map((b, idx) => ({
                id: "box_" + Date.now() + "_" + idx,
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
              }));

              image.src = result.dataUrl || applyBoxesToCanvas(canvas, activeRedactionBoxes, mode).toDataURL("image/png");
              isEdited = true;
              enableSave();

              image.onload = () => {
                if (cropper) cropper.destroy();
                cropper = new Cropper(image, {
                  viewMode: 2,
                  dragMode: "move",
                  autoCrop: false,
                  guides: false,
                  center: false,
                  cropBoxMovable: false,
                  cropBoxResizable: false,
                  toggleDragModeOnDblclick: false,
                  wheelZoomRatio: 0.1,
                  ready() {
                    renderRedactionOverlays();
                  }
                });
              };

              showToast(`InsightFace detected ${activeRedactionBoxes.length} face(s). Click ✕ on any box to remove it.`);
            } else {
              activeRedactionBoxes = [];
              clearRedactionOverlays();
              showToast("No faces detected in this image.");
            }
          } else {
            showToast(`Auto-Redact Error: ${result && result.error ? result.error : "Detection failed"}`);
          }
        } catch (err) {
          showToast(`Error during auto-redaction: ${err.message}`);
        } finally {
          if (btn) btn.disabled = false;
          if (icon) {
            icon.textContent = origIcon;
            icon.classList.remove("spinning");
          }
          if (text) text.textContent = origText;
        }
      });

      document.getElementById("btn-cancel").addEventListener("click", () => {
        if (!isEdited) return;
        
        activeRedactionBoxes = [];
        unredactedImageSrc = null;
        clearRedactionOverlays();

        // Reset all states
        baseRotation = 0;
        straightenAngle = 0;
        document.getElementById("straighten-slider").value = 0;
        
        if (a4Mode) {
          setA4Mode(null);
        }
        
        if (isCroppingMode) {
          isCroppingMode = false;
          document.getElementById("crop-text").textContent = "Crop";
          document.getElementById("crop-icon").textContent = "crop";
          document.getElementById("btn-a4-portrait").style.display = "none";
          document.getElementById("btn-a4-landscape").style.display = "none";
        }

        if (isManualRedactMode) {
          isManualRedactMode = false;
          document.getElementById("btn-manual-redact").style.display = "flex";
          document.getElementById("btn-redact-apply").style.display = "none";
          document.getElementById("btn-redact-cancel").style.display = "none";
        }
        
        disableSave();
        
        // Restore original image which triggers onload and resets cropper
        const image = document.getElementById('editor-preview-img');
        image.src = originalSrc;
      });

      async function handleSave(replace) {
        if (!isEdited) return;
        clearRedactionOverlays();
        document.getElementById("save-dropdown").classList.remove("show");

        const saveBtn = document.getElementById("btn-save");
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size: 18px; animation: spin 1s linear infinite;">sync</span> Saving...';
        saveBtn.disabled = true;

        if (isManualRedactMode) {
          exitManualRedactMode();
        }

        const image = document.getElementById('editor-preview-img');
        let dataUrl;

        if (isCroppingMode && cropper) {
          const cropCanvas = cropper.getCroppedCanvas();
          dataUrl = cropCanvas ? cropCanvas.toDataURL("image/png") : image.src;
        } else {
          if (image.src.startsWith("data:image")) {
            dataUrl = image.src;
          } else {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0);
            dataUrl = canvas.toDataURL("image/png");
          }
        }
        
        const result = await window.electronAPI.saveImage({
          dataUrl,
          originalPath: currentFilePath,
          replace
        });
        
        saveBtn.innerHTML = originalText;
        if (!isEdited) saveBtn.disabled = true;
        
        if (result && result.success) {
          showToast(`Saved to ${result.path.split(/[/\\]/).pop()}`);
          if (!replace) {
             currentFilePath = result.path;
             document.getElementById('editor-filename-display').textContent = currentFilePath.split(/[/\\]/).pop();
          }
          
          disableSave();
        } else {
          showToast(`Error: ${result && result.error ? result.error : "Failed to save image"}`);
        }
      }

      document.getElementById("btn-save-replace").addEventListener("click", () => handleSave(true));
      document.getElementById("btn-save-new").addEventListener("click", () => handleSave(false));
      
      function setDropdownsDisabled(disabled) {
        const ddt = document.getElementById('dd-target');
        const ddm = document.getElementById('dd-mode');
        if (disabled) {
          ddt.classList.add('disabled');
          ddm.classList.add('disabled');
        } else {
          ddt.classList.remove('disabled');
          ddm.classList.remove('disabled');
        }
      }

    

document.getElementById('editor-back-normal-btn').addEventListener('click', () => {
    document.getElementById('editor-right-resizer').style.display = 'none';
    document.getElementById('editor-options-panel').style.display = 'none';
    document.getElementById('editor-edit-btn').style.display = 'flex';
    if(cropper) {
        cropper.destroy();
        cropper = null;
    }
    const btnCancel = document.getElementById("btn-cancel");
    if(btnCancel) btnCancel.click(); // Reset state
});
