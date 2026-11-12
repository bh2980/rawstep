# CLI 레퍼런스

`rawstep` 명령줄 인터페이스(`@rawstep/cli`)의 전체 명령어와 옵션 안내입니다.

---

## 1. 전체 명령어 요약

```text
rawstep init [--project <dir>]
rawstep ui [--port <port>] [--project <dir>]
rawstep run <task> [--profile <id|name>] [--rule <name>=<value>]...
                   [--repeat <n>] [--parallel <n>] [--note <text>] [--json] [--project <dir>]
                   [--baseline <summary>] [--fail-on <gates>] [--save-summary <file>] [--junit <file>]
rawstep suite [<task>...] [--tag <tag>]... [--profile <id|name>]... [--rule <name>=<value>]...
                   [--repeat <n>] [--parallel <n>] [--note <text>] [--json] [--project <dir>]
                   [--baseline <summary>] [--fail-on <gates>] [--save-summary <file>] [--junit <file>]
rawstep compare <baseline> <batch> [--fail-on <gates>] [--junit <file>] [--json]
rawstep hints <run-dir> [--reference <run-dir>]
rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]
rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]
rawstep doctor [--project <dir>]
rawstep --help | -h
rawstep --version | -v
```

---

## 2. 종료 코드

| 종료 코드 | 적용 명령어 | 의미 |
| :---: | :--- | :--- |
| **`0`** | 전체 | 성공. `run`과 `suite`에서는 모든 실행이 유효한 측정 결과(`reached`, `gave-up`, `mistaken`)를 남겼고 `--fail-on` 게이트에 걸린 항목이 없음을 뜻합니다. |
| **`1`** | 전체 | 런타임 오류, 잘못된 설정/태스크 파일, `doctor` 점검 실패, 또는 실행 중 예외 발생. |
| **`2`** | 전체 | CLI 문법 오류 (`CliUsageError`: 알 수 없는 명령어/플래그, 중복 불가능한 플래그의 중복 사용, 잘못된 값 범위). |
| **`3`** | `run`, `suite` | 크래시는 없었으나 하나 이상의 실행이 **`unmeasured`**로 종료됨 (플래너 호출 한도, `maxSteps`, `timeoutMs`, 반복 방지 장치 도달, 계획에 필요한 동작을 프로필이 허용하지 않음, 모델이 확신하지 못함, 플래너가 제때 답하지 않음, 봇 확인 등으로 사이트가 차단함, 이 컴퓨터에서 페이지 환경을 적용하지 못함). |
| **`4`** | `run`, `suite`, `compare` | `--baseline` 대비 하나 이상의 `--fail-on` 회귀 게이트에서 퇴행이 감지됨. |
| **`130`** | `run`, `suite` | `SIGINT`(`Ctrl+C`)로 중단됨. 그때까지 기록된 트레이스는 안전하게 저장 및 마무리됩니다. |
| **`143`** | `run`, `suite` | `SIGTERM`으로 중단됨. 그때까지 기록된 트레이스는 안전하게 저장 및 마무리됩니다. |

- `run`과 `suite`의 **우선순위**: 오류로 끝난 실행이 있으면 `1`, 없고 `--fail-on` 게이트에 걸린 항목이 있으면 `4`, 그것도 없고 측정되지 않은 실행이 있으면 `3`입니다. 따라서 오류로 끝난 실행이 있으면 `4`는 나오지 않습니다.
- `run`이나 `suite`에서 `--baseline` 없이 `--fail-on`만 쓰면 사용법 오류(`2`)입니다.
- `ui`는 `SIGINT`나 `SIGTERM`을 받으면 `0`으로 종료합니다.
- `analyze`는 분석이 끝나지 않으면(`completed`가 아니면) `1`을 반환합니다.
- 인자 어디에든 `--help` / `-h`가 있으면 사용법을 출력하고 `0`으로 끝납니다. `--version` / `-v`는 다른 인자 없이 단독으로 쓸 때만 동작합니다.

---

## 3. 명령어 상세

