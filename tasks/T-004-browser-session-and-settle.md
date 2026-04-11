# T-004 browser 세션과 settle 규칙

## 작업 ID

`T-004`

## 목적

runner가 브라우저를 열고 닫고, 각 액션 뒤에 같은 방식으로 안정화 대기를 할 수 있게 한다.

## 입력/의존

- 선행 작업: `T-001`, `T-002`
- 기준 문서: `docs/02-RUNTIME_LOOP.md`

## 해야 할 일

- `createBrowserSession(url)` 을 만든다.
- 기본 viewport를 1280x800으로 고정한다.
- URL 진입 후 초기 로드 대기를 best effort로 처리한다.
- `closeBrowserSession()` 또는 동등한 close API를 만든다.
- action 뒤에 쓰는 `settle(page)` 유틸을 만든다.
- `settle` 은 `networkidle` 1초 대기 후 `SETTLE_MS` 만큼 잠깐 쉬는 규칙을 구현한다.

## 하지 말아야 할 일

- DOM selector 기반 대기 로직을 넣지 않는다.
- `waitForSelector`, `locator`, `accessibility.snapshot` 을 쓰지 않는다.
- 브라우저 제어를 observer나 actuator 쪽 책임으로 섞지 않는다.

## 완료 조건

- browser 패키지 하나만으로 페이지 open/close가 된다.
- runner는 브라우저 내부 구현을 몰라도 된다.
- settle 규칙이 문서와 동일하게 고정된다.

## 테스트 방법

- 로컬 fixture URL로 세션 생성 후 닫기
- 잘못된 URL에서 에러가 어떻게 나는지 확인
- `settle` 호출이 selector 없이 동작하는지 코드 리뷰로 확인

## 다음 작업

- `T-005 actuator와 허용 키 제한`
- `T-006 keyboard observer`
- `T-009 runner 루프와 종료 처리`
