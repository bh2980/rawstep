# T-011 최소 HTML reporter

완료일: `2026-04-12`

## 작업 ID

`T-011`

## 목적

사용자가 실행 결과를 파일만 보고 이해할 수 있게 최소한의 읽을거리 있는 HTML 리포트를 만든다.

## 입력/의존

- 선행 작업: `T-007`
- 기준 문서: `README.md`, `docs/00-CURRENT_SCOPE.md`

## 해야 할 일

- `report/index.html` 생성 함수를 만든다.
- 최종 상태와 `reachedGoal` 을 표시한다.
- 총 step 수와 총 keystroke 수를 표시한다.
- key distribution을 표시한다.
- 각 step마다 screenshot, rationale, action/verdict, title/path, timestamp를 보여준다.
- 실패한 경우 마지막 failure point를 강조한다.
- trace가 저장한 screenshot 상대 경로를 그대로 쓸 수 있게 링크를 맞춘다.

## 하지 말아야 할 일

- 복잡한 SPA 리포터를 만들지 않는다.
- chart 라이브러리 같은 큰 의존성을 추가하지 않는다.
- screenshot base64를 HTML에 다시 박아 넣지 않는다.

## 완료 조건

- HTML 파일 하나만 열어도 실행 결과를 따라갈 수 있다.
- step replay가 시간 순서대로 보인다.
- 성공/실패 여부와 비용 요약이 첫 화면에서 보인다.

## 테스트 방법

- 더미 trace 또는 실제 fixture 실행 결과로 리포트 렌더
- 브라우저로 열어 이미지 링크가 깨지지 않는지 확인
- 실패 케이스에서 failure point 문구가 보이는지 확인

## 다음 작업

- `T-012 통합 검증과 guardrail 점검`
