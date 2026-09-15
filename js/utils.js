import { focusFirstControl } from "./keyboard.js";

export const imageExtensions = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "tif",
  "tiff",
  "bmp",
  "heic",
  "heif",
  "avif",
];
export const videoExtensions = [
  "mp4",
  "mov",
  "mkv",
  "avi",
  "webm",
  "m4v",
  "mpeg",
  "mpg",
  "3gp",
];

export function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}

export function isMediaFile(fileData) {
  const extension = fileData.extension.toLowerCase();
  return (
    imageExtensions.includes(extension) || videoExtensions.includes(extension)
  );
}

export function mediaKind(fileData) {
  return imageExtensions.includes(fileData.extension.toLowerCase())
    ? "Image"
    : "Video";
}

export function matchesFileFilter(fileData, query) {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return true;
  const extensionQuery = cleanQuery.startsWith(".")
    ? cleanQuery.slice(1)
    : cleanQuery;
  return (
    fileData.name.toLowerCase().includes(cleanQuery) ||
    fileData.path.toLowerCase().includes(cleanQuery) ||
    fileData.extension.toLowerCase() === extensionQuery
  );
}

export function promptBulkSaveOptions({
  title = "Save Options",
  description = "Choose how you want to save the processed files:",
  allowReplace = true,
  newLabel = "Save as New Files...",
  newDesc = "Choose a destination folder to export the new files"
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("bulk-save-modal");
    if (!modal) {
      resolve({ choice: "cancel" });
      return;
    }
    const titleEl = document.getElementById("bulk-save-title");
    const descEl = document.getElementById("bulk-save-desc");
    const replaceBtn = document.getElementById("btn-bulk-save-replace");
    const newBtn = document.getElementById("btn-bulk-save-new");
    const newLabelEl = document.getElementById("bulk-save-new-label");
    const newDescEl = document.getElementById("bulk-save-new-desc");
    const cancelBtn = document.getElementById("btn-cancel-bulk-save");
    const closeBtn = document.getElementById("btn-close-bulk-save");

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = description;
    if (replaceBtn) replaceBtn.style.display = allowReplace ? "flex" : "none";
    if (newLabelEl) newLabelEl.textContent = newLabel;
    if (newDescEl) newDescEl.textContent = newDesc;

    modal.style.display = "flex";
    focusFirstControl(modal);

    const cleanup = () => {
      modal.style.display = "none";
      if (replaceBtn) replaceBtn.onclick = null;
      if (newBtn) newBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener("keydown", handleKeydown);
    };

    const handleKeydown = (e) => {
      if (e.key !== "Escape") return;
      cleanup();
      resolve({ choice: "cancel" });
    };
    document.addEventListener("keydown", handleKeydown);

    modal.onclick = (e) => {
      if (e.target === modal) {
        cleanup();
        resolve({ choice: "cancel" });
      }
    };

    if (replaceBtn) {
      replaceBtn.onclick = () => {
        cleanup();
        resolve({ choice: "replace" });
      };
    }

    if (newBtn) {
      newBtn.onclick = async () => {
        const folderRes = await window.electronAPI.selectFolderDialog();
        if (!folderRes.canceled && folderRes.filePaths.length > 0) {
          const destFolder = folderRes.filePaths[0];
          cleanup();
          resolve({ choice: "new", outputDir: destFolder });
        }
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        cleanup();
        resolve({ choice: "cancel" });
      };
    }

    if (closeBtn) {
      closeBtn.onclick = () => {
        cleanup();
        resolve({ choice: "cancel" });
      };
    }
  });
}
