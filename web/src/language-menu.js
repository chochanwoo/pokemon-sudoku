export function initLanguageMenu(selectLanguage) {
  const picker = () => document.querySelector(".language-picker");
  const isOpen = () =>
    picker()
      ?.querySelector("[data-language-trigger]")
      .getAttribute("aria-expanded") === "true";
  const focusTrigger = () => {
    if (!document.querySelector("dialog[open]"))
      picker()
        ?.querySelector("[data-language-trigger]")
        .focus({ preventScroll: true });
  };
  const close = (restoreFocus = false) => {
    const root = picker();
    if (!root) return;
    root.querySelector(".language-menu").hidden = true;
    root
      .querySelector("[data-language-trigger]")
      .setAttribute("aria-expanded", "false");
    for (const option of root.querySelectorAll("[data-language-option]"))
      option.tabIndex = -1;
    if (restoreFocus) focusTrigger();
  };
  const focusOption = (option) => {
    for (const item of picker().querySelectorAll("[data-language-option]"))
      item.tabIndex = item === option ? 0 : -1;
    option.focus({ preventScroll: true });
  };
  const open = (edge) => {
    const root = picker();
    if (!root) return;
    root.querySelector(".language-menu").hidden = false;
    root
      .querySelector("[data-language-trigger]")
      .setAttribute("aria-expanded", "true");
    const options = [...root.querySelectorAll("[data-language-option]")];
    focusOption(
      edge === "first"
        ? options[0]
        : edge === "last"
          ? options.at(-1)
          : options.find(
              (option) => option.getAttribute("aria-checked") === "true",
            ),
    );
  };

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-language-trigger]")) {
      if (isOpen()) close(true);
      else open();
    } else {
      const option = event.target.closest("[data-language-option]");
      if (option) {
        close();
        selectLanguage(option.dataset.languageOption);
        focusTrigger();
      } else if (!event.target.closest(".language-picker")) close();
    }
  });
  document.addEventListener("focusin", (event) => {
    if (isOpen() && !event.target.closest(".language-picker")) close();
  });
  // Handle menu navigation before the games' global keyboard shortcuts.
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.target.closest(".language-picker")) return;
      if (event.key === "Escape" && !isOpen()) return;
      event.stopPropagation();
      if (event.key === "Tab") {
        if (isOpen()) close(true);
        return;
      }
      if (event.key === "Escape") {
        if (isOpen()) {
          event.preventDefault();
          close(true);
        }
        return;
      }
      if (!isOpen()) {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          open(event.key === "ArrowDown" ? "first" : "last");
        }
        return;
      }
      const options = [...picker().querySelectorAll("[data-language-option]")];
      const current = options.indexOf(document.activeElement);
      let next;
      if (event.key === "ArrowDown") next = (current + 1) % options.length;
      else if (event.key === "ArrowUp")
        next = (current - 1 + options.length) % options.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else if (event.key.length === 1 && event.key !== " ") {
        next = options.findIndex(
          (option) =>
            option.textContent
              .trim()
              .toLowerCase()
              .startsWith(event.key.toLowerCase()) ||
            option.dataset.languageOption.startsWith(event.key.toLowerCase()),
        );
      }
      if (next >= 0) {
        event.preventDefault();
        focusOption(options[next]);
      }
    },
    true,
  );
  window.addEventListener("resize", () => close(isOpen()));
}
