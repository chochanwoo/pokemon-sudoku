# 타입도쿠

포켓몬의 이중타입으로 푸는 브라우저 스도쿠입니다. GitHub Pages에서 실행되는 정적 웹게임이며, 서버나 API 키가 필요하지 않습니다.

## 실행

```powershell
npm ci
npm run dev
```

터미널에 표시된 주소를 엽니다. 개발 시 Node.js 22.12 이상을 권장합니다.

## 게임 규칙

- 한 칸에는 두 타입을 가진 포켓몬 한 마리를 놓습니다.
- 같은 행, 열, 굵은 선으로 구분한 구역에는 같은 타입이 두 번 등장할 수 없습니다.
- 각 행, 열, 구역에는 이번 퍼즐에서 사용하는 타입이 정확히 한 번씩 들어갑니다.
- 4×4는 8개 타입과 2×2 구역, 6×6은 12개 타입과 2×3 구역, 9×9는 18개 타입과 3×3 구역을 사용합니다.
- 주어진 칸은 고정입니다. 동일한 타입 조합의 다른 포켓몬도 정답으로 인정합니다.
- 기본 폼의 이중타입 포켓몬 526종을 포함합니다. 지역 폼, 메가진화 및 단일타입 포켓몬은 제외했습니다.

오늘의 퍼즐은 한국 시간 자정을 기준으로 바뀝니다. 같은 날짜·크기·난이도는 같은 퍼즐입니다. 자유 플레이와 결과 공유 링크도 지원합니다.

퍼즐 진행, 메모, 시간, 완료 기록은 현재 브라우저에만 저장됩니다. 기기 간 동기화와 온라인 랭킹은 없습니다. 브라우저 저장소를 삭제하면 기록도 사라집니다.

## 조작

- 칸을 선택한 후 이름, 초성, 영문명 또는 전국도감 번호로 포켓몬을 검색합니다.
- 타입 필터 두 개를 선택하면 두 타입을 모두 가진 포켓몬을 찾습니다.
- 연필 버튼은 타입 메모, 지우개는 선택한 칸 삭제입니다.
- 포켓몬을 입력하면 같은 행·열·구역의 관련 타입 메모가 자동으로 정리됩니다.
- 확인 버튼은 잘못된 타입 조합을 표시합니다. 힌트는 선택한 칸 또는 미완성 칸 하나를 채웁니다.
- 방향키로 이동, Delete/Backspace로 삭제, N으로 메모 전환, Ctrl/Cmd+Z로 되돌리기, Ctrl/Cmd+Shift+Z로 다시 실행합니다.
- 모바일에서는 칸을 누르면 포켓몬 선택창이 아래에서 열립니다.

## GitHub Pages 배포

### 방법 A: 빌드된 파일 사용

현재 `docs/`에 배포용 파일이 생성되어 있습니다. Python과 원본 SQLite DB는 배포에 필요하지 않습니다. 배포 시 PNG 원본을 데이터 파일에 묶어 GitHub 웹 업로드의 100개 파일 제한 안에 들어가도록 했습니다.

1. GitHub 공개 저장소를 만들고 `docs/` 폴더를 업로드합니다.
2. 저장소의 **Settings → Pages**로 이동합니다.
3. **Source → Deploy from a branch**를 선택합니다.
4. **Branch → main**, 폴더 **/docs**를 선택하고 저장합니다.
5. `https://계정명.github.io/저장소명/`에 배포됩니다.

`docs/` 안의 파일을 저장소 최상위에 올렸다면 폴더를 **/(root)**로 선택합니다. `typedoku-github-pages.zip`에는 최상위 업로드용 파일이 들어 있습니다. ZIP 자체를 업로드하지 말고 압축을 푼 내용물을 업로드합니다.

### 방법 B: 소스 수정 시 자동 배포

1. 이 프로젝트의 소스, `web/public/`, `package.json`, `package-lock.json`, `.github/workflows/pages.yml`을 GitHub에 올립니다.
2. **Settings → Pages → Source → GitHub Actions**를 선택합니다.
3. `main`에 변경을 올리거나 **Actions → Deploy Type Sudoku to GitHub Pages → Run workflow**를 실행합니다.
4. 자동으로 테스트, 빌드, 배포됩니다.

빌드는 포함된 게임 데이터를 사용하므로 Actions에서 Python이나 DB를 설치할 필요가 없습니다. 프로젝트 경로(`/저장소명/`)와 별도 도메인 모두를 위해 상대 경로를 사용합니다.

## 개발 및 검증

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:e2e
python scripts/package_game.py
```

브라우저 테스트는 빌드 결과를 `/pokemon/` 하위 경로에서 실행합니다. 데스크톱과 모바일 입력, 메모, 저장 복원, 완주, 9×9 보드, 손상된 저장 데이터 복구를 확인합니다.

## 데이터 갱신

원본 DB는 `data/build/pokemon.db`, 웹게임용 데이터는 `web/public/catalog.json`과 `web/public/puzzles.json`입니다. 스프라이트 원본은 `web/public/sprites/`에 있으며, 빌드할 때 이미지 바이트를 `docs/catalog.json`에 포함합니다. 플레이 중 외부 이미지 서버를 호출하지 않습니다.

```powershell
python -m pip install --target .tools/python -r scripts/requirements-web.txt
python scripts/build_type_sudoku.py --count 4
python scripts/build_type_sudoku.py --verify
npm test
npm run build
```

`--puzzles-only`는 이미지 다운로드를 건너뛰고 퍼즐만 다시 생성합니다. 퍼즐 원본을 교체하면 기존 진행 상태의 정답이 달라질 수 있으므로 배포 후에는 데이터 버전과 퍼즐 ID도 함께 올려야 합니다.

퍼즐 생성에는 Google OR-Tools CP-SAT를 사용합니다. 단서를 제거할 때 원래 정답을 제외한 두 번째 타입 배치가 존재하는지 검사하며, 두 번째 해가 없다고 확인한 경우에만 단서를 제거합니다. 각 크기별 기본 퍼즐을 행·열·구역 순열로 변환해 재현 가능한 데일리·자유 퍼즐을 만듭니다. 난이도는 단서 수 기준이며, 인간 풀이 기법에 따른 등급은 아닙니다.

## 출처

- 게임 규칙 참고: [PokeQuiz 포케도쿠](https://pokequiz.app/). 화면과 게임 코드는 이 프로젝트에서 새로 작성했습니다.
- 포켓몬 정보: [PokéAPI](https://pokeapi.co/docs/v2).
- 포켓몬 스프라이트: [PokeAPI/sprites](https://github.com/PokeAPI/sprites).
- 퍼즐 생성: [Google OR-Tools](https://github.com/google/or-tools), Apache-2.0.
- UI 아이콘: [Lucide](https://lucide.dev/), ISC.

Pokémon 및 관련 캐릭터의 권리는 Nintendo, Creatures, GAME FREAK에 있습니다.
