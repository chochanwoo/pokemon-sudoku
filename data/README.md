# Pokemon Data

이 폴더는 PokeAPI v2 데이터를 내려받아 만든 팬게임용 포켓몬 데이터베이스입니다.

## 다시 빌드하기

```powershell
python scripts/build_pokemon_db.py --workers 24
```

처음 실행하면 `data/cache/pokeapi/`에 원본 JSON을 저장합니다. 이후 실행은 캐시를 우선 사용합니다. 최신 API 응답으로 다시 받고 싶으면 `--refresh`를 붙입니다.

```powershell
python scripts/build_pokemon_db.py --refresh --workers 24
```

## 주요 산출물

- `data/source/pokemon_catalog.csv`: 사람이 훑어보기 좋은 1행 1폼 카탈로그
- `data/source/pokemon_species.csv`: 전국도감 종 단위 데이터, 성비, 진화 체인 ID
- `data/source/pokemon.csv`: 폼/개체 단위 데이터, 종족값, 키, 키/몸무게
- `data/source/pokemon_types.csv`: 포켓몬별 타입 슬롯
- `data/source/moves.csv`: 기술 기본 데이터
- `data/source/pokemon_learnsets.csv`: 포켓몬별 기술 습득법 전체
- `data/source/machines.csv`: 버전군별 TM/HM 아이템과 기술 매핑
- `data/source/evolutions.csv`: 진화 방법과 조건
- `data/build/pokemon.db`: 게임에서 읽기 좋은 SQLite DB
- `data/build/schema.sql`: SQLite 스키마

## SQLite 편의 뷰

- `pokemon_catalog`: 포켓몬 폼별 요약
- `level_up_moves`: 레벨업 습득 기술
- `machine_moves`: 기술머신 습득 기술
- `tutor_moves`: 기술가르침 습득 기술

## 참고

CSV는 사람이 확인하고 수정하기 위한 원본/중간 산출물이고, SQLite는 게임 런타임에서 읽는 산출물로 취급하는 것을 권장합니다. 포켓몬 이름, 타입명, 기술명은 가능한 경우 한국어 이름을 같이 저장합니다.
