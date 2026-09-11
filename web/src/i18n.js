import english from "./locales/en.js";
import { englishName } from "./pokemon-names.js";

export const LANGUAGE_KEY = "pokemon-quiz:language";
const listeners = new Set();
function storedLanguage() {
  try {
    return globalThis.localStorage?.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}
let language = storedLanguage() === "en" ? "en" : "ko";
export const getLanguage = () => language;
export const locale = () => (language === "en" ? "en-US" : "ko-KR");
export function t(message, values = {}) {
  const template = language === "en" ? (english[message] ?? message) : message;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}
export const pokemonName = (pokemon) =>
  language === "en" ? englishName(pokemon) : pokemon.name;
export const typeName = (type) =>
  language === "en" ? type.key[0].toUpperCase() + type.key.slice(1) : type.name;

export function setLanguage(next) {
  if (!["ko", "en"].includes(next) || next === language) return false;
  language = next;
  try {
    globalThis.localStorage?.setItem(LANGUAGE_KEY, language);
  } catch {
    /* Language switching still works when browser storage is blocked. */
  }
  for (const listener of listeners) listener();
  return true;
}

export function initLanguage(title, render) {
  const update = () => {
    document.documentElement.lang = language;
    document.title = t(title);
  };
  update();
  listeners.add(() => {
    update();
    render();
  });
  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-language-select]")) return;
    if (setLanguage(event.target.value))
      document.querySelector("[data-language-select]")?.focus();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) setLanguage(storedLanguage());
  });
}
