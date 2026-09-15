export function isKeyboardActivation(event) {
  return event.key === "Enter" || event.key === " ";
}

export function isTypingTarget(target) {
  if (!target) return false;
  const tagName = target.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function makeKeyboardAction(element, onActivate, role = "button") {
  if (!element || !onActivate) return;
  if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
  if (role && !element.hasAttribute("role")) element.setAttribute("role", role);

  element.addEventListener("keydown", (event) => {
    if (event.target !== element) return;
    if (!isKeyboardActivation(event)) return;
    event.preventDefault();
    onActivate(event);
  });
}

export function focusSibling(element, selector, direction) {
  const items = Array.from(document.querySelectorAll(selector)).filter(
    (item) => item.offsetParent !== null && !item.hasAttribute("disabled"),
  );
  const index = items.indexOf(element);
  if (index === -1) return;
  const next = items[index + direction];
  if (next) next.focus();
}

export function handleVerticalNavigation(event, element, selector) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusSibling(element, selector, 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusSibling(element, selector, -1);
  }
}

export function focusFirstControl(container) {
  if (!container) return;
  const first = container.querySelector(
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (first) first.focus();
}
