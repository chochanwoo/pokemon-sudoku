import { getLanguage, t } from "./i18n.js";

export const siteBrand = () =>
  `<a class="brand" href="./" aria-label="${t("포켓몬 퀴즈 메인으로")}"><span class="brand-mark"><i data-lucide="gamepad-2" aria-hidden="true"></i></span><span>${t("포켓몬 퀴즈")}<span class="brand-caption">POKÉMON QUIZ</span></span></a>`;
export const languagePicker = () =>
  `<label class="language-picker icon-button" title="${t("언어 선택")}"><i data-lucide="languages" aria-hidden="true"></i><select data-language-select aria-label="${t("언어 선택")}"><option value="ko" lang="ko" ${getLanguage() === "ko" ? "selected" : ""}>한국어</option><option value="en" lang="en" ${getLanguage() === "en" ? "selected" : ""}>English</option></select></label>`;
