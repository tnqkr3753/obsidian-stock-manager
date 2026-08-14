# Stock Manager — 프로젝트 규칙

## 커밋 규칙
- 커밋 메시지에 `Co-Authored-By` 트레일러를 **절대 넣지 않는다** (Claude 포함 어떤 봇/도구도 컨트리뷰터로 표시되지 않게).
- `🤖 Generated with ...` 류의 도구 홍보 문구도 커밋·PR 본문에 넣지 않는다.
- conventional commits 유지: `feat|fix|refactor|docs|test|chore|perf|ci: 설명`

## 저장소에 커밋하지 않는 것
- `*_work_log_*.json` — /work 절차의 내부 작업 로그 (로컬 보관용, .gitignore 처리됨)
- 스펙 문서, 개인 메모 등 ~/prompt_spec 계열 내부 산출물

## 개발
- 도메인 로직(src/domain, src/data/parse·csv)은 TDD — tests/ 아래 테스트 먼저
- 빌드: `npm run build` (tsc 타입체크 + esbuild), 테스트: `npm test`
