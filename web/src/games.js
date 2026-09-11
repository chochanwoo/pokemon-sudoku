import typedokuPreview from "./assets/typedoku-preview.png";
import pokemantlePreview from "./assets/pokemantle-preview.png";
import typedokuPreviewEn from "./assets/typedoku-preview-en.png";
import pokemantlePreviewEn from "./assets/pokemantle-preview-en.png";

export const games = [
  {
    id: "typedoku",
    title: "타입도쿠",
    category: "스도쿠",
    formats: "4 × 4 · 6 × 6 · 9 × 9",
    href: "./sudoku.html",
    image: typedokuPreview,
    imageEn: typedokuPreviewEn,
    imageAlt: "포켓몬과 타입 아이콘이 배치된 타입도쿠 4 × 4 보드",
  },
  {
    id: "pokemantle",
    title: "포케맨틀",
    category: "유사도 추리",
    formats: "데일리",
    href: "./pokemantle.html",
    image: pokemantlePreview,
    imageEn: pokemantlePreviewEn,
    imageAlt: "추측한 포켓몬의 유사도와 순위가 표시된 포케맨틀 기록",
  },
];
