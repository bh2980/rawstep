# Config 문서

`rawstep.config.ts`는 실행 계약 파일입니다.
이 파일이 없으면 CLI는 바로 실패합니다.

쉽게 말해:

- `defaults`: AI provider 쪽 기본값
- `modes`: keyboard / screenreader 실행 기본값
- `observe`: screenreader 관찰 타이밍 세부값

관련 문서:

- task override는 [task.md](./task.md)
- CLI 강제 override는 [cli.md](./cli.md)

## 기본 예시

```ts
import { defineConfig, kb, sr } from "@rawstep/config";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-latest",
    apiKey: process.env.AI_API_KEY
  },
  modes: {
    keyboard: {
      outDir: "./.rawstep/out/keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      screenshots: "important",
      verifierAutoComplete: false
    },
    screenreader: {
      outDir: "./.rawstep/out/screenreader",
      maxSteps: 240,
      timeoutMs: 420000,
      memory: "all",
      headless: false,
      screenReaderBackend: "guidepup-voiceover",
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      observe: {
        silenceWindowMs: 1500,
        maxObserveMs: 12000
      },
      allowedScreenReaderActions: [
        sr.key.tab(),
        sr.key.enter(),
        sr.next(),
        sr.act()
      ]
    }
  }
});
```

실제 저장소에 들어 있는 예시는 [rawstep.config.ts](../rawstep.config.ts)입니다.

## `defaults`

`defaults`는 AI provider 관련 값과 prompt 디렉터리만 받습니다.
실행 옵션은 여기 넣는 곳이 아닙니다.

| 필드 | 설명 |
|------|------|
| `provider` | `anthropic` 또는 `openai-compatible` |
| `apiKey` | provider API 키 |
| `model` | 모델 ID |
| `baseURL` | OpenAI-compatible provider일 때만 사용 |
| `prompt.dir` | prompt 디렉터리 경로. 기본은 config 파일 옆 `./prompt` |

주의:

- `outDir`, `timeoutMs`, `memory` 같은 값은 `defaults`에 넣으면 안 됩니다.
- 그런 값은 `modes.<mode>`에 넣어야 합니다.

## `modes.<mode>`

`modes.keyboard`, `modes.screenreader`는 사용자 모델별 실행 기본값입니다.

`outDir`, `maxSteps`, `timeoutMs`, `memory`는 사실상 필수로 보는 편이 안전합니다.
`screenreader`에서는 `screenReaderBackend`도 꼭 있어야 합니다.

| 필드 | 설명 |
|------|------|
| `outDir` | 결과 출력 디렉터리 |
| `headless` | 브라우저 창 표시 여부 |
| `maxSteps` | 최대 step 수 |
| `timeoutMs` | 전체 실행 제한 시간(ms) |
| `maxVerificationRetries` | verifier 실패 후 success 선언을 되돌릴 최대 횟수 |
| `screenshots` | `all`, `important`, `failure-only`, `none` |
| `verifierAutoComplete` | 성공 가능성이 보이는 action 뒤에도 verifier를 돌릴지 |
| `includeExperienceSummary` | run 종료 후 요약 포함 여부 |
| `includeRationale` | agent rationale 저장 여부 |
| `memory` | 숫자 또는 `"all"` |
| `allowedKeys` | keyboard 모드에서 허용할 키 subset |
| `allowedScreenReaderActions` | screenreader 모드에서 허용할 `sr.*` subset |
| `screenReaderBackend` | `guidepup-voiceover`, `guidepup-nvda`, `guidepup-virtual` |
| `observe` | screenreader 모드 관찰 타이밍 override |

mode별 제약:

- `keyboard` 모드에는 `allowedScreenReaderActions`, `screenReaderBackend`, `observe`를 넣을 수 없습니다.
- `screenreader` 모드에는 `allowedKeys`를 넣을 수 없습니다.

## `observe`

`observe`는 screenreader 모드에서만 씁니다.
keyboard 모드에 넣으면 타입과 런타임 둘 다 어긋납니다.

자주 만지는 값은 보통 두 개입니다.

- `silenceWindowMs`: 이 시간 동안 새 announcement가 없으면 "이제 다 읽었다"고 판단
- `maxObserveMs`: 아무리 길어도 최대 이 시간까지만 기다림

전체 필드는 아래와 같습니다.

| 필드 | 설명 |
|------|------|
| `pollIntervalMs` | 새 announcement를 몇 ms 간격으로 확인할지 |
| `silenceWindowMs` | 조용한 시간 기준 |
| `maxObserveMs` | 최대 관찰 시간 |
| `allowFallback` | 로그가 비었을 때 fallback 문장 허용 여부 |

기본값:

```ts
observe: {
  pollIntervalMs: 100,
  silenceWindowMs: 500,
  maxObserveMs: 3000,
  allowFallback: false
}
```

병합 방식:

- `modes.screenreader.observe`를 기본으로 사용합니다.
- task의 `config.observe`는 부분 덮어쓰기입니다.
- 예를 들어 mode preset에 `silenceWindowMs`가 있고 task에 `maxObserveMs`만 있으면 실행 시 두 값이 합쳐집니다.

## 실행 우선순위

같은 값을 여러 곳에서 지정하면 아래 순서로 마지막 값이 이깁니다.

```text
CLI 플래그
  > task.config
    > task top-level (mode, maxSteps, timeoutMs)
      > rawstep.config.ts modes.<mode>
        > 환경 변수 (provider 관련만)
```

정리하면:

- 가장 강한 것은 CLI
- 과업마다 다른 예외는 task
- 프로젝트 공통 기본값은 `rawstep.config.ts`

## task override와 mode preset 관계

권장 구조는 아래입니다.

- mode 공통 규칙: `rawstep.config.ts`
- 과업 자체 설명: task 파일
- 예외적인 실행 차이: task `config`

이렇게 나누면 같은 옵션을 여러 task에 반복해서 적지 않아도 됩니다.

## screenreader 관련 주의점

- `guidepup-voiceover`는 macOS 전용입니다.
- `guidepup-nvda`는 Windows 전용입니다.
- `guidepup-virtual`은 macOS, Linux, Windows에서 동작합니다.
- `guidepup-voiceover`, `guidepup-nvda`는 headed 브라우저가 필요합니다.
- `guidepup-virtual`은 기본적으로 headless가 가능합니다.

처음에는 환경 제약이 적은 `guidepup-virtual`로 흐름을 맞추고, 실제 OS 스크린리더 검증이 필요할 때 `voiceover`나 `nvda`로 옮기는 쪽이 편합니다.
