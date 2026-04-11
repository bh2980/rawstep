# T-002 core 계약과 공유 상수

완료일: `2026-04-11`

## 작업 ID

`T-002`

## 목적

패키지 사이에서 주고받는 타입과 상수를 하나의 진실 원본으로 고정한다.  
이 티켓이 흔들리면 뒤 작업이 전부 흔들린다.

## 입력/의존

- 선행 작업: `T-001`
- 기준 문서: `docs/01-CONTRACTS.md`, `docs/02-RUNTIME_LOOP.md`

## 해야 할 일

- `UserModel`, `Task` 타입을 정의한다.
- `ALLOWED_KEYS` 와 `AllowedKey` 타입을 정의한다.
- `KeyboardObservation`, `ScreenReaderObservation`, `Observation` 타입을 정의한다.
- `Action`, `Decision`, `Verdict`, `EndedBy` 타입을 정의한다.
- `AgentContext`, `Agent` 인터페이스를 정의한다.
- `StepRecord`, `TraceSession`, aggregate 타입을 정의한다.
- `DEFAULT_MAX_STEPS`, `DEFAULT_TIMEOUT_MS`, `HISTORY_WINDOW`, `SETTLE_MS`, viewport 기본값을 상수로 둔다.
- 허용 키 검사용 헬퍼를 둔다.

## 하지 말아야 할 일

- `screenreader` 타입 구현을 추가하지 않는다. 타입 선언만 둔다.
- 실제 Playwright 코드나 LLM 호출 코드를 core에 넣지 않는다.
- JSON 파일 입출력 로직을 core에 넣지 않는다.

## 완료 조건

- `docs/01-CONTRACTS.md` 의 핵심 타입이 `packages/core` export와 1:1로 대응된다.
- 다른 패키지가 core 타입만 보고 구현할 수 있다.
- 종료 상태와 실패 상태가 문자열로 흩어지지 않고 타입으로 고정된다.

## 테스트 방법

- 타입 체크만으로 build가 통과해야 한다.
- `ALLOWED_KEYS` 에 없는 키를 타입에서 바로 거를 수 있는지 확인한다.
- `TraceSession.aggregate.endedBy` 가 문서에 있는 값만 허용하는지 확인한다.

## 다음 작업

- `T-004 browser 세션과 settle 규칙`
- `T-005 actuator와 허용 키 제한`
- `T-006 keyboard observer`
- `T-007 trace recorder와 파일 출력`
- `T-008 agent 어댑터와 응답 파서`
