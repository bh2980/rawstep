# T-007 trace recorder와 파일 출력

## 작업 ID

`T-007`

## 목적

실행 전체를 append-only 형태로 남기고, 리포트가 읽을 수 있는 파일 산출물을 만든다.

## 입력/의존

- 선행 작업: `T-002`, `T-003`
- 기준 문서: `docs/01-CONTRACTS.md`, `docs/02-RUNTIME_LOOP.md`

## 해야 할 일

- `TraceRecorder` 를 만든다.
- step 단위 append API를 만든다.
- `trace.jsonl` 을 한 줄 한 step 방식으로 기록한다.
- aggregate 계산 로직을 만든다.
- `metrics.json` 을 저장한다.
- screenshot base64를 `<out>/screenshots/step-###.png` 로 flush 한다.
- trace에는 screenshot 상대 경로만 기록한다.
- 종료 시 전체 세션을 메모리 객체로도 반환할 수 있게 한다.

## 하지 말아야 할 일

- `trace.jsonl` 안에 base64 원문을 그대로 넣지 않는다.
- 이전 screenshot을 별도 파일로 중복 저장하지 않는다.
- 실패 지점을 runner 밖에서 임의로 다시 계산하지 않는다.

## 완료 조건

- step append를 여러 번 호출하면 `trace.jsonl` 이 줄 단위로 늘어난다.
- screenshot 파일이 step 번호와 함께 저장된다.
- `metrics.json` 에 `totalSteps`, `totalKeystrokes`, `reachedGoal`, `endedBy`, `failurePoint` 가 들어간다.

## 테스트 방법

- 더미 observation/decision으로 1~2 step append
- 저장된 `trace.jsonl` 줄 수 확인
- `screenshots/step-000.png` 생성 확인
- `metrics.json` 구조 확인

## 다음 작업

- `T-009 runner 루프와 종료 처리`
- `T-011 최소 HTML reporter`
