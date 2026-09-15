import { formatSize, escapeHtml, matchesFileFilter } from "./utils.js";
import { progressState } from "./progress.js";
import {
  focusFirstControl,
  handleVerticalNavigation,
  isKeyboardActivation,
  makeKeyboardAction,
} from "./keyboard.js";

const checkedFiles = new Map();
const exifDataCache = new Map();
let exifContextMenu = null;
let rootDirectoryPath = null;
let allRootFiles = [];
let middleFilterQuery = "";
let sidebarFilterQuery = "";
let currentDisplayFiles = [];
let selectedTableFiles = new Set();
let previewFilePath = null;
let lastClickedNode = null;
let isBatchUpdating = false;

function hasSingleExtension(paths) {
  const exts = new Set(
    paths.map((p) =>
      (
        checkedFiles.get(p)?.extension ||
        p.split(".").pop() ||
        ""
      ).toLowerCase(),
    ),
  );
  return exts.size <= 1;
}

export function initMetadata() {
  document
    .getElementById("folder-path-input")
    .addEventListener("keypress", (e) => {
      if (e.key === "Enter" && e.target.value.trim())
        loadRootDirectory(e.target.value.trim());
    });

  document
    .getElementById("sidebar-filter-input")
    .addEventListener("input", (e) => {
      sidebarFilterQuery = e.target.value;
      applySidebarFilter();
    });

  document
    .getElementById("middle-filter-input")
    .addEventListener("input", (e) => {
      middleFilterQuery = e.target.value;
      updateDetailsTable();
    });

  document
    .getElementById("select-filtered-btn")
    .addEventListener("click", () => {
      if (!sidebarFilterQuery.trim()) return;
      allRootFiles
        .filter((f) => matchesFileFilter(f, sidebarFilterQuery.trim()))
        .forEach((f) => checkedFiles.set(f.path, f));
      updateDetailsTable();
      applySidebarFilter();
    });

  document.getElementById("unselect-all-btn").addEventListener("click", () => {
    checkedFiles.clear();
    selectedTableFiles.clear();
    previewFilePath = null;
    document
      .querySelectorAll(".tree-checkbox")
      .forEach((cb) => (cb.checked = false));
    document
      .querySelectorAll(".tree-item.selected")
      .forEach((el) => el.classList.remove("selected"));
    updateDetailsTable();
  });

  const handleMasterCheckbox = (e) => {
    if (e.target.checked) {
      currentDisplayFiles.forEach((f) => selectedTableFiles.add(f.path));
      previewFilePath = null;
    } else {
      currentDisplayFiles.forEach((f) => selectedTableFiles.delete(f.path));
    }
    syncSelectionUI();
    loadInspectorData();
  };
  document
    .getElementById("master-table-checkbox")
    .addEventListener("change", handleMasterCheckbox);
  document
    .getElementById("global-master-checkbox")
    .addEventListener("change", handleMasterCheckbox);

  document
    .getElementById("fetch-exif-btn")
    .addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.style.pointerEvents = "none";
      document.body.style.cursor = "wait";
      window.showProgress("Fetching EXIF Metadata");

      let done = 0;
      const paths = Array.from(selectedTableFiles);
      for (let i = 0; i < paths.length; i++) {
        if (progressState.isCancelled) break;
        const p = paths[i];
        if (!exifDataCache.has(p)) {
          const res = await window.electronAPI.getExifData(p);
          if (!res.error) exifDataCache.set(p, res);
        }
        done++;
        window.updateProgress(
          done,
          paths.length,
          `Reading: ${p.split("\\").pop().split("/").pop()}`,
        );
      }
      window.hideProgress();
      document.body.style.cursor = "default";
      btn.style.pointerEvents = "auto";
      loadInspectorData();
    });

  window.electronAPI.onMetadataUpdated(async (paths) => {
    for (const p of paths) {
      const res = await window.electronAPI.getExifData(p);
      if (!res.error) exifDataCache.set(p, res);
    }
    loadInspectorData();
    updateDetailsTable();
  });

  document
    .getElementById("toggle-sidebar-btn")
    .addEventListener("click", function () {
      const sr = document.getElementById("sidebar-right");
      const rr = document.getElementById("resizer-right");
      if (sr.style.display !== "none") {
        sr.style.display = "none";
        rr.style.display = "none";
        this.classList.remove("active");
      } else {
        sr.style.display = "block";
        rr.style.display = "block";
        this.classList.add("active");
        loadInspectorData();
      }
    });

  document.addEventListener("click", hideExifContextMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideExifContextMenu();
  });
  window.addEventListener("blur", hideExifContextMenu);
  window.addEventListener("resize", hideExifContextMenu);
}

