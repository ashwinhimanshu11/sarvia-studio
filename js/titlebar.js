function initTitlebar() {
  const titlebar = document.querySelector(".app-titlebar");
  if (!titlebar || !window.electronAPI?.windowControl) return;

  const maximizeIcon = titlebar.querySelector('[data-window-action="maximize"] .material-symbols-rounded');
  const maximizeButton = titlebar.querySelector('[data-window-action="maximize"]');

  titlebar.querySelectorAll("[data-window-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.windowAction;
      const result = await window.electronAPI.windowControl(action);
      if (action === "maximize" && result) {
        updateMaximizeState(result.isMaximized);
      }
    });
  });

  function updateMaximizeState(isMaximized) {
    if (maximizeIcon) {
      maximizeIcon.textContent = isMaximized ? "filter_none" : "crop_square";
    }
    if (maximizeButton) {
      maximizeButton.title = isMaximized ? "Restore" : "Maximize";
      maximizeButton.setAttribute("aria-label", isMaximized ? "Restore window" : "Maximize window");
    }
  }

  window.electronAPI.onWindowMaximizedState?.(updateMaximizeState);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTitlebar);
} else {
  initTitlebar();
}
