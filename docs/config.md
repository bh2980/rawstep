# rawstep.config.ts

---

## 기본 구조

`rawstep.config.ts`는 실행의 기준이 되는 설정 파일입니다. 이 repo에는 기본 파일이 포함되어 있습니다.

```ts
import { defineConfig, kb, sr } from "@rawstep/config";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "<anthropic|openai-compatible>",
    model: "<your-model>",
    apiKey: "<your-key>",
    reasoningEffort: "medium"
  },
  modes: {
    keyboard: {
      maxSteps: 30,
      timeoutMs: 240000,
      headless: true,
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all"
    },
    screenreader: {
      maxSteps: 1000,
      timeoutMs: 600000,
      memory: "all",
      headless: false,
      screenReaderBackend: "guidepup-virtual",
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      allowedScreenReaderActions: [
        sr.key.arrow.up(), sr.key.arrow.down(), sr.key.arrow.left(), sr.key.arrow.right(),
        sr.key.enter(), sr.key.space(), sr.key.escape(),
        sr.next(), sr.previous(),
        sr.landmark.next(), sr.landmark.previous(),
        sr.heading.next(), sr.heading.previous(),
        sr.button.next(), sr.button.previous(),
        sr.form.next(), sr.form.previous(),
        sr.interact(), sr.stopInteracting(),
        sr.act()
      ]
    }
  }
});
```

---

## 실행 우선순위

높은 것이 낮은 것을 덮어씁니다.

```
CLI 플래그
  > task.config
    > task top-level (mode, maxSteps, timeoutMs)
      > rawstep.config.ts modes.<mode>
        > 환경 변수 (provider 관련만)
```

---

## 필드 레퍼런스

### `defaults`

AI provider 관련 값과 prompt 디렉터리만 받습니다.  
`outDir`, `timeoutMs`, `memory` 같은 실행 옵션을 넣으면 에러가 납니다.

| 필드 | 설명 |
|------|------|
| `provider` | `anthropic` 또는 `openai-compatible` |
| `apiKey` | provider API 키 |
| `model` | 모델 ID |
| `baseURL` | OpenAI-compatible provider일 때만 사용 |
| `prompt.dir` | prompt 디렉터리 경로. 기본은 config 파일 옆 `./prompt` |

### `modes.<mode>`

이 repo의 기본 설정은 `keyboard`, `screenreader` 둘 다 `memory: "all"`과 `verifierAutoComplete: true`를 사용합니다.

`outDir`를 생략하면 모드별 기본 출력 루트를 사용합니다.
- `keyboard`: `./.rawstep/out/keyboard`
- `screenreader`: `./.rawstep/out/screenreader`

| 필드 | 설명 | 기본값 |
|------|------|--------|
| `outDir` | 출력 루트 디렉터리. 실제 저장 위치는 `<outDir>/<taskId>/<runId>` | `keyboard`: `./.rawstep/out/keyboard`, `screenreader`: `./.rawstep/out/screenreader` |
| `headless` | 브라우저 창 표시 여부 | mode/backend 기본 정책 |
| `maxSteps` | 최대 step 수 | — |
| `timeoutMs` | 전체 실행 제한 시간(ms) | — |
| `maxVerificationRetries` | verifier 실패 시 success 선언을 되돌릴 최대 횟수 | — |
| `screenshots` | `all \| important \| failure-only \| none` | `important` |
| `verifierAutoComplete` | 성공 가능성이 있는 action 뒤에도 verifier를 돌릴지 | — |
| `includeExperienceSummary` | run 종료 후 경험 요약(`experience summary`) 포함 여부 | `false` |
| `includeRationale` | agent step 별 행동 근거(`rationale`) 저장 여부 | `false` |
| `reasoningEffort` | `none \| low \| medium \| high \| xhigh` | `defaults.reasoningEffort` |
| `memory` | 숫자 또는 `"all"` | — |
| `allowedKeys` | 허용할 키 subset (`keyboard` 모드 전용) | 기본 subset |
| `allowedScreenReaderActions` | 허용할 `sr.*` action subset | 전체 허용 |
| `screenReaderBackend` | `guidepup-voiceover \| guidepup-nvda \| guidepup-virtual` | — |
| `observe` | screenreader 모드용 관찰 타이밍 override | 아래 참고 |
| `voiceOver` | VoiceOver 전용 옵션 | — |
| `planning` | planning / reflection 제어 | 모드별 기본값 |
| `navigation` | navigation guard 정책 | `same-origin` |

### `observe`

`screenreader` 모드에서만 사용할 수 있습니다.
 
| 필드 | 설명 | 기본값 |
|------|------|--------|
| `pollIntervalMs` | 새 announcement를 확인하는 간격(ms) | `100` |
| `silenceWindowMs` | 조용한 시간으로 판정하는 기준(ms) | `500` |
| `maxObserveMs` | 최대 관찰 시간(ms) | `3000` |
| `allowFallback` | 로그가 비었을 때 fallback 문장을 허용할지 | `false` |

`task.config.observe`는 `rawstep.config.ts > modes.screenreader.observe`를 부분적으로 덮어씁니다.  
예를 들어 config에 `silenceWindowMs`가 있고 task에는 `maxObserveMs`만 있으면, 실행 시 두 값이 합쳐집니다.

### `planning`

planning은 초기 계획과 중간 reflection cadence를 조정합니다.

| 필드 | 설명 |
|------|------|
| `enabled` | planning / reflection 사용 여부 |
| `reflectionCadence` | 몇 step마다 reflection을 돌릴지 |
| `initialDelaySteps` | planning을 시작하기 전 대기 step 수 |
| `firstReflectionDelaySteps` | 첫 reflection까지의 지연 step 수 |

기본값은 mode마다 다릅니다.

- `keyboard`: planning 즉시 시작, reflection cadence 10
- `screenreader`: planning은 3 step 뒤 시작, reflection cadence 10

### `navigation`

navigation guard는 task 범위를 벗어나는 이동을 막는 정책입니다.

| 필드 | 설명 |
|------|------|
| `strategy: "same-origin"` | 같은 origin만 허용 |
| `strategy: "start-url-prefix"` | 시작 URL prefix만 허용 |
| `strategy: "allow-url-list"` | `allowUrlList`에 적은 prefix만 허용 |

쉽게 말하면, 실수로 외부 페이지나 과업 범위 밖으로 튀는 걸 막는 장치입니다.

---

## action `hint`

`allowedKeys`, `allowedScreenReaderActions`의 각 항목에 `hint`를 붙일 수 있습니다.

```ts
keyboard: {
  allowedKeys: [
    kb.tab({ hint: "다음 포커스로 이동할 때 사용하라." }),
    kb.enter({ hint: "현재 포커스된 요소를 활성화할 때 사용하라." })
  ]
},
screenreader: {
  allowedScreenReaderActions: [
    sr.next({ hint: "다음 항목으로 이동할 때 사용하라." }),
    sr.act({ hint: "현재 항목의 기본 동작을 실행할 때 사용하라." })
  ]
}
```

설정한 `hint`는 매 step user prompt의 `availableActions` 목록에 함께 렌더링됩니다.  
예: `sr.act: 현재 항목의 기본 동작을 실행할 때 사용하라.`

> **주의:** CLI의 `--allowed-keys` / `--allowed-screen-reader-actions`로 값을 override하면 config에 설정한 `hint`는 프롬프트에 전달되지 않습니다. `hint`는 `rawstep.config.ts`의 `kb.*` / `sr.*` helper를 통해서만 설정할 수 있습니다.
