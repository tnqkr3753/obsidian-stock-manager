# Obsidian Stock Manager

매매일지를 유일한 진실(source of truth)로 삼는 옵시디언 주식 포트폴리오 플러그인.
보유량·평단·수익률·실현손익·배당·현금이 전부 매매일지 노트에서 파생되고,
토스 스타일 대시보드와 HTS식 상세 테이블로 보여준다.

## 기능 (1차 MVP)

- 매매일지 노트(frontmatter) 기반 보유 현황 파생 — 기초 보유는 `opening` 액션
- 시세·환율 자동 갱신 (Yahoo Finance, 캐시로 오프라인 대응)
- 자산 배분(주식/채권/현금) + 목표 배분 대비 리밸런싱 제안
- 종목 태그 노출 분석 + 집중 경고 (기본 40% 초과)
- 수익률·실현손익·배당 누적, 해외 종목 원화 환산
- 자산 추이 차트 (하루 1회 총자산 스냅샷)
- 매매 입력 Modal (회고 태그 지원), CSV 가져오기
- 사이드바 대시보드 뷰 + 메인 탭 상세 테이블 뷰 + ` ```stock-portfolio``` ` 코드블록 임베드

## 설치 (수동)

```bash
npm install
npm run build
# vault의 .obsidian/plugins/stock-manager/ 에 복사
cp main.js manifest.json styles.css <vault>/.obsidian/plugins/stock-manager/
```

옵시디언 설정 → 커뮤니티 플러그인에서 Stock Manager 활성화.

## 데이터 스키마

기본 스캔 폴더는 `Stocks/` (설정에서 변경). 노트의 frontmatter `type`으로 구분한다.

### 매매일지 (`type: trade`)

```markdown
---
type: trade
date: 2026-08-12
action: buy        # buy | sell | opening | dividend | deposit | withdraw
ticker: "005930"
qty: 10
price: 71000
currency: KRW      # 생략 시 KRW
tags: [원칙매수, 분할매수]   # 회고 태그
---
반도체 업황 회복 기대. 분할 매수 1차.
```

- `opening`: 플러그인 도입 전 기초 보유. 평단 계산에는 반영되고 현금은 움직이지 않는다.
- `dividend`: `ticker` + `amount`. `deposit`/`withdraw`: `amount`(+`currency`).
- `account`: 계좌 구분(ISA, 신한, 연금 등). 생략 시 `기본`. **계좌별로 평단·보유량·현금이 분리**되고,
  계좌가 2개 이상이면 대시보드에 계좌별 자산 카드가 나타난다. CSV에도 `account` 열 사용 가능.

### 종목 노트 (`type: stock`)

```markdown
---
type: stock
ticker: "005930"
name: 삼성전자
assetClass: stock          # stock | bond
market: KRX                # KOSDAQ이면 야후 심볼이 .KQ로 조회됨
currency: KRW
tags: [반도체, 대형주, 배당]
yahooSymbol: 005930.KS     # 자동 추정이 틀릴 때만 지정
---
```

### 설정 노트 (`type: stock-config`)

```markdown
---
type: stock-config
target: { stock: 55, bond: 30, cash: 15 }   # % 또는 0~1 비율
concentrationLimit: 40
---
```

### 경제 메모 (`type: macro`) — 2차

```markdown
---
type: macro
date: 2026-08-10
tags: [금리, 반도체사이클]   # 종목 태그와 같은 태그를 쓰면 서로 연결됨
---
FOMC 금리 동결. 반도체 업황 코멘트 긍정적.
```

커맨드 "경제 메모 작성"으로 오늘 날짜 템플릿 생성. 대시보드에 최근 3건 표시.

### 워치리스트 (`type: watch`) — 2차

```markdown
---
type: watch
ticker: TSLA
name: 테슬라
targetPrice: 180        # 종목 통화 기준. 현재가가 이하로 내려오면 대시보드에 배지
currency: USD
---
```

### 월간 리포트 — 2차

