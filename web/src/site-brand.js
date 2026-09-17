import { getLanguage, t } from "./i18n.js";

export const siteBrand = () =>
  `<a class="brand" href="./" aria-label="${t("포켓몬 퀴즈 메인으로")}"><span class="brand-mark"><i data-lucide="tree-palm" aria-hidden="true"></i></span><span class="brand-wordmark">alola<span class="brand-caption">${t("포켓몬 퀴즈")}</span></span></a>`;
export const languagePicker = () =>
  `<div class="language-picker">
    <button type="button" class="language-trigger" data-language-trigger aria-label="${t("언어 선택")}" title="${t("언어 선택")}" aria-haspopup="menu" aria-expanded="false" aria-controls="language-menu"><i data-lucide="languages" aria-hidden="true"></i><span>${getLanguage().toUpperCase()}</span><i data-lucide="chevron-down" aria-hidden="true"></i></button>
    <div class="language-menu" id="language-menu" role="menu" aria-label="${t("언어 선택")}" hidden>
      <button type="button" class="language-option" role="menuitemradio" data-language-option="ko" lang="ko" aria-checked="${getLanguage() === "ko"}" tabindex="-1"><span>한국어</span><i data-lucide="check" aria-hidden="true"></i></button>
      <button type="button" class="language-option" role="menuitemradio" data-language-option="en" lang="en" aria-checked="${getLanguage() === "en"}" tabindex="-1"><span>English</span><i data-lucide="check" aria-hidden="true"></i></button>
    </div>
  </div>`;
