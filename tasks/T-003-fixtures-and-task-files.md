# T-003 로컬 fixture와 예시 task 파일

완료일: `2026-04-11`

## 작업 ID

`T-003`

## 목적

외부 사이트에 기대지 않고 v1을 검증할 수 있는 로컬 테스트 환경을 만든다.

## 입력/의존

- 선행 작업: `T-001`
- 기준 문서: `docs/03-FIXTURES.md`

## 해야 할 일

- `fixtures/simple-cta.html` 을 만든다.
- `fixtures/modal.html` 을 만든다.
- `fixtures/bad-focus.html` 을 만든다.
- 각 fixture에 대응되는 `examples/tasks/*.yml` 을 만든다.
- task 파일에는 `id`, `url`, `goal`, `mode`, `maxSteps`, `timeoutMs` 를 넣는다.
- fixture의 제목, 상태 변화, 포커스 동작이 문서 기대 결과와 맞도록 만든다.

## 하지 말아야 할 일

- 외부 네트워크 리소스를 불러오지 않는다.
- fixture에 불필요한 복잡한 UI를 넣지 않는다.
- v1 범위를 넘는 스크롤 대형 페이지나 입력 폼을 넣지 않는다.

## 완료 조건

- 세 fixture가 모두 로컬 파일로 열린다.
- task 파일이 각 fixture를 정확히 가리킨다.
- `simple-cta` 는 성공 가능해야 한다.
- `bad-focus` 는 실패 케이스로 작동해야 한다.

## 테스트 방법

- 브라우저에서 각 HTML을 직접 열어 수동 확인
- task 파일의 `url` 이 실제 fixture 경로와 맞는지 확인
- 버튼/모달/포커스 상태 전환이 문서 기대와 같은지 확인

## 다음 작업

- `T-007 trace recorder와 파일 출력`
- `T-010 CLI run 명령과 task 로딩`
- `T-012 통합 검증과 guardrail 점검`
