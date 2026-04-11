# T-008 agent 어댑터와 응답 파서

완료일: `2026-04-12`

## 작업 ID

`T-008`

## 목적

에이전트 레이어가 keyboard 관측을 받고, 허용된 형식의 `Decision` 하나만 반환하게 만든다.

## 입력/의존

- 선행 작업: `T-002`
- 기준 문서: `docs/01-CONTRACTS.md`

## 해야 할 일

- keyboard 전용 system prompt 템플릿을 만든다.
- `goal`, `allowedKeys`, `history`, `observation` 을 묶는 user payload 형식을 만든다.
- LLM 응답을 `Decision` 으로 파싱하는 함수를 만든다.
- malformed JSON, action/verdict 동시 반환, 허용되지 않은 key 사용을 모두 `stuck` 으로 강제 변환한다.
- Anthropic SDK 어댑터를 만든다.
- 테스트에서는 실제 네트워크 호출 없이 parser와 인터페이스를 검증할 수 있게 분리한다.

## 하지 말아야 할 일

- agent 코드에서 `Page`, selector, DOM API를 import하지 않는다.
- parse 실패를 예외로 터뜨려 runner 루프를 깨지 않는다.
- screenreader prompt까지 같이 만들지 않는다.

## 완료 조건

- agent는 항상 `Decision` 하나를 반환한다.
- 파서가 치팅 시도나 잘못된 출력도 안전하게 `stuck` 으로 바꾼다.
- system prompt에 관측 채널 제한과 허용 키 목록이 명시된다.

## 테스트 방법

- 정상 action JSON 파싱
- 정상 verdict JSON 파싱
- malformed JSON → `stuck`
- 허용되지 않은 key → `stuck`
- prompt 문자열에 `DOM`, `accessibility tree`, 허용 키 목록이 포함되는지 확인

## 다음 작업

- `T-009 runner 루프와 종료 처리`
- `T-012 통합 검증과 guardrail 점검`
