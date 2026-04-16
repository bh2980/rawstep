# 프롬프트 템플릿

프롬프트 파일은 기본적으로 루트 `prompt/` 디렉터리에서 읽습니다.  
다른 디렉터리를 쓰려면 `rawstep.config.ts > defaults.prompt.dir`를 설정합니다.

---

## 파일 구조

현재 RawStep은 단계별로 서로 다른 프롬프트를 씁니다.  
선택한 prompt 디렉터리에는 아래 파일이 모두 있어야 하며, 빈 파일은 허용되지 않습니다.

| 파일 | 설명 |
|------|------|
| `keyboard.browse.system.md` | keyboard browse 단계 규칙 |
| `keyboard.browse.user.md` | keyboard browse 단계 입력 템플릿 |
| `keyboard.system.md` | keyboard execute 단계 규칙 |
| `keyboard.user.md` | keyboard execute 단계 입력 템플릿 |
| `screenreader.browse.system.md` | screenreader browse 단계 규칙 |
| `screenreader.browse.user.md` | screenreader browse 단계 입력 템플릿 |
| `screenreader.system.md` | screenreader execute 단계 규칙 |
| `screenreader.user.md` | screenreader execute 단계 입력 템플릿 |
| `planning.system.md` | planning 규칙 |
| `planning.user.md` | planning 입력 템플릿 |
| `reflection.system.md` | reflection 규칙 |
| `reflection.user.md` | reflection 입력 템플릿 |
| `experience-summary.system.md` | experience summary 규칙 |
| `experience-summary.user.md` | experience summary 입력 템플릿 |

`*.system.md`는 고정 규칙, `*.user.md`는 실행 시점 데이터가 채워지는 템플릿입니다.  
Markdown 주석(`<!-- ... -->`)은 로딩 시 제거되며 모델 입력에 포함되지 않습니다.

---

## 사용 시점

| 파일 | 사용 시점 |
|------|-----------|
| `*.browse.*` | planning 전 초기 문맥 수집 단계 |
| `keyboard.system.md`, `keyboard.user.md` | keyboard execute 단계 |
| `screenreader.system.md`, `screenreader.user.md` | screenreader execute 단계 |
| `planning.*` | 초기 계획 생성 시 |
| `reflection.*` | 중간 전략 점검 시 |
| `experience-summary.*` | run 종료 후 요약 생성 시 |

쉽게 말하면, 한 번의 실행 동안 같은 프롬프트 하나만 쓰는 게 아니라 단계에 따라 템플릿을 갈아 끼웁니다.

---

## placeholder 목록

실행 시점에 RawStep이 현재 상태를 문자열 블록으로 렌더링해 placeholder를 채웁니다.

| 파일 | placeholder |
|------|-------------|
| `keyboard.browse.system.md` | `{{customSystemPrompt}}`, `{{outputExamples}}` |
| `keyboard.browse.user.md` | `{{customUserPrompt}}`, `{{goal}}`, `{{agentMemory}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `keyboard.system.md` | `{{customSystemPrompt}}`, `{{outputExamples}}` |
| `keyboard.user.md` | `{{customUserPrompt}}`, `{{goal}}`, `{{agentMemory}}`, `{{taskInputs}}`, `{{focusHint}}`, `{{availableActions}}`, `{{currentPlan}}`, `{{currentFocus}}`, `{{strategyNote}}`, `{{lastReflection}}` |
| `screenreader.browse.system.md` | `{{customSystemPrompt}}`, `{{outputExamples}}` |
| `screenreader.browse.user.md` | `{{customUserPrompt}}`, `{{goal}}`, `{{agentMemory}}`, `{{currentObservation}}`, `{{announcement}}`, `{{readbacks}}`, `{{taskInputs}}`, `{{availableActions}}` |
| `screenreader.system.md` | `{{customSystemPrompt}}`, `{{outputExamples}}` |
| `screenreader.user.md` | `{{customUserPrompt}}`, `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentPlan}}`, `{{currentFocus}}`, `{{strategyNote}}`, `{{lastReflection}}` |
| `planning.system.md` | `{{outputExamples}}` |
| `planning.user.md` | `{{goal}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `reflection.system.md` | `{{outputExamples}}` |
| `reflection.user.md` | `{{goal}}`, `{{currentPlan}}`, `{{currentFocus}}`, `{{strategyNote}}`, `{{recentSteps}}`, `{{recentMemory}}` |
| `experience-summary.user.md` | `{{taskSummary}}`, `{{aggregateSummary}}`, `{{stepTimeline}}` |

---

## 필수 placeholder

아래 값은 누락되면 로딩 시 에러가 납니다.

| 파일 | 필수 placeholder |
|------|-----------------|
| `keyboard.browse.system.md` | `{{outputExamples}}` |
| `keyboard.browse.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `keyboard.system.md` | `{{outputExamples}}` |
| `keyboard.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{taskInputs}}`, `{{availableActions}}` |
| `screenreader.browse.system.md` | `{{outputExamples}}` |
| `screenreader.browse.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `screenreader.system.md` | `{{outputExamples}}` |
| `screenreader.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{taskInputs}}`, `{{availableActions}}` |
| `planning.system.md` | `{{outputExamples}}` |
| `planning.user.md` | `{{goal}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `reflection.system.md` | `{{outputExamples}}` |
| `reflection.user.md` | `{{goal}}`, `{{currentPlan}}`, `{{currentFocus}}`, `{{strategyNote}}`, `{{recentSteps}}`, `{{recentMemory}}` |
| `experience-summary.user.md` | `{{taskSummary}}`, `{{aggregateSummary}}`, `{{stepTimeline}}` |

`{{customSystemPrompt}}`, `{{customUserPrompt}}`, `{{focusHint}}`, `{{currentPlan}}` 같은 값은 선택 사항입니다.  
task 파일이나 실행 상태에 값이 없으면 빈 블록 또는 empty 블록으로 렌더링됩니다.

---

## action hint

`rawstep.config.ts`에서 `allowedKeys` 또는 `allowedScreenReaderActions`에 `hint`를 지정하면, 해당 값은 `{{availableActions}}`에 함께 포함됩니다.

```ts
allowedKeys: [
  kb.tab({ hint: "다음 포커스로 이동할 때 사용하라." }),
  kb.enter({ hint: "현재 포커스된 요소를 활성화할 때 사용하라." })
]
```

렌더링 결과:

```text
- status: present
- items:
  - key.Tab: 다음 포커스로 이동할 때 사용하라.
  - key.Enter: 현재 포커스된 요소를 활성화할 때 사용하라.
```

CLI의 `--allowed-keys`, `--allowed-screen-reader-actions`로 값을 강제로 바꾸면 config에 적어 둔 `hint`는 전달되지 않습니다.

---

## 주의할 점

- placeholder 이름을 바꾸면 코드도 함께 수정해야 합니다.
- prompt 파일 하나라도 빠지면 로더가 즉시 실패합니다.
- browse/execute/planning/reflection은 서로 다른 템플릿이므로, 한 단계만 수정하고 전체 구조를 잊으면 프롬프트 동작이 어색해질 수 있습니다.

쉽게 말하면, prompt 디렉터리는 이제 단순 4파일 구조가 아니라 실행 단계 전체를 나누는 템플릿 묶음입니다.
