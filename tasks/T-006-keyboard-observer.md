# T-006 keyboard observer

완료일: `2026-04-11`

## 작업 ID

`T-006`

## 목적

keyboard 모드에서 에이전트가 매 턴 받는 관측값을 만든다.

## 입력/의존

- 선행 작업: `T-002`, `T-004`
- 기준 문서: `README.md`, `docs/01-CONTRACTS.md`

## 해야 할 일

- 현재 viewport screenshot을 PNG base64로 수집한다.
- viewport 크기를 함께 기록한다.
- 직전 screenshot 1장만 메모리에 보관한다.
- 현재 페이지 title을 읽는다.
- 현재 URL에서 `pathname + search` 만 뽑는다.
- 스크롤 위치를 `top/middle/bottom` 으로만 변환한다.
- 위 항목을 `KeyboardObservation` 하나로 묶는다.

## 하지 말아야 할 일

- focus crop을 만들지 않는다.
- `activeElement`, role, label, accessibility tree를 읽지 않는다.
- agent에게 DOM 위치 정보나 selector를 넘기지 않는다.
- 직전 screenshot을 2장 이상 보관하지 않는다.

## 완료 조건

- `observe()` 호출 시 screenshot이 비어 있지 않다.
- 두 번째 호출부터는 `previousScreenshot` 이 채워진다.
- `urlPath` 에 origin이 들어가지 않는다.
- `scrollHint` 는 3개 값 중 하나만 나온다.

## 테스트 방법

- 같은 페이지에서 `observe()` 를 2번 호출
- 첫 호출과 두 번째 호출의 `previousScreenshot` 차이 확인
- 스크롤 없는 fixture에서 `top` 이 나오는지 확인

## 다음 작업

- `T-009 runner 루프와 종료 처리`
- `T-012 통합 검증과 guardrail 점검`
