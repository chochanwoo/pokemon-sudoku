import typedokuPreview from "./assets/typedoku-preview.png";
import pokemantlePreview from "./assets/pokemantle-preview.png";

export const games = [
  {
    id: "typedoku",
    title: "타입도쿠",
    category: "스도쿠",
    formats: "4 × 4 · 6 × 6 · 9 × 9",
    href: "./sudoku.html",
    image: typedokuPreview,
    imageAlt: "포켓몬과 타입 아이콘이 배치된 타입도쿠 4 × 4 보드",
  },
  {
    id: "pokemantle",
    title: "포켓몬틀",
    category: "유사도 추리",
    formats: "데일리 · 1,579개 모습",
    href: "./pokemantle.html",
    image: pokemantlePreview,
    imageAlt: "추측한 포켓몬의 유사도와 순위가 표시된 포켓몬틀 기록",
  },
];