커맨드 "월간 리포트 생성 (지난달)" → `Reports/YYYY-MM 투자 리포트.md` 생성:
자산 변화(스냅샷), 매매 횟수, 실현손익·배당(통화별), 순입출금, 회고 태그 성적표.

### 자산 흐름 — 4차

대시보드 최상단 카드에서 **총자산 vs 누적 투입 원금**을 절대 금액으로 겹쳐 보여줍니다 —
자산이 원금 때문에 늘었는지 수익 때문에 늘었는지가 한눈에 보입니다. 원금 대비 수익도 함께 표시.

### 이벤트 캘린더 — 3차

stock/watch/macro 노트의 frontmatter에 `events: ["YYYY-MM-DD 제목", ...]`을 적으면
대시보드 "다가오는 이벤트" 카드에 D-day와 함께 표시됩니다 (30일 이내, D-3부터 강조).

### 벤치마크 비교 — 3차

자산 추이 카드에 KOSPI·S&P500이 겹쳐 그려집니다 (구간 시작일 = 100 지수화, 일 1회 갱신).
설정의 "벤치마크"에서 `심볼=라벨` 형식으로 변경 가능.

### 매수 체크리스트 — 3차

config 노트에 `checklist: ["원칙에 맞나", "손절선 정했나"]`를 적으면
매수 기록 Modal에 토글로 나타나고, 체크 상태가 매매일지 노트 본문에 기록됩니다.

### 현금흐름 — 3차

대시보드 카드에서 최근 6개월 월별 순입출금 막대와 누적 투입 원금을 보여줍니다.

### 자산 스냅샷 저장 위치 — 3차

스냅샷이 vault의 `{데이터 폴더}/snapshots.json`에 저장됩니다 (기기 간 동기화됨).
구버전(data.json) 스냅샷은 최초 로드 시 자동 병합됩니다.

### 작성 중인 노트 (`draft: true`)

frontmatter에 `draft: true`를 넣으면 어떤 타입의 노트든 스캔에서 제외됩니다 —
필수 필드를 채우기 전의 초안이 대시보드에 파싱 경고를 띄우지 않게 하는 장치.
커맨드 "워치 종목 추가"가 만드는 템플릿이 이 방식을 사용합니다.

### CSV 가져오기 헤더

`date, action`(필수)`, ticker, qty, price, currency, amount, tags`(세미콜론 구분)

## 개발

```bash
npm test          # vitest (도메인 로직 40 테스트)
npm run coverage  # 커버리지 (기준 80%)
npm run dev       # esbuild watch
npm run build     # 타입체크 + 번들
```

구조: `src/domain`(순수 계산, 테스트 대상) / `src/data`(frontmatter 파서·vault 저장소) /
`src/price`(야후 시세·환율·캐시) / `src/ui`(뷰·모달·렌더러) / `main.ts`(플러그인 진입점).

## 이력

- 2026-08-14 v0.4.0 — 4차: 계좌 구분(계좌별 평단·현금·자산 카드·테이블 열), 자산 흐름 카드(총자산 vs 투입 원금), 대시보드 흐름 중심 재배치, 상세 테이블 진입 버튼
- 2026-08-14 v0.3.1 — 종목 검색 자동완성 (회사명 → 코드·통화, 종목 노트 자동 생성)
- 2026-08-13 v0.3.0 — 3차: 벤치마크 오버레이(지수화 비교), 이벤트 캘린더, 매수 체크리스트, 현금흐름 카드, 스냅샷 vault 이전(다기기 일관성)
- 2026-08-13 v0.2.0 — 2차: 경제 메모, 워치리스트(목표가 배지·시세 조회), 월간 리포트(sellEvents 기반 월별 실현손익·회고 태그 성적표)
- 2026-08-13 v0.1.0 — 1차 MVP: 도메인 로직(TDD 40 tests, cov 96%), 대시보드·테이블 뷰, 매매 Modal, CSV, 시세/환율, 스냅샷 + 코드리뷰 14건 수정
