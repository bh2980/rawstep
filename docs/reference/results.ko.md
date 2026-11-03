# 결과, 트레이스 및 힌트 레퍼런스

모든 실행과 스위트 배치는 `.rawstep/experiments/<batch-id>/` 아래에 결과 파일들을 저장합니다. 이 문서는 저장 폴더 구조와 `summary.json`, `trace.json`, 그리고 16가지 마찰 힌트(`hints.json`)의 세부 규격을 설명합니다.

---

## 1. `.rawstep/` 디렉토리 구조

```text
.rawstep/
└── experiments/
    └── <batch-id>/                   # `rawstep run` 또는 `rawstep suite` 1회당 생성되는 배치 폴더 (UUID 이름)
        ├── experiment.json           # 배치의 실행 이력: 요청 내용과 각 실행의 상태·조건·결과
        ├── summary.json              # 배치 내 모든 태스크·프로필 요약 (BatchSummary 스키마 1.0)
        └── <run-id>/                 # 개별 실행마다 생성되는 폴더 (실행 UUID 이름)
            ├── trace.jsonl           # 비정상 종료에도 유실되지 않는 실시간 이벤트 스트림
            ├── trace.json            # 실행 완료 후 확정된 RunTrace (스키마 3.0)
            ├── diagnostics/          # 진단 이미지: 단계마다 step-<N>.png, 시작 시 전체 페이지 start-page.png
            ├── plan.json             # 단계, 세부 작업, 완료 기준, 가정, 수정 이력이 담긴 최종 PlanDocument (플래너가 이끄는 실행)
            ├── plan.md               # 사람이 읽기 편하게 렌더링한 마크다운 계획 문서
            ├── hints.json            # 추출된 마찰 힌트 보고서 (HintReport 스키마 3.0)
            ├── analysis.json         # 규칙 기반 또는 LLM 사후 분석 결과
            ├── report.json           # report.html 렌더링에 사용되는 통합 요약 데이터
            └── report.html           # 외부 의존성 없이 단독으로 열리는 HTML 리포트
```

---

## 2. 배치 요약 (`summary.json`)

`.rawstep/experiments/<batch-id>/summary.json`에 기록되며(`--save-summary <file>` 옵션으로 원하는 경로에 복사할 수 있고, 기준선으로 커밋해 두는 것이 바로 이 파일입니다), `rawstep compare`와 `--baseline` 비교의 입력으로 사용됩니다. 형태는 `{ schemaVersion: "1.0", batch: { id, createdAt, note? }, cells }`입니다.

`cells`의 각 셀은 `(taskId, profileId)` 조합별로 실행 결과를 묶어 다음 항목을 기록합니다.
- **`taskId`, `taskName`, `profileId`, `profileName`:** 어느 태스크를 어느 프로필로 실행한 셀인지.
- **`runs`:** 셀에 속한 실행 횟수.
- **`endings`:** `{ reached, gave-up, mistaken, unmeasured, error }`. 종료 상태별 실행 횟수이며, `error`는 실행 자체가 깨진 경우로 페이지에 대해서는 아무것도 알려 주지 않습니다.
- **`reachedMoves`:** `number[]`. `reached`로 끝난 실행들의 이동 횟수를 실행 순서대로 담습니다.
- **`stuck`:** `{ role, name?, runs }[]`. 눌렀을 때 사용자가 기대한 대로 반응하지 않은 요소(`expectation-broken`)와, 셀의 실행 중 몇 번에서 나타났는지.
- **`pageFindings`:** `{ kind, role, name?, runs }[]`. 힌트 종류와 요소별로 집계된 `page` 출처의 반복 마찰 힌트.

---

## 3. 실행 종료 상태 (`RunEnding`)

`runEnding(outcome, stopSource?)`(`rawstep/hints`, 루트 `rawstep`에서도 내보냄)가 계산합니다. 트레이스의 `outcome`과, 두 번째 인자로 `outcome.policyStopSource`(실행을 멈춘 주체)를 받아 `{ ending, by? }`를 반환하며, 실행에 `outcome`이 없으면 `undefined`를 반환합니다. `by`는 `unmeasured`일 때만 붙습니다.

