# RawStep
> 과업 기반 접근성 진단 도구

## 개요

axe-core, Lighthouse 같은 도구는 DOM과 규칙 위반을 잘 찾습니다.  
하지만 실제 사용자가 과업을 수행할 때 어디서 막히는지는 잘 보여주지 못합니다.

RawStep은 제한된 관측 채널과 제한된 행동 집합 안에서 에이전트가 직접 과업을 시도하게 하고, 그 과정을 trace와 리포트로 남깁니다.

- 키보드 사용자처럼 실제로 이동하며 목표에 도달하는지
- 스크린리더 사용자가 읽히는 정보만으로 다음 행동을 고를 수 있는지
- 성공까지 몇 step이 걸렸는지
- 어느 시점부터 헤매기 시작했는지
- verifier 기준으로 실제 성공이 확인됐는지

| 항목 | 규칙 기반 도구 | RawStep |
|------|----------------|---------|
| 평가 단위 | 규칙 위반 | 과업 수행 |
| 입력 | DOM / ARIA | 스크린샷 또는 스크린리더 announcement |
| 출력 | 규칙별 통과/실패 | trace, metrics, prompts, HTML report |
| 병목 위치 추적 | 약함 | 강함 |
| 실제 사용 흐름 재현 | 간접적 | 직접적 |

---

## 빠른 시작

```bash
pnpm install
pnpm build
cp .env.sample .env
# .env 에서 AI_PROVIDER, AI_API_KEY, AI_MODEL 값을 채운다
# openai-compatible provider면 AI_BASE_URL도 함께 채운다
pnpm rawstep run examples/tasks/simple-cta.json
```

기본 출력 경로는 `./.rawstep/out/<mode>/<taskId>/<runId>/` 입니다.  
실행이 끝나면 CLI가 `report/index.html` 경로를 출력합니다.

이 repo에는 바로 실행 가능한 기본 [rawstep.config.ts](./rawstep.config.ts)가 이미 들어 있습니다.  
처음에는 설정 파일을 새로 만들기보다 `.env`만 채우고 `examples/tasks/` 아래 예시 task부터 실행하면 됩니다.

### 현재 기본 설정

- `keyboard`
  - `headless: true`
  - `maxSteps: 30`
  - `timeoutMs: 240000`
  - `memory: "all"`
  - `verifierAutoComplete: true`
- `screenreader`
  - `headless: false`
  - `screenReaderBackend: "guidepup-virtual"`
  - `maxSteps: 1000`
  - `timeoutMs: 600000`
  - `screenshots: "all"`
  - `memory: "all"`
  - `verifierAutoComplete: true`

> 기본 screenreader backend는 `guidepup-virtual`입니다.  
> `guidepup-voiceover`, `guidepup-nvda` 같은 실제 OS 스크린리더로 바꾸면 OS 권한과 환경 준비가 추가로 필요할 수 있습니다.

---

## 실행 흐름

한 번 실행하면 대략 아래 순서로 진행됩니다.

1. task 파일을 읽고 실행 계획을 만듭니다.
2. 브라우저와 관측기(observer)를 초기화합니다.
3. step마다 관측, 판단, 실행, 검증을 반복합니다.
4. planning / reflection이 켜져 있으면 중간 전략 갱신도 수행합니다.
5. 종료 후 trace, metrics, prompts, report를 저장합니다.

쉽게 말하면, RawStep은 "성공했는지"만 찍는 도구가 아니라 "어떻게 실패했는지"까지 남기는 도구입니다.

---

## 사용자 모델

### `keyboard`

- 관측: 현재 viewport screenshot, 이전 screenshot, focus hint, scroll hint
- 행동: `Tab`, `Shift+Tab`, 화살표, `Enter`, `Space`, `Escape`, `Home`, `End` 등 허용된 키
- 특징: 이미지 입력이 가능한 모델이 필요합니다

### `screenreader`

