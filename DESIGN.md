# Stock Manager 디자인 계약

이 문서는 `styles.css`에 이미 구현된 토스식 디자인 문법을 명문화한 것이다.
새 화면·카드·구성요소는 **이 계약을 재사용**하고, 기존 화면을 전면 재설계하지 않는다.

## 원칙

- 토스 문법: 회색 바탕(`--sm-ground`) 위 흰 카드(`--sm-card`), 라운드 20px, 큰 볼드 숫자.
- Obsidian 테마 적응: 바탕·잉크·경계선은 반드시 Obsidian 변수에서 파생한다
  (`--background-secondary`, `--text-normal` 등). 하드코딩 색은 브랜드 색·자산군 색·상승/하락 색뿐이며,
  다크 테마 값은 `.theme-dark .sm-view`에서 재정의한다.
- 모든 스타일은 `.sm-view` 루트 아래에서만 적용한다 (플러그인 외부 오염 금지).
- 숫자는 `sm-num`(tabular-nums)으로 정렬을 맞춘다.

## 색 토큰 (`.sm-view`에 정의)

| 토큰 | 용도 | 값 |
|---|---|---|
| `--sm-ground` | 화면 바탕 | `var(--background-secondary)` |
| `--sm-card` | 카드 배경 | `var(--background-primary)` |
| `--sm-card-sub` | 카드 안 서브 배경 (호버·트랙·내부 박스) | `var(--background-secondary)` |
| `--sm-ink` / `--sm-ink-2` / `--sm-ink-3` | 본문 / 보조 / 희미한 텍스트 | Obsidian text 변수 |
| `--sm-accent` (+`-soft`) | 브랜드 파랑 (링크·강조·CTA) | `#3182f6` / 다크 `#4593fc` |
| `--sm-up` / `--sm-down` (+`-soft`) | 상승(빨강)·하락(파랑) — 국내 관례 | `#f04452` / `#3182f6` |
| `--sm-stock` / `--sm-bond` / `--sm-cash` | 자산군 색 | 파랑 / 초록 / 보라 |
| `--sm-warn-ink` / `--sm-warn-soft` | 경고 텍스트·배경 | 앰버 계열, 다크 재정의 |
| `--sm-line` | 구분선 | `var(--background-modifier-border)` |

새 의미 색이 필요하면 여기에 토큰을 추가하고 다크 값을 함께 정의한다. 컴포넌트에 원시 색을 넣지 않는다.

## 구성요소 패턴

### 카드 (`sm-card`)
- 흰 배경, radius 20px, padding 18px, 세로 flex + gap 12px.
- 헤더는 `sm-card-head` + `h2`(0.95em/700). 헤더 우측 요소: 카운트(`sm-count`),
  텍스트 링크 버튼(`sm-textlink`), 범례 값(`sm-legend-val`).
- 하단 설명은 `sm-foot`(0.75em, ink-3), 근거 표기는 `sm-basis`.
- 데이터 없으면 카드 자체를 그리지 않는 것이 기본. **단, 진입점 역할 카드(메모·리뷰)는
  빈 상태 문구(`sm-empty` 톤)를 보여 발견 가능성을 지킨다.**

### 저널 행 (`sm-journal` > `sm-jrow`)
- 날짜(`sm-jdate`, 32px 고정) + 본문(`sm-jbody`) 구조. 행 radius 12px, hover 시 `--sm-card-sub`.
- 본문 첫 줄 `sm-jline`: 액션 필(`sm-act sm-act-{action}`) + 이름(`sm-jnm`).
- 부가 정보 `sm-jdetail`, 태그 칩 `sm-jtags` > `sm-jtag`.
- 클릭 시 노트 열기. 매매일지·메모·이벤트 카드가 공유한다.

### 필/칩
- 액션 필 `sm-act-*`: soft 배경 + 진한 글자, radius 6px. 매수/기초=up, 매도/출금=down, 배당/입금=accent.
- 경고 칩 `sm-warn-chip`, 목표가 칩 `sm-target-chip` — 같은 문법 (soft 배경, 0.72~0.78em/700~800).
- 상태 배지가 필요하면 이 soft-배경 칩 문법을 따른다.

### 필터 칩 (`sm-filter-row` > `sm-fchip`)
- 알약형(radius 999px), 카드 배경, 선택 상태는 `aria-pressed="true"` → 잉크 배경 반전.
- 선택 상태는 클래스가 아니라 **aria-pressed 속성**으로 표현한다 (접근성 겸용).

### 테이블 (`sm-table-scroll` > `sm-htable`)
- 카드형 래퍼(radius 16px)가 가로 스크롤을 담당. 헤더 정렬 표시는 `sm-sorted` + ▾/▴ 텍스트.
- 숫자 열 우측 정렬, 앞 3열만 좌측. 합계는 tfoot, 위 2px 경계선.

### 버튼
- 주 CTA `sm-cta`: accent 배경 풀폭, sticky 하단. 화면당 1개.
- 보조 액션 `sm-textlink`: accent 텍스트 버튼 (카드 헤더의 "상세 테이블 →" 등).
- 아이콘 버튼 `sm-icon-btn`: 30px, hover 시 accent-soft.

### 차트
- SVG viewBox 360×H, 선 2px(주 계열)/1.5px 점선(보조), 마지막 점 강조 원.
- 색은 `SERIES_COLORS` = accent → bond → cash 순서로만 사용.

## 접근성·반응형

- 클릭 가능한 행·칩은 hover 배경으로 어포던스 표시. 새 인터랙티브 요소는 `button`으로 만들고
  `:focus-visible` 아웃라인을 남긴다 (제거 금지).
- 넓이 고정 금지 — 사이드바(~300px)와 메인 탭 모두에서 동작해야 한다. 넘치는 표는
  `sm-table-scroll` 패턴으로만 가로 스크롤.
- 긴 제목은 `min-width: 0` + 줄바꿈 또는 ellipsis로 처리해 행 구조를 깨지 않는다.
