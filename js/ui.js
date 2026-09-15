import { isKeyboardActivation } from "./keyboard.js";

export function initUI() {
  const viewListBtn = document.getElementById("view-list-btn");
  const viewGridBtn = document.getElementById("view-grid-btn");
  const tableContainer = document.getElementById("table-container");
  const gridContainer = document.getElementById("grid-container");

  viewListBtn.addEventListener("click", () => {
    viewListBtn.classList.add("active");
    viewGridBtn.classList.remove("active");
    tableContainer.style.display = "block";
    gridContainer.style.display = "none";
  });

  viewGridBtn.addEventListener("click", () => {
    viewGridBtn.classList.add("active");
    viewListBtn.classList.remove("active");
    tableContainer.style.display = "none";
    gridContainer.style.display = "grid";
  });

  function setAppMode(mode) {
    if (mode) document.body.dataset.mode = mode;
    else document.body.removeAttribute("data-mode");
  }

  document
    .getElementById("open-metadata-mode")
    .addEventListener("click", () => setAppMode("metadata"));
  document
    .getElementById("open-converter-mode")
    .addEventListener("click", () => setAppMode("converter"));
  document
    .getElementById("open-editor-mode")
    .addEventListener("click", () => setAppMode("editor"));
  document
    .getElementById("open-video-editor-mode")
    .addEventListener("click", () => setAppMode("video-editor"));
  document
    .getElementById("open-audio-mode")
    .addEventListener("click", () => setAppMode("audio"));
  document
    .getElementById("converter-back-btn")
    .addEventListener("click", () => setAppMode(""));
  document
    .getElementById("metadata-back-btn")
    .addEventListener("click", () => setAppMode(""));
  document
    .getElementById("editor-back-btn")
    .addEventListener("click", () => setAppMode(""));
  document
    .getElementById("video-back-btn")
    .addEventListener("click", () => setAppMode(""));
  document
    .getElementById("audio-back-btn")
    .addEventListener("click", () => setAppMode(""));

  const globalSettingsBtn = document.getElementById("global-settings-btn");
  if (globalSettingsBtn) {
    globalSettingsBtn.addEventListener("click", () => setAppMode("settings"));
  }

  const settingsBackBtn = document.getElementById("settings-back-btn");
  if (settingsBackBtn) {
    settingsBackBtn.addEventListener("click", () => setAppMode(""));
  }

  // Windows First Time Setup Logic
  window.electronAPI.onShowSetupScreen(() => {
    setAppMode("setup");
  });

  const startSetupBtn = document.getElementById("start-setup-btn");
  const setupProgressContainer = document.getElementById("setup-progress-container");
  const setupProgressBar = document.getElementById("setup-progress-bar");
  const setupStatusText = document.getElementById("setup-status-text");
  const setupProgressPercent = document.getElementById("setup-progress-percent");

  if (startSetupBtn) {
    startSetupBtn.addEventListener("click", async () => {
      startSetupBtn.style.display = "none";
      setupProgressContainer.style.display = "block";
      
      const result = await window.electronAPI.startWindowsSetup();
      if (result.success) {
        setupStatusText.innerText = "Setup Complete!";
        setupProgressBar.style.width = "100%";
        setupProgressPercent.innerText = "100%";
        setTimeout(() => {
          setAppMode(""); // Go to main launcher
        }, 1500);
      } else {
        setupStatusText.innerText = "Error: " + result.error;
        setupStatusText.style.color = "#ef4444";
        startSetupBtn.style.display = "flex";
        startSetupBtn.innerText = "Retry Setup";
      }
    });
  }

  window.electronAPI.onSetupProgress(({ task, percent }) => {
    if (setupStatusText) setupStatusText.innerText = task;
    if (setupProgressBar) setupProgressBar.style.width = `${Math.round(percent * 100)}%`;
    if (setupProgressPercent) setupProgressPercent.innerText = `${Math.round(percent * 100)}%`;
  });

  function closeCustomDropdown(content, button) {
    content.classList.remove("show");
    button?.setAttribute("aria-expanded", "false");
  }

  function openCustomDropdown(content, button, focusFirst = false) {
    document.querySelectorAll(".custom-dropdown-content.show").forEach((open) => {
      if (open !== content) {
        open.classList.remove("show");
        document
          .querySelector(`[aria-controls="${open.id}"]`)
          ?.setAttribute("aria-expanded", "false");
      }
    });
    content.classList.add("show");
    button.setAttribute("aria-expanded", "true");
    if (focusFirst) {
      const firstItem = content.querySelector(".custom-dropdown-item");
      if (firstItem) firstItem.focus();
    }
  }

  function setupCustomDropdown(prefix, config = {}) {
    const button = document.getElementById(`btn-dd-${prefix}`);
    const content = document.getElementById(`content-dd-${prefix}`);
    if (!button || !content) return;

    const input = config.inputId ? document.getElementById(config.inputId) : null;
    const label = config.labelId ? document.getElementById(config.labelId) : null;
    const icon = config.iconId ? document.getElementById(config.iconId) : null;
    const items = Array.from(content.querySelectorAll(".custom-dropdown-item"));

    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", content.id);
    content.setAttribute("role", "listbox");

    const updateSelection = (item) => {
      if (input) input.value = item.dataset.value || "";
      const itemIcon = item.querySelector(".material-symbols-rounded");
      const iconText = itemIcon ? itemIcon.textContent : "";
      const itemText = item.textContent.replace(iconText, "").trim();

      if (icon) icon.textContent = iconText;
      if (label) {
        if (config.labelHtml) {
          label.innerHTML = config.labelHtml(iconText, itemText);
        } else {
          label.textContent = itemText;
        }
      }

      if (config.eventName) {
        document.dispatchEvent(
          new CustomEvent(config.eventName, { detail: input?.value }),
        );
      }
    };

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (content.classList.contains("show")) {
        closeCustomDropdown(content, button);
      } else {
        openCustomDropdown(content, button);
      }
    });

    button.addEventListener("keydown", (event) => {
      if (isKeyboardActivation(event) || event.key === "ArrowDown") {
        event.preventDefault();
        openCustomDropdown(content, button, true);
      } else if (event.key === "Escape") {
        closeCustomDropdown(content, button);
      }
    });

    items.forEach((item, index) => {
      item.tabIndex = -1;
      item.setAttribute("role", "option");
      item.addEventListener("click", () => {
        updateSelection(item);
        closeCustomDropdown(content, button);
      });
      item.addEventListener("keydown", (event) => {
        if (isKeyboardActivation(event)) {
          event.preventDefault();
          item.click();
          button.focus();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          items[(index + 1) % items.length]?.focus();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          items[(index - 1 + items.length) % items.length]?.focus();
        } else if (event.key === "Home") {
          event.preventDefault();
          items[0]?.focus();
        } else if (event.key === "End") {
          event.preventDefault();
          items[items.length - 1]?.focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeCustomDropdown(content, button);
          button.focus();
        }
      });
    });
  }

  setupCustomDropdown("source", {
    inputId: "converter-source-select",
    labelId: "source-label",
    eventName: "source-format-changed",
    labelHtml: (iconText, itemText) =>
      `<span class="material-symbols-rounded" style="font-size: 18px;">${iconText}</span> ${itemText}`,
  });
  setupCustomDropdown("format", {
    inputId: "converter-format-select",
    labelId: "format-label",
    labelHtml: (iconText, itemText) =>
      `<span class="material-symbols-rounded" style="font-size: 18px;">${iconText}</span> ${itemText}`,
  });
  setupCustomDropdown("bulk-mute");
  setupCustomDropdown("bulk-frame");
  setupCustomDropdown("bulk-redact");
  setupCustomDropdown("bulk-redact-mode", {
    inputId: "bulk-redact-mode",
    labelId: "bulk-redact-mode-label",
    iconId: "bulk-redact-mode-icon",
  });
  setupCustomDropdown("target", {
    inputId: "redact-target",
    labelId: "target-label",
    iconId: "target-icon",
  });
  setupCustomDropdown("mode", {
    inputId: "redact-mode",
    labelId: "mode-label",
    iconId: "mode-icon",
  });

  document.addEventListener("click", (event) => {
    document.querySelectorAll(".custom-dropdown-content.show").forEach((content) => {
      if (
        !content.contains(event.target) &&
        !event.target.closest(".custom-dropdown-btn")
      ) {
        const button = document.querySelector(`[aria-controls="${content.id}"]`);
        content.classList.remove("show");
        button?.setAttribute("aria-expanded", "false");
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".custom-dropdown-content.show").forEach((content) => {
      const button = document.querySelector(`[aria-controls="${content.id}"]`);
      closeCustomDropdown(content, button);
      button?.focus();
    });
    document.querySelectorAll(".dropdown-menu.show").forEach((menu) => {
      menu.classList.remove("show");
    });
  });


  // ==========================================
  // PERSISTENT THEME LOGIC
  // ==========================================
  const root = document.documentElement;
  const themeCheckbox = document.getElementById("theme-switch-checkbox");

  // Sync the checkbox with whatever was instantly loaded by the <head> script
  if (root.getAttribute("data-theme") === "dark") {
    themeCheckbox.checked = true;
  }

  // Handle Theme Checkbox Changes
  themeCheckbox.addEventListener("change", (e) => {
    if (e.target.checked) {
      root.setAttribute("data-theme", "dark");
      localStorage.setItem("gts-theme", "dark"); // Save to memory
    } else {
      root.removeAttribute("data-theme");
      localStorage.setItem("gts-theme", "light"); // Save to memory
    }
  });

  // ==========================================
  // UNIVERSAL RESIZER LOGIC
  // ==========================================
  let isResizingLeft = false,
    isResizingRight = false;
  let activeLeftSidebar = null,
    activeRightSidebar = null;

  document.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("resizer")) {
      // Check if this resizer is attached to a left or right sidebar
      const isLeft =
        e.target.previousElementSibling?.classList.contains("sidebar-left");

      if (isLeft) {
        isResizingLeft = true;
        activeLeftSidebar = e.target.previousElementSibling;
      } else {
        isResizingRight = true;
        activeRightSidebar = e.target.nextElementSibling;
      }

      document.body.style.cursor = "col-resize";
      e.target.classList.add("active");
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (isResizingLeft && activeLeftSidebar) {
      let w = Math.max(200, Math.min(e.clientX, 600));
      activeLeftSidebar.style.width = `${w}px`;
    }
    if (isResizingRight && activeRightSidebar) {
      let w = Math.max(
        200,
        Math.min(document.body.clientWidth - e.clientX, 600),
      );
      activeRightSidebar.style.width = `${w}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    isResizingLeft = false;
    isResizingRight = false;
    activeLeftSidebar = null;
    activeRightSidebar = null;
    document.body.style.cursor = "default";
    document
      .querySelectorAll(".resizer.active")
      .forEach((r) => r.classList.remove("active"));
  });
}