- 관측: announcement 텍스트, capture 방식, observe reason, readbacks
- 행동: `sr.next`, `sr.form.next`, `sr.heading.next`, `sr.act`, `sr.key.*` 등 허용된 screenreader action
- 특징: 개발자용 스크린샷은 저장될 수 있지만 에이전트 입력에는 들어가지 않습니다

### 에이전트에게 주지 않는 정보

- DOM selector
- accessibility tree
- ARIA role/label 전체
- 요소 존재 여부에 대한 정답
- 정밀한 시각 위치 정보

---

## 산출물

실행 결과는 보통 아래 파일들로 남습니다.

- `trace.jsonl`: step별 리플레이 로그
- `trace.json`: 최종 합본 trace
- `metrics.json`: 총 step 수, 종료 이유, action count, timing
- `prompts.json`: step별 prompt 기록
- `report/index.html`: 사람이 보기 좋은 리포트
- `diagnostics.jsonl`: 런타임 경고/에러가 있을 때만 생성

리포트에는 아래 정보가 함께 정리됩니다.

- 최종 성공/실패
- failure point
- action breakdown
- timing overview
- step detail
- screenreader announcement 근거
- experience summary
- planning / reflection 결과

리포트 구조는 [docs/report.md](./docs/report.md)에서 자세히 볼 수 있습니다.

---

## Task 작성

task 파일은 "어느 페이지에서 무엇을 해야 하는지"를 적는 실행 단위입니다.

### 최소 예시

```json
{
  "url": "../../fixtures/simple-cta.html",
  "goal": "Get started 버튼을 찾아서 활성화하고, 결과 메시지가 보이는 상태로 만들어라.",
  "verify": {
    "all": [
      { "textVisible": "Started!" },
      { "titleIncludes": "Completed" }
    ]
  }
}
```

추가로 넣을 수 있는 대표 필드는 아래입니다.

- `id`
- `mode`
- `maxSteps`
- `timeoutMs`
- `input`
- `prompt`
- `config`
- `verify`

자세한 스펙은 [docs/task.md](./docs/task.md)를 보면 됩니다.

---

## 프롬프트 구조

프롬프트는 루트 `prompt/` 디렉터리에서 읽습니다.

현재는 단순히 `keyboard.system.md`, `screenreader.system.md`만 쓰는 구조가 아닙니다.  
아래 단계별 템플릿이 함께 사용됩니다.

- browse 단계용 prompt
- execute 단계용 prompt
- planning prompt
- reflection prompt
- experience summary prompt

즉, 실행 중에 같은 프롬프트를 계속 재사용하는 게 아니라, 단계에 따라 다른 템플릿을 렌더링합니다.

프롬프트 파일과 placeholder 설명은 [docs/prompts.md](./docs/prompts.md)에서 확인할 수 있습니다.

---

## 세부 문서

- [docs/task.md](./docs/task.md): task 스펙, `input`, `verify`, override 규칙
- [docs/config.md](./docs/config.md): `rawstep.config.ts`, defaults, modes, planning, observe, 우선순위
- [docs/cli.md](./docs/cli.md): CLI 옵션, provider 환경 변수, 허용 키/action 목록
- [docs/report.md](./docs/report.md): 리포트 구조와 각 항목 설명
- [docs/prompts.md](./docs/prompts.md): 프롬프트 파일 구조와 템플릿 변수 설명
- [docs/editing-map.md](./docs/editing-map.md): 수정 포인트와 변경 후 확인 항목

---

## 한계

- 에이전트는 제한된 관측 채널만 받습니다. 실제 사용자처럼 모든 문맥을 알 수는 없습니다.
- 같은 task라도 실행마다 결과가 달라질 수 있습니다.
- `screenreader` 모드는 backend 품질과 환경 상태에 크게 영향을 받습니다.
- `screenreader + guidepup-voiceover` 조합에서는 `typeText` 후 synthetic announcement가 쓰일 수 있습니다.
- 자유로운 텍스트 생성 입력은 허용하지 않고, task가 제공한 값만 입력합니다.

쉽게 말하면, RawStep은 "정답 판정기"보다는 "과업 수행 병목을 드러내는 실험 도구"에 가깝습니다.