| `ending` | `outcome.status` / `reason` / 중단 주체 | 설명 |
| :--- | :--- | :--- |
| **`reached`** | `status: "success"` | 독립 검증 규칙(`task.verify.all`)을 모두 통과함. |
| **`gave-up`** | 중단 주체 `"user-gave-up"` 또는 `reason: "policy-stuck"` | 플래너가 페이지에서 더 이상 목표를 달성할 방법이 없다고 판단해 포기함(`giveUp: { reason, tried }`). 또는 커스텀 정책이 막힘(stuck)으로 멈춤. |
| **`mistaken`** | `reason: "verification-failed"` | 플래너는 목표가 달성되었다고 보고 `complete: true`를 선언했으나 `task.verify.all`은 통과하지 못함. |
| **`unmeasured`** | 한도 도달, 차단 또는 환경 중단 | 사용자가 완료하거나 포기하기 전에 중단됨. `by` 필드로 원인을 구분합니다(아래 참고). |

`unmeasured`의 `by` 값과 그 값을 만드는 조건입니다.

| `by` | 발생 조건 |
| :--- | :--- |
| `'planner-calls'` | 중단 주체 `orchestration-limit` |
| `'no-allowed-action'` | 중단 주체 `no-allowed-action` |
| `'repetition-guard'` | 중단 주체 `exploration-guard` |
| `'model-uncertain'` | `reason: "policy-uncertain"` |
| `'max-steps'` | `reason: "maxSteps"` |
| `'timeout'` | `reason: "timeout"` |
| `'planner-timeout'` | `reason: "planner-timeout"` |
| `'blocked'` | `reason: "access-blocked"` |
| `'environment'` | `reason: "unsupported-profile"` |
| `'other'` | 그 외 모든 결과 |

중단 주체를 `reason`보다 먼저 확인하므로, 둘 다 있으면 중단 주체가 우선합니다.

---

## 4. 16가지 마찰 힌트 (`hints.json`, 스키마 `3.0`)

[`packages/reports/src/hints/index.ts`](../../packages/reports/src/hints/index.ts)의 `extractHints(trace, options)`가 추출합니다.

`hints.json`은 힌트를 감싸는 `HintReport` 객체입니다.
- `schemaVersion`: `"3.0"`.
- `runId`, `taskId`: 어떤 실행과 태스크에 대한 보고서인지.
- `steps`, `durationMs`, `goalReached`: 실행의 단계 수, 소요 시간(밀리초, 알 수 없으면 `null`), 목표 도달 여부.
- `outcome` *(선택)*: 트레이스의 `{ status, reason? }`.
- `reference` *(선택)*: 비교 대상으로 삼은 성공한 실행의 `{ runId, steps, durationMs, goalReached }` (`slow-run`에서 사용).
- `hints`: 아래의 `Hint` 객체 목록.
- `limitations`: 힌트로는 알 수 없는 것에 대한 안내문(예: 페이지 관찰자 이벤트가 기록되지 않았음).

`hints`의 각 `Hint` 객체는 다음 필드를 가집니다.
- `kind`: 아래 16가지 `HintKind` 중 하나.
- `source`: `'page'`, `'run'`, `'model'` 중 하나.
- `certainty`: `'observed'`(직접 기록된 이벤트) 또는 `'suspected'`(휴리스틱 추정).
- `target` *(선택)*: 문제가 발생한 접근성 노드의 `{ role: string, name?: string }`.
- `steps`: 힌트가 발생한 단계 번호 목록.
- `count` *(선택)*: 한 번의 실행 안에서 동일한 요소에 같은 페이지 문제가 반복된 횟수.
- `summary`: 사람이 읽을 수 있는 한 줄 요약.
- `detail`: 각 힌트 종류에 따른 상세 메타데이터.
- `evidence`: 힌트의 근거가 된 트레이스 이벤트 ID 목록 (`e-1`, `e-12` 등).

### 4.1 페이지 힌트 (`source: "page"`)

한 번의 실행에서 같은 요소에 동일한 페이지 힌트(`excess-keystrokes` 제외)가 여러 번 발생하면 하나의 항목으로 합쳐지고 `count`가 증가합니다.