### `rawstep init`
초기 `rawstep.config.json`(`version: 7`)과 바로 실행해 볼 수 있는 `demo` 태스크(`rawstep/demo/page.html`, `rawstep/demo/task.json`), 미리 작성된 계획 파일(`rawstep/demo/plan.json`)을 생성합니다. 설정에는 프로필 두 개가 들어갑니다. 그 계획을 따르는 `written-plan`(모델 없음)과 아직 플래너가 없는 `item-by-item`입니다. 이미 `rawstep.config.json`이 존재하면 덮어쓰지 않고 종료하며, 이미 있는 데모 파일은 그대로 둡니다.

| 옵션 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `--project <dir>` | `string` | `.` | `rawstep.config.json`을 생성할 프로젝트 디렉토리. |

---

### `rawstep ui`
`127.0.0.1`에서 로컬 웹 대시보드를 시작합니다 (기본 주소 `http://127.0.0.1:4318`).

| 옵션 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `--port <port>` | `1–65535` | `4318` | 대시보드 서버가 바인딩할 루프백 TCP 포트. |
| `--project <dir>` | `string` | `.` | 열 프로젝트 디렉토리. |

---

### `rawstep run <task>`
단일 태스크(`rawstep.config.json`에 등록된 태스크 `id` 또는 태스크 `.json` 파일 경로)를 하나의 실행 프로필로 실행합니다. `.rawstep/experiments/<batch-id>/` 폴더에 `summary.json`을 저장하고, 각 실행 폴더 안에 `trace.json`, `plan.json`, `plan.md`, `hints.json`, `analysis.json`, `report.html`을 기록합니다.

