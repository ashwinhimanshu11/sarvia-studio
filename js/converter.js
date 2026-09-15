import {
  formatSize,
  escapeHtml,
  isMediaFile,
  mediaKind,
  matchesFileFilter,
} from "./utils.js";
import { handleVerticalNavigation, makeKeyboardAction } from "./keyboard.js";

let converterAllFiles = [];
let converterVisibleFiles = [];
let converterSelectedFiles = new Set();
let converterFilterQuery = "";

export function initConverter() {
  const converterFolderInput = document.getElementById(
    "converter-folder-input",
  );
  const converterFilterInput = document.getElementById(
    "converter-filter-input",
  );
  const converterSelectVisibleBtn = document.getElementById(
    "converter-select-visible-btn",
  );
  const converterClearBtn = document.getElementById("converter-clear-btn");
  const converterStartBtn = document.getElementById("converter-start-btn");

  converterFolderInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const path = converterFolderInput.value.trim();
      if (path) loadConverterFolder(path);
    }
  });

  converterFilterInput.addEventListener("input", () => {
    converterFilterQuery = converterFilterInput.value;
    renderConverterFiles();
  });

  converterSelectVisibleBtn.addEventListener("click", () => {
    converterVisibleFiles.forEach((file) =>
      converterSelectedFiles.add(file.path),
    );
    renderConverterFiles();
  });

  converterClearBtn.addEventListener("click", () => {
    converterSelectedFiles.clear();
    renderConverterFiles();
  });

  converterStartBtn.addEventListener("click", async () => {
    const selectedFiles = Array.from(converterSelectedFiles);
    if (selectedFiles.length === 0) {
      alert("Select at least one media file to convert.");
      return;
    }

    const formatSelect = document.getElementById("converter-format-select");
    const resultsBox = document.getElementById("converter-results");

    converterStartBtn.style.pointerEvents = "none";
    converterStartBtn.innerHTML =
      '<span class="material-symbols-rounded spinning" style="font-size: 16px; margin-right: 6px;">progress_activity</span> Converting...';
    resultsBox.innerHTML =
      '<div class="conversion-result"><span class="material-symbols-rounded spinning">progress_activity</span><div><strong>Converting files...</strong><span>This may take a moment for large videos.</span></div></div>';

    const result = await window.electronAPI.convertMediaFiles({
      files: selectedFiles,
      targetExtension: formatSelect.value,
    });

    window.hideProgress();
    converterStartBtn.style.pointerEvents = "auto";
    converterStartBtn.innerHTML =
      '<span class="material-symbols-rounded" style="font-size: 16px; margin-right: 6px;">published_with_changes</span> Convert';

    if (result.error && !result.results) {
      alert(result.error);
      resultsBox.innerHTML = "";
      return;
    }
    if (result.error) alert(result.error);

    resultsBox.innerHTML = "";
    (result.results || []).forEach((r) => {
      const item = document.createElement("div");
      item.className = `conversion-result ${r.error ? "error" : ""}`;
      item.innerHTML = `<span class="material-symbols-rounded">${r.error ? "error" : "check_circle"}</span><div><strong>${escapeHtml(r.error ? r.inputPath : r.outputPath)}</strong><span>${r.error ? escapeHtml(r.error) : "Converted successfully"}</span></div>`;
      resultsBox.appendChild(item);
    });
  });

  document.addEventListener('source-format-changed', (e) => {
    const ext = e.detail.toLowerCase();
    converterSelectedFiles.clear();
    
    if (ext === 'all') {
      converterVisibleFiles.forEach((file) => converterSelectedFiles.add(file.path));
    } else {
      converterVisibleFiles.forEach((file) => {
        if ((file.extension && file.extension.toLowerCase() === ext) || 
            file.name.toLowerCase().endsWith('.' + ext)) {
          converterSelectedFiles.add(file.path);
        }
      });
    }
    
    renderConverterFiles();
  });
}

export async function loadConverterFolder(path) {
  const converterFileList = document.getElementById("converter-file-list");
  document.getElementById("converter-folder-input").value = path;
  converterSelectedFiles.clear();
  document.getElementById("converter-results").innerHTML = "";
  document.getElementById("converter-empty-state").style.display = "none";
  converterFileList.innerHTML =
    '<div class="empty-state">Scanning media files...</div>';

  const files = await window.electronAPI.readDirectoryRecursive(path);
  if (files.error) {
    converterAllFiles = [];
    converterFileList.innerHTML = `<div class="empty-state">Could not read folder: ${escapeHtml(files.error)}</div>`;
    updateConverterCount();
    return;
  }

  converterAllFiles = files.filter(isMediaFile);
  renderConverterFiles();
}

function renderConverterFiles() {
  converterVisibleFiles = converterAllFiles.filter((file) =>
    matchesFileFilter(file, converterFilterQuery),
  );
  const list = document.getElementById("converter-file-list");
  list.innerHTML = "";

  if (converterAllFiles.length === 0) {
    list.innerHTML =
      '<div class="empty-state">No supported image or video files found.</div>';
    updateConverterCount();
    return;
  }
  if (converterVisibleFiles.length === 0) {
    list.innerHTML =
      '<div class="empty-state">No media files match this filter.</div>';
    updateConverterCount();
    return;
  }

  converterVisibleFiles.forEach((file) => {
    const row = document.createElement("div");
    row.className = "converter-file-row";
    row.innerHTML = `
            <input type="checkbox" ${converterSelectedFiles.has(file.path) ? "checked" : ""}>
            <div class="converter-file-name">
                <strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong>
                <span>${mediaKind(file)} · ${file.extension.toUpperCase()} · ${formatSize(file.size)}</span>
            </div>
            <span class="material-symbols-rounded">${mediaKind(file) === "Image" ? "image" : "movie"}</span>
        `;
    const cb = row.querySelector("input");
    cb.addEventListener("change", () => {
      cb.checked
        ? converterSelectedFiles.add(file.path)
        : converterSelectedFiles.delete(file.path);
      row.setAttribute("aria-checked", cb.checked ? "true" : "false");
      updateConverterCount();
    });

    const toggleRow = () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    };

    row.tabIndex = 0;
    row.setAttribute("role", "checkbox");
    row.setAttribute("aria-checked", cb.checked ? "true" : "false");
    row.setAttribute("aria-label", `Select ${file.name}`);
    makeKeyboardAction(row, toggleRow, null);
    row.addEventListener("keydown", (e) =>
      handleVerticalNavigation(e, row, ".converter-file-row"),
    );

    row.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target === cb) return;
      toggleRow();
    });
    list.appendChild(row);
  });
  updateConverterCount();
}

function updateConverterCount() {
  document.getElementById("converter-count").textContent =
    `${converterSelectedFiles.size} selected${converterFilterQuery ? `, ${converterVisibleFiles.length} visible` : ""}`;
}
