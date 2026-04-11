# T-001 루트 워크스페이스와 패키지 골격

## 작업 ID

`T-001`

## 목적

이 프로젝트가 모노레포로 빌드되고, 이후 패키지를 안전하게 추가할 수 있는 빈 뼈대를 만든다.

## 입력/의존

- 기준 문서: `README.md`, `plan.md`, `docs/00-CURRENT_SCOPE.md`
- 선행 작업 없음

## 해야 할 일

- 루트 `package.json`을 만든다.
- `pnpm-workspace.yaml`을 만든다.
- 공통 TypeScript 설정 파일을 만든다.
- `packages/` 와 `apps/cli/` 기본 폴더를 만든다.
- v1에 필요한 패키지 폴더만 만든다.
- 각 패키지에 최소 `package.json`, `tsconfig.json`, `src/` 폴더를 만든다.
- 루트에서 `pnpm -r build` 가 돌 수 있는 최소 스크립트를 연결한다.

## 하지 말아야 할 일

- `observer-screenreader` 패키지를 만들지 않는다.
- 실제 구현 코드를 이 작업에서 길게 넣지 않는다.
- fixture, reporter, runner 세부 로직까지 여기서 같이 처리하지 않는다.

## 완료 조건

- 루트에서 `pnpm install` 이 성공한다.
- 루트에서 `pnpm -r build` 를 실행하면 빈 골격 기준으로 실패하지 않는다.
- 이후 티켓이 각 패키지에 코드를 추가할 수 있는 상태가 된다.

## 테스트 방법

- `pnpm install`
- `pnpm -r build`
- 디렉터리 구조가 `docs/00-CURRENT_SCOPE.md` 의 v1 범위와 일치하는지 눈으로 확인

## 다음 작업

- `T-002 core 계약과 공유 상수`
- `T-003 로컬 fixture와 예시 task 파일`