export async function loadRootDirectory(path) {
  rootDirectoryPath = path;
  document.getElementById("folder-path-input").value = path;
  checkedFiles.clear();
  selectedTableFiles.clear();
  previewFilePath = null;
  lastClickedNode = null;
  updateDetailsTable();
  document.getElementById("main-empty-state").style.display = "none";
  document.getElementById("main-table-view").style.display = "flex";

  await renderDirectory(path, document.getElementById("file-tree"));
  const files = await window.electronAPI.readDirectoryRecursive(path);
  allRootFiles = files.error ? [] : files;
  applySidebarFilter();
}

function applySidebarFilter() {
  const tree = document.getElementById("file-tree");
  const query = sidebarFilterQuery.trim();
  if (!query) {
    if (rootDirectoryPath) renderDirectory(rootDirectoryPath, tree);
    return;
  }

  const matches = allRootFiles.filter((f) => matchesFileFilter(f, query));
  tree.innerHTML = matches.length
    ? ""
    : '<div class="empty-state">No files match this filter.</div>';

  matches.forEach((f) => {
    const item = document.createElement("div");
    item.className = "tree-item file";
    item.innerHTML = `<input type="checkbox" class="tree-checkbox" ${checkedFiles.has(f.path) ? "checked" : ""}><div class="item-content" style="display: flex; align-items: center; flex: 1; min-width: 0;"><span class="folder-toggle empty"></span><span class="material-symbols-rounded icon">draft</span><span class="name" title="${f.path}">${f.name}</span></div>`;
    const cb = item.querySelector(".tree-checkbox");
    cb.addEventListener("change", () => {
      cb.checked ? checkedFiles.set(f.path, f) : checkedFiles.delete(f.path);
      updateDetailsTable();
    });
    const content = item.querySelector(".item-content");
    const toggleFilteredFile = () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    };
    content.setAttribute("aria-label", `Select ${f.name}`);
    makeKeyboardAction(content, toggleFilteredFile);
    content.addEventListener("keydown", (e) =>
      handleVerticalNavigation(e, content, "#file-tree .item-content"),
    );
    content.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      toggleFilteredFile();
    });
    tree.appendChild(item);
  });
}

function hideExifContextMenu() {
  if (exifContextMenu) {
    exifContextMenu.remove();
    exifContextMenu = null;
  }
}

async function showExifContextMenu(e, fileData) {
  e.preventDefault();
  e.stopPropagation();
  hideExifContextMenu();
  const copiedText = await window.electronAPI.readText();
  let payload = null;
  try {
    const p = JSON.parse(copiedText);
    if (p?.sarviaStudioPayload === "exif-metadata") payload = p;
  } catch (err) {}

  const canCopy = exifDataCache.has(fileData.path);
  const canPaste = Boolean(payload);
  if (!canCopy && !canPaste) return;

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML = `${canCopy ? `<button type="button" class="context-menu-item"><span class="material-symbols-rounded">content_copy</span><span>Copy EXIF Metadata</span></button>` : ""}${canPaste ? `<button type="button" class="context-menu-item" data-action="paste"><span class="material-symbols-rounded">content_paste</span><span>Paste EXIF Metadata</span></button>` : ""}`;
  document.body.appendChild(menu);
  menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;

  const cBtn = menu.querySelector(".context-menu-item:not([data-action])");
  if (cBtn)
    cBtn.addEventListener("click", async () => {
      await window.electronAPI.copyText(
        JSON.stringify(
          {
            sarviaStudioPayload: "exif-metadata",
            fileName: fileData.name,
            filePath: fileData.path,
            fileExtension: fileData.extension,
            exif: exifDataCache.get(fileData.path),
          },
          null,
          2,
        ),
      );
      hideExifContextMenu();
    });

  const pBtn = menu.querySelector('[data-action="paste"]');
  if (pBtn)
    pBtn.addEventListener("click", async () => {
      hideExifContextMenu();
      if (
        payload.fileExtension.toLowerCase() !== fileData.extension.toLowerCase()
      ) {
        alert(
          `Extensions must match.\nCopied: .${payload.fileExtension}\nTarget: .${fileData.extension}`,
        );
        return;
      }
      document.body.style.cursor = "wait";
      const res = await window.electronAPI.pasteExifMetadata(
        payload.filePath,
        fileData.path,
      );
      window.hideProgress();
      document.body.style.cursor = "default";
      if (res.error) {
        alert(res.error);
        return;
      }
      const rExif = await window.electronAPI.getExifData(fileData.path);
      if (!rExif.error) exifDataCache.set(fileData.path, rExif);
      loadInspectorData();
      updateDetailsTable();
	    });
	  exifContextMenu = menu;
	  focusFirstControl(menu);
	}

