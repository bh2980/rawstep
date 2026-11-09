# 핵심 개념

Rawstep은 **무엇을 할지**(태스크, 대시보드에서는 '작업')와 **누가 어떻게 탐색할지**(실행 프로필)를 나누고, 목표 도달 여부와 그 과정에서 겪은 불편을 함께 기록합니다.

---

## 1. 시뮬레이션 사용자와 독립 검증기의 분리

Rawstep에서는 사용자로 행동하는 AI 모델과 성공 여부를 판정하는 검증기가 철저히 분리되어 있습니다.

| 역할 | 볼 수 있는 정보 | 할 수 있는 행동 |
| :--- | :--- | :--- |
| **시뮬레이션 사용자 (플래너 + 실행기)** | 태스크의 `goal`, 선택적인 `context`, 선언된 `input` 키 이름, 그리고 매 단계 스크린리더가 **소리 내어 읽어준 발화 텍스트**만 받습니다. HTML 소스, CSS 셀렉터, 스크린샷, `verify.all` 조건은 절대 볼 수 없습니다. | 허용된 스크린리더 명령(`next`, `previous`, `heading.next`, `activate`, 로터 목록 등), 허용된 키보드 키, 선언된 입력값 타이핑만 수행합니다. |
| **독립 검증기 (`verify.all`)** | 실제 브라우저 상태: URL, 문서 제목, 화면에 보이는 텍스트, 네트워크 요청/응답, 페이지 관찰자 이벤트(포커스 이동, 모달 등장, 라이브 리전 발화, 속성 변경), 샌드박스 검증 스크립트를 확인합니다. | 매 단계가 끝날 때마다 `task.verify.all`의 모든 규칙이 충족되었는지 검사합니다. |

시뮬레이션 사용자는 DOM을 보지 못하고 스스로 성공 판정도 내릴 수 없기 때문에 다음과 같은 상황을 자연스럽게 잡아냅니다.
- 버튼을 눌렀을 때 시각적으로만 화면이 바뀌고 음성이나 `aria-live`로 아무런 안내가 나오지 않으면, 시뮬레이션 사용자는 버튼이 제대로 눌렸는지 알지 못해 주변을 계속 탐색합니다.
- 시뮬레이션 사용자가 안내 음성을 잘못 이해해 과제가 끝났다고 판단하고 멈췄더라도, 실제 브라우저에서 `task.verify.all`이 통과하지 않았다면 성공이 아니라 **`mistaken`**으로 분류됩니다.

---

## 2. 태스크 (`tasks/*.json`)

**태스크**는 사용자가 페이지에서 달성하려는 목표를 정의합니다.
- **`url` 및 `goal`:** 시작할 URL과 달성할 목표입니다. 페이지 내부 구조나 정답 경로를 알려주지 않고 실제 사용자가 이해할 법한 자연어로 작성합니다.
- **`context` *(선택)*:** 실제 사용자라면 시작 전에 이미 알고 있을 배경 정보입니다 (예: *"중간 사이즈의 파란색 재킷을 찾고 있습니다"*).
- **`input` 및 `inputOptions` *(선택)*:** 폼 필드에 입력할 수 있는 이름 붙은 값들입니다 (`email`, `password`, `searchQuery` 등). 모든 입력값은 **기본적으로 민감 정보로 취급**되어, `"sensitive": false`로 명시하지 않는 한 플래너 프롬프트에 실제 값이 노출되지 않고 저장되는 트레이스와 음성 기록에서도 마스킹됩니다.
- **`verify.all`:** 브라우저에서 목표가 실제로 달성되었음을 증명하는 하나 이상의 독립 검증 규칙입니다.
- **`variantOf` 및 `minimalSteps` *(선택, `rawstep.config.json`에서 설정)*:**
  - `minimalSteps`: 사람이 이 과제를 완료하는 데 필요한 최소 이동 횟수로, 리포트에서 기준선으로 표시됩니다.
  - `variantOf`: 특정 접근성 결함이 있는 페이지 변형을 테스트할 때 원본 태스크 ID를 지정하면, 리포트에서 해당 결함 때문에 늘어난 이동 횟수를 비교해 보여줍니다.

