# 프롬프트 템플릿

프롬프트 파일은 기본적으로 루트 `prompt/` 디렉터리에서 읽습니다.  
다른 디렉터리를 쓰려면 `rawstep.config.ts > defaults.prompt.dir`를 설정합니다.

---

## 파일 구조

선택한 디렉터리에는 아래 파일이 모두 있어야 하며, 빈 파일은 허용되지 않습니다.

| 파일 | 설명 |
|------|------|
| `keyboard.system.md` | keyboard agent 규칙 프롬프트 |
| `keyboard.user.md` | keyboard agent step 입력 템플릿 |
| `screenreader.system.md` | screenreader agent 규칙 프롬프트 |
| `screenreader.user.md` | screenreader agent step 입력 템플릿 |
| `experience-summary.system.md` | summary 생성 규칙 프롬프트 |
| `experience-summary.user.md` | summary 생성 입력 템플릿 |

`*.system.md`는 고정 규칙, `*.user.md`는 실행 시점 데이터가 채워지는 템플릿입니다.  
Markdown 주석(`<!-- ... -->`)은 로딩 시 제거되며 모델 입력에 포함되지 않습니다.

### 사용 시점

| 파일 | 사용 시점 |
|------|-----------|
| `keyboard.system.md`, `screenreader.system.md` | run 전체 동안 유지 |
| `keyboard.user.md`, `screenreader.user.md` | 매 step마다 다시 렌더링 |
| `experience-summary.system.md`, `experience-summary.user.md` | run 종료 후 summary 생성 시에만 사용 |

---

## 템플릿 변수

템플릿에는 placeholder 이름만 적습니다. 실행 시점에 RawStep이 현재 상태를 문자열 블록으로 렌더링해 채워 넣습니다.

### placeholder 목록

| 파일 | placeholder |
|------|-------------|
| `keyboard.system.md` | `{{outputExamples}}` |
| `keyboard.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{focusHint}}`, `{{availableActions}}` |
| `screenreader.system.md` | `{{outputExamples}}` |
| `screenreader.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{availableActions}}` |
| `experience-summary.user.md` | `{{taskSummary}}`, `{{aggregateSummary}}`, `{{stepTimeline}}` |

### 필수 placeholder

아래 placeholder는 누락되면 로딩 시 에러가 발생합니다.

| 파일 | 필수 placeholder |
|------|-----------------|
| `keyboard.system.md` | `{{outputExamples}}` |
| `keyboard.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{availableActions}}` |
| `screenreader.system.md` | `{{outputExamples}}` |
| `screenreader.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{availableActions}}` |
| `experience-summary.user.md` | `{{taskSummary}}`, `{{aggregateSummary}}`, `{{stepTimeline}}` |

`{{focusHint}}`처럼 필수가 아닌 placeholder는 포함하거나 생략할 수 있습니다.

> **주의:** 필수 placeholder는 제거할 수 없습니다. placeholder 이름을 바꾸면 코드도 함께 수정해야 합니다.

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

```
available actions:
- status: present
- items:
  - key.Tab: 다음 포커스로 이동할 때 사용하라.
  - key.Enter: 현재 포커스된 요소를 활성화할 때 사용하라.
```

`status: present`, `status: empty` 같은 블록의 해석은 system prompt 규칙에 따릅니다.