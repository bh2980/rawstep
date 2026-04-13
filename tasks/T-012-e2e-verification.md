# T-012 통합 검증과 guardrail 점검

완료일: `2026-04-12`

## 작업 ID

`T-012`

## 목적

Keyboard MVP가 문서에 적힌 범위를 진짜로 만족하는지 끝까지 확인하고, 치팅 금지 규칙이 깨지지 않았는지 점검한다.

## 입력/의존

- 선행 작업: `T-003`, `T-009`, `T-010`, `T-011`
- 기준 문서: `docs/00-CURRENT_SCOPE.md`, `docs/03-FIXTURES.md`

## 해야 할 일

- `simple-cta` 실행이 성공하는지 확인한다.
- `bad-focus` 실행이 실패하는지 확인한다.
- 가능하면 `modal` 도 실행해 모달 open/close 흐름을 점검한다.
- `trace.jsonl`, `metrics.json`, `report/index.html` 생성 여부를 확인한다.
- `metrics.json` 의 `reachedGoal`, `endedBy`, `failurePoint` 값이 기대와 맞는지 본다.
- `packages/agent` 에 금지 문자열이 없는지 grep 한다.
- `--mode screenreader` 에러 메시지가 v2 안내를 주는지 확인한다.

## 하지 말아야 할 일

- fixture 기대 결과와 다른데 문서만 고쳐서 맞춘 척하지 않는다.
- bad-focus 성공을 "좋은 결과"로 해석하지 않는다. 그건 치팅 가능성 신호다.
- 실패 원인을 reporter UI 문제와 혼동하지 않는다. 먼저 trace와 metrics를 본다.

## 완료 조건

- `docs/00-CURRENT_SCOPE.md` 의 완료 기준을 모두 만족한다.
- 회귀 테스트가 반복 가능하다.
- 범위 밖 기능 없이 v1을 닫을 수 있다.

## 테스트 방법

- `pnpm install && pnpm -r build`
- `pnpm rawstep run examples/tasks/simple-cta.yml --mode keyboard --out ./out/simple-cta`
- `pnpm rawstep run examples/tasks/bad-focus.yml --mode keyboard --out ./out/bad-focus`
- `pnpm rawstep run examples/tasks/modal.yml --mode keyboard --out ./out/modal`
- `pnpm rawstep run examples/tasks/simple-cta.yml --mode screenreader --out ./out/sr`
- `rg "page\\.evaluate|querySelector|activeElement|accessibility" packages/agent`

## 다음 작업

- 이 티켓까지 끝나면 keyboard MVP 문서 묶음은 완료
- 다음 묶음은 `screenreader` 전용 새 인덱스로 분리