function syncSelectionUI() {
  document.querySelectorAll("#details-body tr, .grid-item").forEach((r) => {
    const p = r.getAttribute("data-path");
    const cb = r.querySelector("input[type='checkbox']");
    const isTable = r.tagName === "TR";
    if (selectedTableFiles.has(p)) {
      r.classList.add(isTable ? "selected-row" : "selected-item");
      cb.checked = true;
    } else if (previewFilePath === p && selectedTableFiles.size === 0) {
      r.classList.add(isTable ? "selected-row" : "selected-item");
      cb.checked = false;
    } else {
      r.classList.remove(isTable ? "selected-row" : "selected-item");
      cb.checked = false;
    }
  });

  const isAll =
    currentDisplayFiles.length > 0 &&
    currentDisplayFiles.every((f) => selectedTableFiles.has(f.path));
  if (document.getElementById("master-table-checkbox"))
    document.getElementById("master-table-checkbox").checked = isAll;
  if (document.getElementById("global-master-checkbox"))
    document.getElementById("global-master-checkbox").checked = isAll;
  const fb = document.getElementById("fetch-exif-btn");
  if (fb) fb.style.display = selectedTableFiles.size > 0 ? "flex" : "none";
}

function updateDetailsTable() {
  const tbody = document.getElementById("details-body");
  const gridBody = document.getElementById("grid-container");
  let hc = document.getElementById("hover-card");
  tbody.innerHTML = "";
  gridBody.innerHTML = "";

  let changed = false;
  for (const p of selectedTableFiles) {
    if (!checkedFiles.has(p)) {
      selectedTableFiles.delete(p);
      changed = true;
    }
  }
  if (previewFilePath && !checkedFiles.has(previewFilePath)) {
    previewFilePath = null;
    changed = true;
  }
  if (changed) loadInspectorData();

  currentDisplayFiles = Array.from(checkedFiles.values()).filter((f) =>
    matchesFileFilter(f, middleFilterQuery),
  );
  currentDisplayFiles.forEach((data) => {
    const ext = data.extension.toUpperCase();
    let iconName = "draft";
    if (["JPG", "JPEG", "PNG", "GIF", "SVG", "WEBP"].includes(ext))
      iconName = "image";
    else if (["MP4", "MKV", "AVI", "MOV"].includes(ext)) iconName = "movie";
    else if (["MP3", "WAV", "OGG", "FLAC"].includes(ext))
      iconName = "audio_file";
    else if (["PDF"].includes(ext)) iconName = "picture_as_pdf";
    else if (["TXT", "CSV", "JSON", "XML"].includes(ext))
      iconName = "description";

    const row = document.createElement("tr");
    row.setAttribute("data-path", data.path);
    row.innerHTML = `<td style="text-align: center;"><input type="checkbox" class="table-checkbox"></td><td title="${escapeHtml(data.name)}"><span style="overflow: hidden; text-overflow: ellipsis; display: block; max-width: 100%;">${escapeHtml(data.name)}</span></td><td>${new Date(data.modified).toLocaleString()}</td><td>${ext} File</td><td>${formatSize(data.size)}</td>`;

    const gridItem = document.createElement("div");
    gridItem.className = "grid-item";
    gridItem.setAttribute("data-path", data.path);
    gridItem.innerHTML = `<input type="checkbox" class="grid-checkbox"><span class="material-symbols-rounded grid-icon">${iconName}</span><span class="grid-name" title="${escapeHtml(data.name)}">${escapeHtml(data.name)}</span>`;

    gridItem.addEventListener("mouseenter", () => {
      hc.innerHTML = `<div class="hover-card-title">${escapeHtml(data.name)}</div><div class="hover-card-row"><span>Type:</span><span>${ext} File</span></div><div class="hover-card-row"><span>Size:</span><span>${formatSize(data.size)}</span></div><div class="hover-card-row"><span>Modified:</span><span>${new Date(data.modified).toLocaleString()}</span></div>${exifDataCache.has(data.path) ? '<div class="hover-card-row" style="margin-top: 6px; justify-content: center;"><span style="color:var(--gts-purple); font-weight: 400;">★ EXIF Extracted</span></div>' : ""}`;
      hc.style.display = "flex";
      setTimeout(() => (hc.style.opacity = "1"), 10);
    });
    gridItem.addEventListener("mousemove", (e) => {
      hc.style.left = e.clientX + 15 + "px";
      hc.style.top = e.clientY + 15 + "px";
    });
    gridItem.addEventListener("mouseleave", () => {
      hc.style.opacity = "0";
      setTimeout(() => (hc.style.display = "none"), 150);
    });

    const handleInt = (e) => {
      if (e.type === "mousedown" && e.button !== 0) return;
      const isCb = e.target.tagName === "INPUT";
      if (isCb) e.preventDefault();
      if (isCb || e.metaKey || e.ctrlKey || selectedTableFiles.size > 0) {
        if (selectedTableFiles.has(data.path)) {
          selectedTableFiles.delete(data.path);
          if (selectedTableFiles.size === 0) previewFilePath = data.path;
        } else {
          selectedTableFiles.add(data.path);
          previewFilePath = null;
        }
      } else {
        previewFilePath = data.path;
      }
      syncSelectionUI();
      loadInspectorData();
    };

    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Preview or select ${data.name}`);
    gridItem.tabIndex = 0;
    gridItem.setAttribute("role", "button");
    gridItem.setAttribute("aria-label", `Preview or select ${data.name}`);

    const handleRowKey = (e, element, selector) => {
      if (isKeyboardActivation(e)) {
        e.preventDefault();
        handleInt(e);
      } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        const rect = element.getBoundingClientRect();
        showExifContextMenu(
          {
            preventDefault: () => e.preventDefault(),
            stopPropagation: () => e.stopPropagation(),
            clientX: rect.left + 16,
            clientY: rect.top + 16,
          },
          data,
        );
      } else {
        handleVerticalNavigation(e, element, selector);
      }
    };

    row.addEventListener("mousedown", handleInt);
    gridItem.addEventListener("mousedown", handleInt);
    row.addEventListener("keydown", (e) =>
      handleRowKey(e, row, "#details-tbody tr"),
    );
    gridItem.addEventListener("keydown", (e) =>
      handleRowKey(e, gridItem, "#grid-container .grid-item"),
    );
    row.addEventListener("contextmenu", (e) => showExifContextMenu(e, data));
    gridItem.addEventListener("contextmenu", (e) =>
      showExifContextMenu(e, data),
    );
    tbody.appendChild(row);
    gridBody.appendChild(gridItem);
  });

  syncSelectionUI();
  document.getElementById("file-count").textContent = middleFilterQuery
    ? `${currentDisplayFiles.length} of ${checkedFiles.size} items listed`
    : `${checkedFiles.size} items listed`;
  const d = checkedFiles.size > 0 ? "flex" : "none";
  document.getElementById("unselect-all-btn").style.display = d;
  document.getElementById("global-select-all-container").style.display = d;
  if (checkedFiles.size === 0) resetInspector();
}

async function renderDirectory(
  path,
  containerElement,
  parentIsChecked = false,
) {
  containerElement.innerHTML =
    '<div class="tree-item" style="color: #888; padding-left: 25px;">Loading...</div>';
  const entries = await window.electronAPI.readDirectory(path);
  if (entries.error) {
    containerElement.innerHTML = `<div class="tree-item" style="color: #f48771; padding-left: 10px;">Error: ${entries.error}</div>`;
    return;
  }
  containerElement.innerHTML = "";

  entries.forEach((entry) => {
    const node = document.createElement("div");
    node.className = "tree-node";
    const item = document.createElement("div");
    item.className = `tree-item ${entry.isDirectory ? "folder" : "file"}`;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "tree-checkbox";

    if (parentIsChecked) {
      cb.checked = true;
      if (!entry.isDirectory) checkedFiles.set(entry.path, entry);
    }
    const toggle = entry.isDirectory
      ? '<span class="material-symbols-rounded folder-toggle">chevron_right</span>'
      : '<span class="folder-toggle empty"></span>';
    let iconName = "draft";
    if (entry.isDirectory) iconName = "folder";
    else {
      const ext = entry.extension;
      if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext))
        iconName = "image";
      else if (["mp4", "mkv", "avi", "mov"].includes(ext)) iconName = "movie";
      else if (["mp3", "wav", "ogg", "flac"].includes(ext))
        iconName = "audio_file";
      else if (["pdf"].includes(ext)) iconName = "picture_as_pdf";
      else if (["txt", "csv", "json", "xml"].includes(ext))
        iconName = "description";
    }

    const content = document.createElement("div");
    content.className = "item-content";
    content.style.display = "flex";
    content.style.alignItems = "center";
    content.style.flex = "1";
    content.style.minWidth = "0";
    content.innerHTML = `${toggle}<span class="material-symbols-rounded icon">${iconName}</span><span class="name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>`;
    item.appendChild(cb);
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
        lastClickedNode = item;
        const shouldOpen =
          forceOpen === null ? !item.classList.contains("open") : forceOpen;
        if (shouldOpen) {
          item.classList.add("open");
          childrenContainer.classList.add("open");
          if (!isLoaded) {
            await renderDirectory(entry.path, childrenContainer, cb.checked);
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
          handleVerticalNavigation(e, content, "#file-tree .item-content");
        }
      });
      syncExpandedState();
      cb.addEventListener("change", async () => {
        childrenContainer
          .querySelectorAll(".tree-checkbox")
          .forEach((c) => (c.checked = cb.checked));
        if (cb.checked) {
          document.body.style.cursor = "wait";
          const files = await window.electronAPI.readDirectoryRecursive(
            entry.path,
          );
          if (!files.error) files.forEach((f) => checkedFiles.set(f.path, f));
          document.body.style.cursor = "default";
        } else {
          const prefix = entry.path + (entry.path.includes("\\") ? "\\" : "/");
          for (const p of checkedFiles.keys()) {
            if (p.startsWith(prefix)) checkedFiles.delete(p);
          }
        }
        updateDetailsTable();
      });
      content.addEventListener("mousedown", async (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        toggleDirectory();
      });
    } else {
      cb.addEventListener("change", () => {
        cb.checked
          ? checkedFiles.set(entry.path, entry)
          : checkedFiles.delete(entry.path);
        if (!isBatchUpdating) updateDetailsTable();
	      });
	      const toggleFile = (e = {}) => {
	        if (e.stopPropagation) e.stopPropagation();
	        const check = !cb.checked;
        if (e.shiftKey && lastClickedNode) {
          const nodes = Array.from(document.querySelectorAll(".tree-item"));
          const cIdx = nodes.indexOf(item);
          const lIdx = nodes.indexOf(lastClickedNode);
          if (cIdx !== -1 && lIdx !== -1) {
            isBatchUpdating = true;
            for (let i = Math.min(cIdx, lIdx); i <= Math.max(cIdx, lIdx); i++) {
              const n = nodes[i];
              if (n.classList.contains("file")) {
                const tb = n.querySelector(".tree-checkbox");
                if (tb && tb.checked !== check) {
                  tb.checked = check;
                  tb.dispatchEvent(new Event("change"));
                }
              }
            }
            isBatchUpdating = false;
            updateDetailsTable();
          }
        } else {
          cb.checked = check;
          cb.dispatchEvent(new Event("change"));
        }
        lastClickedNode = item;
        document
          .querySelectorAll(".tree-item.selected")
          .forEach((el) => el.classList.remove("selected"));
        item.classList.add("selected");
      };
      content.setAttribute("aria-label", `Select ${entry.name}`);
      makeKeyboardAction(content, toggleFile);
      content.addEventListener("keydown", (e) =>
        handleVerticalNavigation(e, content, "#file-tree .item-content"),
      );
      content.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        toggleFile(e);
      });
    }
    containerElement.appendChild(node);
  });
  if (parentIsChecked && !isBatchUpdating) updateDetailsTable();
}