| `kind` | `certainty` | 기본 임계값 / 발생 조건 |
| :--- | :--- | :--- |
| **`excess-keystrokes`** | `observed` | 두 번의 활성화 동작(`activate`, `Enter`, `Space`) 사이에 이동 동작(`next`, `previous`, `Tab`, `Shift+Tab`, 방향키, `Home`, `End`, `PageUp`, `PageDown`)이 `>= 10`회(`keystrokesToTarget`) 이상 걸렸을 때. |
| **`focus-lost`** | `observed` | 동작 직후 포커스된 요소가 DOM에서 사라지거나 포커스가 `<body>`/`null`로 풀려 페이지 관찰자가 `focus-lost`(`step > 0`)를 기록했을 때. |
| **`focus-left-page`** | `observed` | 키보드 포커스가 웹 페이지를 벗어나 브라우저 UI나 다른 창으로 빠져나가 `page-blur`(`step > 0`)가 기록되었을 때. |
| **`focus-not-visible`** | `observed` / `suspected` | • **`observed`:** `visible === false`이거나 `inViewport === false`인 요소로 포커스가 이동했을 때.<br>• **`suspected`:** 브라우저 진단에서 포커스 요소의 중심이 다른 요소에 가려져 있거나(`centerOccluded === true`) 시각적 포커스 표시(`outline`/`box-shadow`)가 감지되지 않았을 때(`indicator === "not-detected"`). |
| **`modal-focus-outside`** | `observed` / `suspected` | • **`observed`:** 모달 다이얼로그가 열려 있는 상태에서 모달 바깥 요소로 포커스가 이동했을 때 (`modalOpen === true`, `inDialog === false`).<br>• **`suspected`:** `dialog` 또는 `alertdialog`가 새로 나타났으나(`step > 0`) 그 단계에서 다이얼로그 내부로 포커스가 이동하지 않았을 때. |
| **`missing-announcement`** | `suspected` | 활성화 동작(`activate`, `Enter`, `Space`)으로 인해 페이지 상태나 DOM이 실제로 바뀌었지만, 라이브 리전 발화, 포커스 이동, 알림 영역(`alert`, `alertdialog`, `dialog`, `status`, `log`) 등장, 페이지 이동, 포커스된 컨트롤의 상태 변화 중 어느 것도 일어나지 않았을 때. |
| **`live-interruptions`** | `observed` | 사용자가 이동하는 도중 요청하지 않은 라이브 리전 발화가 `>= 3`번(`liveInterruptions`) 이상 끼어들었을 때. |

### 4.2 실행 힌트 (`source: "run"`)

| `kind` | `certainty` | 기본 임계값 / 발생 조건 |
| :--- | :--- | :--- |
| **`slow-run`** | `observed` | 목표에 도달한 기준 실행과 비교해 단계 수가 `1.5`배(`slowRunStepRatio`) 이상이면서 `3`단계(`slowRunMinExtraSteps`) 이상 더 걸렸을 때. |
| **`goal-met-at-start`** | `observed` / `suspected` | 첫 동작을 수행하기 전 초기 로드 상태(`verifier.baseline`)에서 이미 `task.verify.all`의 모든 규칙(`observed`) 또는 일부 규칙(`suspected`)이 충족되어 있었을 때. |
| **`replan`** | `observed` | 실행 도중 `'failures'`, `'no-change'`, `'task-limit'`, `'oscillation'`, `'effort-review'` 때문에 플래너가 계획을 수정했을 때. |
| **`task-limit`** | `observed` | 계획의 세부 작업이 허용된 최대 이동 횟수(`stepActionLimit`) 동안 기대한 음성 단서를 듣지 못했을 때. |
| **`wanted-to-give-up`** | `observed` | 아직 확인해 보지 않은 가정이 남아 있는 상태에서 플래너가 조기 포기를 시도했을 때 (실행기가 남은 가정을 먼저 시도하도록 포기를 보류함). |
| **`goal-word-stretch`** | `observed` | 목표(`goal`)와 관련된 단어를 전혀 듣지 못한 채 긴 구간 동안 연속으로 이동만 했을 때. |

### 4.3 모델 힌트 (`source: "model"`)

| `kind` | `certainty` | 기본 임계값 / 발생 조건 |
| :--- | :--- | :--- |
| **`expectation-broken`** | `observed` | 계획 문서의 가정이 깨진 것으로 기록되었을 때 (예: 최근 3번의 동작 이내에 버튼을 누르거나 폼을 제출했으나 기대한 변화가 나타나지 않음). 배치 요약에서는 **막힌 지점**으로 집계됩니다. |
| **`backtracking`** | `observed` | 앞으로 가기(`next`, `Tab`, `ArrowDown`, `ArrowRight`)와 뒤로 가기(`previous`, `Shift+Tab`, `ArrowUp`, `ArrowLeft`) 사이에서 이동 방향을 `>= 2`번(`backtrackReversals`) 이상 번복했을 때. |
| **`early-stop`** | `observed` | 목표에 도달하기 전에 실행이 종료되었을 때 (`user-gave-up`, `policy-stuck`, `policy-uncertain`, `exploration-guard`, `orchestration-limit`, `no-allowed-action`). |
