# Keyboard MVP 작업 인덱스

이 폴더는 `keyboard` 모드 v1을 실제로 만들기 위한 작업 문서 모음이다.  
설명 문서가 아니라, 구현자가 순서대로 집어서 바로 작업할 수 있는 티켓 묶음이다.

## 이 인덱스를 보는 법

- 구현 순서는 아래 번호를 그대로 따른다.
- 앞 작업의 완료 조건을 만족해야 다음 작업으로 넘어간다.
- 각 티켓은 반나절~하루 안에 끝낼 수 있는 크기로 유지한다.
- 구현 중 판단이 필요해 보이면 먼저 `docs/00~03`을 확인한다.

## 이번 단계 고정값

- 모드: `keyboard` only
- 입력 파일: `examples/tasks/*.yml`
- 주요 산출물: `trace.jsonl`, `metrics.json`, `report/index.html`
- fixture: `simple-cta`, `modal`, `bad-focus`
- 허용 키: `Tab`, `Shift+Tab`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Space`, `Escape`
- 제외: `screenreader`, oracle, 자유 텍스트 입력, 점수화

## 전체 완료 기준

- `pnpm install && pnpm -r build` 가 성공한다.
- `pnpm a11y-task run examples/tasks/simple-cta.yml --mode keyboard --out ./out/simple-cta` 가 성공한다.
- `out/simple-cta/metrics.json` 에 `reachedGoal: true` 가 기록된다.
- `pnpm a11y-task run examples/tasks/bad-focus.yml --mode keyboard --out ./out/bad-focus` 가 성공하고 `reachedGoal: false` 가 기록된다.
- `pnpm a11y-task run <any> --mode screenreader` 는 명시적 에러로 끝난다.
- HTML report에서 step replay와 비용 요약을 볼 수 있다.

## 작업 순서

| ID | 제목 | 선행 작업 | 핵심 산출물 |
|---|---|---|---|
| T-001 | 루트 워크스페이스와 패키지 골격 | 없음 | workspace 설정, 패키지 폴더 |
| T-002 | core 계약과 공유 상수 | T-001 | 타입, 상수, 종료 상태 정의 |
| T-003 | 로컬 fixture와 예시 task 파일 | T-001 | `fixtures/*.html`, `examples/tasks/*.yml` |
| T-004 | browser 세션과 settle 규칙 | T-001, T-002 | `createBrowserSession`, `close`, `settle` |
| T-005 | actuator와 허용 키 제한 | T-002, T-004 | `Actuator`, whitelist, 비용 카운트 |
| T-006 | keyboard observer | T-002, T-004 | screenshot, previous screenshot, title/path, scroll hint |
| T-007 | trace recorder와 파일 출력 | T-002, T-003 | `trace.jsonl`, `metrics.json`, screenshot flush |
| T-008 | agent 어댑터와 응답 파서 | T-002 | system prompt, decision parser |
| T-009 | runner 루프와 종료 처리 | T-004, T-005, T-006, T-007, T-008 | end-to-end 실행 루프 |
| T-010 | CLI run 명령과 task 로딩 | T-002, T-003, T-009 | `a11y-task run ...` |
| T-011 | 최소 HTML reporter | T-007 | `report/index.html` |
| T-012 | 통합 검증과 guardrail 점검 | T-003, T-009, T-010, T-011 | 최종 검증, 회귀 체크 |

## 티켓 선택 규칙

- 새 구현자는 항상 `T-001`부터 순서대로 본다.
- 이미 완료된 작업은 문서 상단에 완료 날짜를 적고 넘어간다.
- 범위를 넓히고 싶어지면 먼저 `docs/00-CURRENT_SCOPE.md`를 다시 읽는다.
- `screenreader` 관련 구현은 이 폴더의 작업이 전부 끝난 뒤 새 티켓 묶음으로 따로 만든다.

## 참고 문서

- 범위: `docs/00-CURRENT_SCOPE.md`
- 타입 계약: `docs/01-CONTRACTS.md`
- 실행 루프: `docs/02-RUNTIME_LOOP.md`
- fixture 기대 결과: `docs/03-FIXTURES.md`