| 옵션 | 반복 지정 | 기본값 | 설명 |
| :--- | :---: | :--- | :--- |
| `<task>` *(위치 인자)* | 불가 | *(필수)* | `rawstep.config.json`의 태스크 ID 또는 태스크 JSON 파일 경로. |
| `--profile <id\|name>` | 불가 | 태스크의 첫 프로필, 없으면 프로젝트의 첫 프로필 | 실행에 사용할 프로필 ID 또는 이름. |
| `--rule <name>=<value>` | **가능** | *(프로필의 `runRules`)* | 이번 실행에서만 특정 `runRules` 항목을 덮어씁니다 (예: `--rule maxPlannerCalls=20 --rule survey=none`). 같은 규칙을 여러 번 적으면 마지막 값이 적용됩니다. [설정 파일 레퍼런스](./config.ko.md#35-실행-규칙-runrules)를 참고하세요. |
| `--repeat <n>` | 불가 | `1` | 반복 실행 횟수 (`1–100`). 반복 실행 시 목표에 도달한 가장 빠른 실행을 기준으로 비교합니다. |
| `--parallel <n>` | 불가 | `machine.parallelRuns` (`1`) | 동시에 띄울 최대 브라우저 실행 수 (`1–8`). 자체 브라우저에서 `personCheck`를 사용하는 태스크는 항상 한 번에 하나씩만 실행됩니다. 실제 스크린리더로 하는 실행도 한 번에 하나씩만 실행됩니다(한 데스크톱에는 스크린리더가 하나뿐입니다). |
| `--note <text>` | 불가 | *(없음)* | 이번 배치에 붙일 메모 (최대 `200`자). 대시보드와 `summary.json`에 표시됩니다. |
| `--baseline <summary>` | 불가 | *(없음)* | 비교 기준이 될 베이스라인 `summary.json` 파일 또는 배치 폴더 경로. |
| `--fail-on <gates>` | 불가 | `reach` *(`--baseline` 지정 시)* | 쉼표로 구분한 회귀 판정 게이트 (`reach`, `moves`, `stuck`, `missing`). `--baseline`과 함께 사용하며 게이트에 걸리면 종료 코드 `4`로 끝납니다. |
| `--save-summary <file>` | 불가 | *(없음)* | 이번 배치의 `summary.json`을 `<file>` 경로에도 복사해 저장합니다 (새 베이스라인 커밋용). |
| `--junit <file>` | 불가 | *(없음)* | JUnit XML 형식의 테스트 결과를 `<file>`에 기록합니다. |
| `--json` | 불가 | `false` | 일반 텍스트 대신 구조화된 JSON을 `stdout`으로 출력합니다. |
| `--project <dir>` | 불가 | `.` | `rawstep.config.json`이 있는 프로젝트 디렉토리. |

---

### `rawstep suite [<task>...]`
여러 태스크를 하나 이상의 프로필로 묶어 단일 배치로 실행합니다.
- `<task>...` 위치 인자를 넘기면 지정한 태스크들을 실행합니다.
- 위치 인자가 없고 `--tag <tag>`가 주어지면 `rawstep.config.json`에서 해당 태그가 붙은 태스크들을 실행합니다.
- 둘 다 없으면 `rawstep.config.json`에 등록된 모든 태스크를 실행합니다.

`rawstep run`의 모든 옵션을 그대로 사용할 수 있으며, 아래 옵션들이 추가됩니다.

| 옵션 | 반복 지정 | 기본값 | 설명 |
| :--- | :---: | :--- | :--- |
| `<task>...` *(위치 인자)* | **가능** (`0+`) | 전체 태스크 (또는 태그 필터링된 태스크) | 실행할 태스크 ID 목록 또는 태스크 JSON 파일 경로 목록. |
| `--tag <tag>` | **가능** | *(전체 태스크)* | 지정한 태그 중 하나라도 포함된 태스크만 골라 실행합니다. |
| `--profile <id\|name>` | **가능** | 각 태스크의 `profiles`, 없으면 프로젝트의 첫 프로필 | 선택된 모든 태스크를 지정한 각 프로필로 실행합니다. |

---

### `rawstep compare <baseline> <batch>`
이미 저장된 두 배치(각 인자는 `summary.json` 파일 경로 또는 배치 폴더 경로)를 오프라인으로 비교해 자연스러운 실행 편차를 넘어선 유의미한 변화를 출력합니다.

| 옵션 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `<baseline>` *(위치 인자 1)* | `string` | *(필수)* | 기준이 되는 베이스라인 `summary.json` 파일 또는 배치 디렉토리. |
| `<batch>` *(위치 인자 2)* | `string` | *(필수)* | 비교할 대상 `summary.json` 파일 또는 배치 디렉토리. |
| `--fail-on <gates>` | `string` | `reach` | 쉼표로 구분한 게이트 (`reach`, `moves`, `stuck`, `missing`). 지정한 게이트에 걸리면 종료 코드 `4`를 반환합니다. |
| `--junit <file>` | `string` | *(없음)* | 비교 결과를 JUnit XML 파일로 저장합니다. |
| `--json` | Boolean | `false` | 비교 결과 객체를 JSON으로 출력합니다. |

---

### `rawstep hints <run-dir>`
저장된 실행 디렉토리(또는 `trace.json` 경로)에서 마찰 힌트를 추출해 `hints.json`으로 저장하고 각 힌트를 출력합니다.

| 옵션 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `<run-dir>` *(위치 인자)* | `string` | *(필수)* | 저장된 실행 디렉토리 또는 그 안의 `trace.json` 경로. |
| `--reference <run-dir>` | `string` | *(없음)* | `slow-run` 힌트 판정에 사용할 기준 실행 디렉토리 경로. 기준 실행과 비교해 이번 실행에서 새로 생긴 힌트, 사라진 힌트, 양쪽에 모두 있는 힌트도 함께 출력합니다. |

---

### `rawstep report <run-dir>`
저장된 실행 디렉토리에서 `report.html`과 `report.json`을 생성합니다.

| 옵션 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `<run-dir>` *(위치 인자)* | `string` | *(필수)* | 저장된 실행 디렉토리 또는 그 안의 `trace.json` 경로. |
| `--analysis <analysis.json>` | `string` | *(없음)* | 리포트에 포함할 `analysis.json` 파일 경로. 지정했을 때만 읽습니다. 트레이스 옆의 `hints.json`은 자동으로 읽습니다. |
| `--out <dir>` | `string` | `<run-dir>` | `report.html`과 `report.json`을 저장할 출력 디렉토리. |

---

### `rawstep analyze <run-dir>`
저장된 실행 디렉토리에 대해 사후 분석을 수행하고 `analysis.json`과 `hints.json`을 기록합니다.

| 옵션 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `<run-dir>` *(위치 인자)* | `string` | *(필수)* | 저장된 실행 디렉토리 경로. |
| `--llm` | Boolean | `false` | 저장된 트레이스 이벤트를 프로젝트에 설정된 `project.analysis.model`(`LlmTraceAnalyzer`)로 보내 분석합니다. 생략하면 로컬 규칙 기반 분석기(`deterministicAnalyzer`)만 실행합니다. |
| `--out <dir>` | `string` | `<run-dir>` | `analysis.json`을 저장할 출력 디렉토리. |
| `--project <dir>` | `string` | `.` | 프로젝트 디렉토리 (`--llm` 사용 시 설정 파일을 읽는 위치). |

---

### `rawstep doctor`
로컬 실행 환경과 프로젝트 설정을 점검합니다.
1. **Node:** `process.versions.node >= 22.12.0` 여부를 확인합니다.
2. **Config:** `rawstep.config.json`(v7) 문법과 스키마를 검증합니다.
3. **Tasks:** `rawstep.config.json`에 등록된 모든 태스크 파일이 유효한지 검증합니다.
4. **Profiles:** 각 프로필의 플래너를 확인합니다. 플래너가 없는 프로필은 경고이고, 연결이나 API 키가 없거나 `planFile`이 없으면 실패입니다. 태스크가 하나도 없는 프로젝트도 경고합니다. 그다음 각 태스크를 그 태스크가 쓰는 프로필(`tasks[].profiles`, 없으면 프로젝트의 첫 프로필)로 점검합니다. `run`과 대시보드가 배치를 시작하기 전에 하는 것과 같은 점검입니다. 스크린 리더가 지원하지 않는 동작, 없거나 계획이 아닌 계획 파일, 태스크에 없는 입력 이름을 잡습니다. 다른 줄에서 이미 알린 문제는 다시 적지 않습니다.
5. **Browser:** `browser.mode`가 `connect`인 태스크가 있으면 `machine.browserEndpoint`가 설정되어 있는지 확인합니다. 그다음 다른 모든 태스크가 쓰는, Rawstep이 직접 띄우는 브라우저가 뜨고 닫히는지 확인합니다(`machine.browserExecutablePath`와 `machine.proxyServer` 적용). `machine.browserEndpoint`가 설정되어 있으면 그 Chrome에 연결되는지도 따로 확인합니다(`Your Chrome`). 실행이 브라우저를 여는 두 가지 방법을 모두 점검하는 것입니다.
6. **Connections & Keys:** API 키 또는 에이전트 CLI 로그인 상태를 확인하고, 설정된 각 모델 ID가 실제로 응답하는지 점검합니다.
7. **Screen Readers:** `voiceover`나 `nvda`를 사용하는 프로필이 있다면 실행이 시작할 때 하는 점검을 그대로 합니다(대시보드의 확인 버튼도 같은 점검입니다). 스크린 리더가 이 운영체제에서 도는지, 주소가 이 컴퓨터인지, AT Driver 서버가 `machine.atEndpoints`(비어 있으면 해당 스크린 리더의 기본 주소)에서 응답하고 세션을 여는지, VoiceOver라면 커서 위치를 읽을 수 있는지 봅니다. 응답이 없고 서버 실행 명령이 저장되어 있으면 실행과 마찬가지로 그 명령으로 서버를 띄웠다가 내립니다. 다른 운영체제의 스크린 리더는 여기서 실행할 수 없다고 알립니다. 프로필이 시뮬레이션만 쓰면 건너뜁니다.