---

## 3. 실행 프로필 (`rawstep.config.json`의 `profiles`)

**실행 프로필**은 시뮬레이션 사용자가 어떤 조건과 습관으로 페이지를 탐색할지 정의합니다. 같은 태스크를 서로 다른 프로필로 실행하면 페이지 구조가 탐색 방식에 따라 어떤 차이를 만드는지 비교할 수 있습니다.

하나의 프로필은 다섯 가지 설정을 묶어 관리합니다.

1. **플래너 (`planner`):** 탐색 계획을 세울 AI 연결과 모델, 또는 API 호출 없이 동일하게 재현할 수 있는 오프라인 계획 파일(`plans/{task}.json`)을 지정합니다.
2. **허용 동작 / 탐색 방식 (`actions`):** 시뮬레이션 사용자가 페이지를 이동하는 방식입니다.
   - **한 칸씩(순차 탐색):** 위에서부터 한 항목씩 차례대로 읽으며 이동합니다 (`next`, `previous`, `activate`).
   - **제목으로(헤딩 기준 탐색):** 헤딩 간 점프와 헤딩 목록 조회를 추가로 허용합니다 (`heading.next`, `heading.previous`, `headings.list`).
   - **폼 컨트롤로(폼 컨트롤 기준 탐색):** 폼 컨트롤 간 점프와 폼 컨트롤 로터를 추가로 허용합니다 (`form.next`, `form.previous`, `formControls.rotor`).
   - **링크로(링크 기준 탐색):** 링크 간 점프와 링크 목록 조회를 추가로 허용합니다 (`link.next`, `link.previous`, `links.list`).
   - **커스텀:** 스크린리더 명령, 물리 키보드 키, 텍스트 입력 권한(`typeText`, `replaceText`, `inputKeys`)을 원하는 대로 조합합니다.
3. **스크린리더 (`screenReader`):**
   - `'simulation'` *(기본값)*: 영어 VoiceOver 발화 규칙을 기반으로 동작하는 내장 Chromium 접근성 트리 시뮬레이터입니다.
   - `'voiceover'`: W3C AT Driver를 통해 연결하는 실제 macOS VoiceOver입니다.
   - `'nvda'`: W3C AT Driver를 통해 연결하는 실제 Windows NVDA입니다.
4. **페이지 환경 (`page`):** 브라우저 뷰포트와 미디어 에뮬레이션 설정입니다 (`default`, `narrow`, `text-200`, `spacing`, `reflow-text`, `forced-colors`, `contrast`, `dark`, `reduced-motion` 프리셋 또는 커스텀 객체).
5. **실행 규칙 (`runRules`):** 한도 및 재계획 조건을 제어합니다 (`maxPlannerCalls`, `reviewEvery`, `stepActionLimit`, `failureLimit`, `noChangeLimit`, `confirmationGrace`, `repetitionGuard`, `survey`).

---

## 4. 네 가지 실행 종료 상태 (`RunEnding`)

Rawstep은 실행 결과를 단순한 성공/실패 두 가지로만 나누지 않고 네 가지 상태로 분류합니다.

| 종료 상태 (`RunEnding`) | CLI / 대시보드 표기 | 의미 |
| :--- | :--- | :--- |
| **`reached`** | `reached the goal` | `task.verify.all`의 모든 완료 조건을 통과했습니다. |
| **`gave-up`** | `gave up` | 여러 경로를 탐색하고 계획을 수정해 보았지만, 페이지에서 들리는 정보만으로는 목표를 달성할 방법이 없다고 판단해 스스로 포기하고 그 이유를 남겼습니다 (`user-gave-up`). |
| **`mistaken`** | `said it was done, but the goal was not reached` | 시뮬레이션 사용자는 음성 안내만 듣고 목표를 달성했다고 생각해 멈췄으나, 실제 `task.verify.all` 조건은 통과하지 못했습니다 (`verification-failed`). 주로 부정확한 음성 안내나 조용히 실패한 폼 제출에서 나타납니다. |
| **`unmeasured`** | `not measured` | 사용자가 완료하거나 포기하기 전에 실행 한도나 환경 문제로 중단된 상태입니다 (`maxPlannerCalls`, `maxSteps`, `timeoutMs`, `repetitionGuard` 도달, 플래너 시간 초과나 판단 불가, 계획에 필요한 동작이 프로필에 허용되지 않음, 봇 차단, 페이지 환경 적용 실패 등). `unmeasured`는 사용자 실패로 집계되지 않으며, CLI에서는 종료 코드 `3`을 반환합니다. |

