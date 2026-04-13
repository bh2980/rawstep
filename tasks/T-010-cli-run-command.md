# T-010 CLI run 명령과 task 로딩

완료일: `2026-04-12`

## 작업 ID

`T-010`

## 목적

사용자가 `rawstep run <task.yml> --mode keyboard --out <dir>` 한 줄로 전체 흐름을 실행할 수 있게 만든다.

## 입력/의존

- 선행 작업: `T-002`, `T-003`, `T-009`
- 기준 문서: `README.md`, `docs/00-CURRENT_SCOPE.md`

## 해야 할 일

- CLI entrypoint를 만든다.
- `run` 서브커맨드를 지원한다.
- task YAML을 읽어 `Task` 로 변환한다.
- 상대 fixture 경로를 `file://` URL 또는 절대 경로로 정확히 바꾼다.
- `--mode` 와 `--out` 옵션을 처리한다.
- v1에서 `--mode screenreader` 는 명시적 에러를 낸다.
- 출력 디렉터리를 만든다.
- runner 실행 후 reporter까지 연결한다.
- 종료 시 사용자에게 생성된 출력 파일 위치를 출력한다.

## 하지 말아야 할 일

- task 파일 형식을 CLI 안에서 제멋대로 확장하지 않는다.
- `--mode` 기본값을 문서와 다르게 바꾸지 않는다.
- reporter 없이 trace만 만들고 끝내지 않는다.

## 완료 조건

- 문서에 나온 CLI 한 줄로 실행이 된다.
- 잘못된 task 파일은 읽기 쉬운 에러를 낸다.
- output 디렉터리에 trace, metrics, report가 생긴다.

## 테스트 방법

- `simple-cta.yml` 로 실행
- `screenreader` 옵션으로 에러 확인
- `--out` 이 없는 경우 에러 확인
- task 파일의 상대 경로 fixture가 제대로 풀리는지 확인

## 다음 작업

- `T-011 최소 HTML reporter`
- `T-012 통합 검증과 guardrail 점검`