function resetInspector() {
  selectedTableFiles.clear();
  previewFilePath = null;
  document.getElementById("inspector-empty").style.display = "block";
  document.getElementById("inspector-content").style.display = "none";
  document.getElementById("inspector-multi").style.display = "none";
}

async function loadInspectorData() {
  const empty = document.getElementById("inspector-empty");
  const content = document.getElementById("inspector-content");
  const multi = document.getElementById("inspector-multi");
  const previewBtn = document.getElementById("multi-preview-exif-btn");
  if (document.getElementById("sidebar-right").style.display === "none") return;
  empty.style.display = "none";
  content.style.display = "none";
  multi.style.display = "none";
  previewBtn.style.display = "none";

  if (selectedTableFiles.size > 1) {
    let totalSize = 0;
    const counts = {};
    selectedTableFiles.forEach((p) => {
      const d = checkedFiles.get(p);
      if (d) {
        totalSize += d.size;
        counts[d.extension.toUpperCase() + " File"] =
          (counts[d.extension.toUpperCase() + " File"] || 0) + 1;
      }
    });
    document.getElementById("multi-count").textContent =
      `${selectedTableFiles.size} Files Selected`;
    document.getElementById("multi-size").textContent =
      `Total Size: ${formatSize(totalSize)}`;
    document.getElementById("multi-types").innerHTML = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([t, c]) =>
          `<div style="display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; border-bottom: 1px solid rgba(0,0,0,0.05); color: var(--text-main);"><span>${t}</span><span style="font-weight: 400; color: var(--gts-blue);">${c}</span></div>`,
      )
      .join("");

    const paths = Array.from(selectedTableFiles);
    const cachedPath = paths.find((p) => exifDataCache.has(p));
    if (cachedPath && hasSingleExtension(paths)) {
      previewBtn.style.display = "flex";
      previewBtn.onclick = () =>
        window.electronAPI.openExifWindow({
          filename: checkedFiles.get(cachedPath).name,
          filePath: checkedFiles.get(cachedPath).path,
          extension: checkedFiles.get(cachedPath).extension,
          targetPaths: paths,
          exifData: exifDataCache.get(cachedPath),
          theme: document.documentElement.getAttribute("data-theme") || "light",
        });
    }
    multi.style.display = "flex";
  } else if (
    selectedTableFiles.size === 1 ||
    (selectedTableFiles.size === 0 && previewFilePath)
  ) {
    document.body.style.cursor = "wait";
    const path =
      selectedTableFiles.size === 1
        ? Array.from(selectedTableFiles)[0]
        : previewFilePath;
    const d = await window.electronAPI.getFileDetails(path);
    document.body.style.cursor = "default";
    if (d.error) return;

    const img = document.getElementById("meta-img");
    const icon = document.getElementById("meta-icon");
    if (d.thumbnail) {
      img.src = d.thumbnail;
      img.style.display = "block";
      icon.style.display = "none";
    } else {
      img.style.display = "none";
      icon.style.display = "block";
      icon.textContent = ["jpg", "png", "jpeg", "gif"].includes(d.extension)
        ? "image"
        : ["mp4", "mov"].includes(d.extension)
          ? "movie"
          : "draft";
    }

    document.getElementById("meta-name").textContent = d.name;
    document.getElementById("meta-kind").textContent =
      d.extension.toUpperCase() + " File";
    document.getElementById("meta-size").textContent = formatSize(d.size);
    document.getElementById("meta-created").textContent = new Date(
      d.created,
    ).toLocaleString();
    document.getElementById("meta-modified").textContent = new Date(
      d.modified,
    ).toLocaleString();
    document.getElementById("meta-path").textContent = d.path;

    const eSec = document.getElementById("exif-section");
    const eList = document.getElementById("exif-data-list");
    if (exifDataCache.has(path)) {
      const data = exifDataCache.get(path);
      eList.innerHTML = "";
      const ignores = [
        "SourceFile",
        "ExifToolVersion",
        "FileName",
        "Directory",
        "FileSize",
        "FileModifyDate",
        "FileAccessDate",
        "FileInodeChangeDate",
      ];
      for (const [k, v] of Object.entries(data)) {
        if (!ignores.includes(k) && typeof v !== "object")
          eList.innerHTML += `<div class="exif-item"><span>${k}</span><span>${escapeHtml(v)}</span></div>`;
      }
      eSec.style.display = "block";
      document.getElementById("expand-exif-btn").onclick = () =>
        window.electronAPI.openExifWindow({
          filename: d.name,
          filePath: d.path,
          extension: d.extension,
          targetPaths:
            selectedTableFiles.size > 0
              ? Array.from(selectedTableFiles)
              : [path],
          exifData: data,
          theme: document.documentElement.getAttribute("data-theme") || "light",
        });
    } else {
      eSec.style.display = "none";
    }
    content.style.display = "flex";
  } else {
    empty.style.display = "block";
  }
}