---

## 5. 이동 횟수, 막힌 지점과 마찰 힌트

실행이 **`reached`**로 끝났더라도 Rawstep은 그 과정이 얼마나 매끄러웠는지 함께 기록합니다.

- **이동 횟수:** 목표에 도달하기까지 수행한 스크린리더 동작 수입니다. 헤딩으로 점프할 때(`by-headings`)는 6번 만에 끝나는데 항목별로 읽을 때(`linear`)는 28번이 걸린다거나, UI 수정 후 중앙값 이동 횟수가 8번에서 22번으로 늘어났다면 이를 바로 확인할 수 있습니다.
- **확인 유예 (`confirmationGrace`):** 버튼을 눌러 `verify.all` 조건이 충족되면 Rawstep은 그 조건의 문구가 발화에 그대로 나왔는지 비교합니다. 나오지 않았다면 즉시 끝내지 않고 기본 `5`번까지 더 진행하면서 사용자가 안내를 듣게 되는지 지켜봅니다. 어느 쪽이든 실행은 `reached`로 끝나고, 이동 횟수는 조건을 통과한 지점까지만 셉니다.
- **확인 안 됨 (`goalConfirmed: false`):** `reached` 옆에 붙는 참고 정보이며 별도 결과가 아닙니다. 사용자가 알았다는 근거가 없다는 뜻입니다. 유예 안에 문구를 듣지 못했고 끝났다고 말하지도 않았거나, 다른 이유(한도, 반복 감시)로 멈춘 경우입니다. 화면에만 뜨고 읽히지 않는 성공 메시지가 흔한 원인이지만, 다른 말로 안내하는 페이지에도 붙을 수 있으니 직접 확인해 보세요. 비교할 문구가 없는 조건(`urlIncludes`나 `script`만 있는 경우)은 바로 끝나고 이 표시도 붙지 않습니다. 완료 조건은 작성자가 정한 완료의 정의입니다. 사용자가 들어야 완료라면 `activatedAnnouncementIncludes`를 조건에 넣으세요. 듣지 못한 실행은 통과하지 않습니다.
- **막힌 지점 (`expectation-broken`):** 사용자가 특정 변화를 기대하며 버튼을 누르거나 값을 입력했는데(계획의 `cue` 및 `assumptions`에 기록됨) 아무 반응이 없거나 기대와 다른 결과가 나오면, 해당 요소와 깨진 가정을 막힌 지점으로 기록합니다.
- **마찰 힌트 (`hints.json`):** 실행 기록에서 16가지 유형의 마찰 힌트를 추출합니다.
  - **페이지 힌트 (`source: 'page'`):** 브라우저와 스크린리더 동작에서 직접 관찰된 문제 (`excess-keystrokes`, `focus-lost`, `focus-left-page`, `focus-not-visible`, `modal-focus-outside`, `missing-announcement`, `live-interruptions`).
  - **실행 힌트 (`source: 'run'`):** 실행 전반에서 나타난 패턴 (`slow-run`, `goal-met-at-start`, `replan`, `task-limit`, `wanted-to-give-up`, `goal-word-stretch`).
  - **모델 힌트 (`source: 'model'`):** 이동 방향 번복 및 깨진 기대 (`backtracking`, `early-stop`, `expectation-broken`).

16가지 마찰 힌트의 상세 조건은 **[결과, 트레이스 및 힌트 레퍼런스](./reference/results.ko.md)**에서 확인할 수 있습니다.
