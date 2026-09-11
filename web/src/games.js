import typedokuPreview from "./assets/typedoku-preview.png";
import pokemantlePreview from "./assets/pokemantle-preview.png";
import typedokuPreviewEn from "./assets/typedoku-preview-en.png";
import pokemantlePreviewEn from "./assets/pokemantle-preview-en.png";
import pokecluePreview from "./assets/pokeclue-preview.png";
import pokecluePreviewEn from "./assets/pokeclue-preview-en.png";
import highlowPreview from "./assets/highlow-preview.png";
import highlowPreviewEn from "./assets/highlow-preview-en.png";

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
    title: "포맨틀",
    category: "유사도 추리",
    formats: "데일리",
    href: "./pokemantle.html",
    image: pokemantlePreview,
    imageEn: pokemantlePreviewEn,
    imageAlt: "추측한 포켓몬의 유사도와 순위가 표시된 포맨틀 기록",
  },
  {
    id: "pokeclue",
    title: "포케클루",
    category: "단서 추리",
    formats: "데일리 · 연습",
    href: "./pokeclue.html",
    image: pokecluePreview,
    imageEn: pokecluePreviewEn,
    imageAlt: "타입과 특성 등 여섯 가지 단서를 비교한 포케클루 추측 기록",
  },
  {
    id: "highlow",
    title: "포케 하이로우",
    category: "종족값 대결",
    formats: "데일리 · 연습",
    href: "./highlow.html",
    image: highlowPreview,
    imageEn: highlowPreviewEn,
    imageAlt: "두 포켓몬의 종족값을 비교하는 포케 하이로우 대결",
  },
];
