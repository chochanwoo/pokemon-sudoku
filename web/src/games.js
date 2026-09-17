import typedokuArt from "./assets/home-art/typedoku.webp";
import pokemantleArt from "./assets/home-art/pokemantle.webp";
import pokeclueArt from "./assets/home-art/pokeclue.webp";
import highlowArt from "./assets/home-art/highlow.webp";
import pokinatorArt from "./assets/home-art/pokinator.webp";
import scratchArt from "./assets/home-art/scratch.webp";

export const games = [
  {
    id: "pokemantle",
    title: "포맨틀",
    category: "유사도 추리",
    formats: "데일리",
    href: "./pokemantle.html",
    image: pokemantleArt,
    imageAlt: "바닷가 추리 테이블에 펼친 이브이, 샤미드, 쥬피썬더 사진",
  },
  {
    id: "scratch",
    title: "포케 스크래치",
    category: "그림 추리",
    formats: "데일리 · 연습",
    href: "./scratch.html",
    image: scratchArt,
    imageAlt: "지우개 옆 그림판의 긁힌 틈으로 드러난 피카츄",
  },
  {
    id: "pokeclue",
    title: "포케클루",
    category: "단서 추리",
    formats: "데일리 · 연습",
    href: "./pokeclue.html",
    image: pokeclueArt,
    imageAlt: "나몰빼미와 타입, 알, 진화 단서를 담은 조사 노트",
  },
  {
    id: "highlow",
    title: "포케 하이로우",
    category: "종족값 대결",
    formats: "데일리 · 연습",
    href: "./highlow.html",
    image: highlowArt,
    imageAlt: "바다가 보이는 높고 낮은 받침대 위의 어흥염과 루가루암",
  },
  {
    id: "typedoku",
    title: "타입도쿠",
    category: "스도쿠",
    formats: "4 × 4 · 6 × 6 · 9 × 9",
    href: "./sudoku.html",
    image: typedokuArt,
    imageAlt: "리조트 테이블에 놓인 컬러 타입 타일 스도쿠",
  },
  {
    id: "pokinator",
    title: "포키네이터",
    category: "역방향 추리",
    formats: "자유 플레이",
    href: "./pokinator.html",
    image: pokinatorArt,
    imageAlt: "바닷가 라운지에서 숟가락을 들고 추리하는 윤겔라",
  },
];
