# T-009 runner 루프와 종료 처리

완료일: `2026-04-12`

## 작업 ID

`T-009`

## 목적

관측 → 판단 → 행동 루프를 실제로 연결하고, 성공/실패/시간 초과를 일관되게 끝낸다.

## 입력/의존

- 선행 작업: `T-004`, `T-005`, `T-006`, `T-007`, `T-008`
- 기준 문서: `docs/02-RUNTIME_LOOP.md`

## 해야 할 일

- `runTask(task)` 흐름을 만든다.
- v1에서 `screenreader` 모드를 명시적으로 거절한다.
- 매 step에서 `observe -> decide -> append/act -> settle` 순서를 지킨다.
- success verdict면 즉시 종료한다.
- stuck verdict면 즉시 종료한다.
- `maxSteps` 초과 시 `endedBy = "maxSteps"` 로 종료한다.
- wallclock timeout 시 `endedBy = "timeout"` 으로 종료한다.
- 허용되지 않은 키 에러 시 `endedBy = "error"` 로 종료한다.
- 종료 시 브라우저를 항상 닫고 trace를 finalize한다.

## 하지 말아야 할 일

- DOM selector 대기를 넣지 않는다.
- 관측 전에 action을 먼저 하지 않는다.
- `reachedGoal` 을 runner 임의 판단으로 바꾸지 않는다. `success` 일 때만 true다.

## 완료 조건

- task 하나를 끝까지 실행하면 `TraceSession` 이 나온다.
- 종료 경로별 `endedBy` 값이 문서와 일치한다.
- 브라우저 close와 trace finalize가 `finally` 성격으로 보장된다.

## 테스트 방법

- success를 반환하는 fake agent로 성공 종료 확인
- stuck를 반환하는 fake agent로 stuck 종료 확인
- 계속 action만 반환하는 fake agent로 `maxSteps` 종료 확인
- 짧은 timeout으로 `timeout` 종료 확인
- 잘못된 key를 반환하는 fake agent로 `error` 종료 확인

## 다음 작업

- `T-010 CLI run 명령과 task 로딩`
- `T-012 통합 검증과 guardrail 점검`
