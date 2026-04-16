# RawStep

[English](./README.md) | 한국어

> 제한된 관측 하에서 키보드·스크린리더 과업 수행 병목을 기록하는 실험용 러너

> [!WARNING]
> RawStep은 실제 서비스 투입을 전제로 한 안정적인 접근성 진단 도구가 아닙니다.
> 제한된 관측 채널 안에서 에이전트가 과업을 수행할 때 어디서 실패하는지 관찰하기 위한 프로토타입입니다.
> 현재는 실제 과업 수행 성공률과 재현성이 낮고, 모델·backend·환경 상태에 따라 결과가 크게 달라질 수 있습니다.

## 개요

axe-core, Lighthouse 같은 도구는 DOM과 규칙 위반을 잘 찾습니다.  
하지만 실제 사용자가 과업을 수행할 때 어디서 막히는지는 잘 보여주지 못합니다.

RawStep은 제한된 관측 채널과 제한된 행동 집합 안에서 에이전트가 직접 과업을 시도하게 하고,
그 과정을 trace와 리포트로 남겨 병목 지점을 다시 볼 수 있게 하는 실험용 프로젝트입니다.

RawStep으로 주로 보려는 것은 아래와 같습니다.

- 키보드 사용자처럼 이동을 시도했을 때 목표에 가까워지는지
- 스크린리더 사용자가 읽히는 정보만으로 다음 행동을 고를 수 있는지
- 성공 또는 실패까지 몇 step이 걸렸는지
- 어느 시점부터 헤매기 시작했는지
- verifier 기준으로 실제 성공이 확인됐는지

| 항목 | 규칙 기반 도구 | RawStep |
|------|----------------|---------|
| 평가 단위 | 규칙 위반 | 과업 수행 |
| 입력 | DOM / ARIA | 스크린샷 또는 스크린리더 announcement |
| 출력 | 규칙별 통과/실패 | trace, metrics, prompts, HTML report |
| 병목 위치 추적 | 상대적으로 약함 | 실험적으로 추적 시도 |
| 실제 사용 흐름 재현 | 간접적 | 제한된 조건에서 직접 시도 |

위 표는 성능 우열 비교라기보다, RawStep이 어떤 방향의 실험을 하고 있는지 설명하기 위한 단순화된 그림에 가깝습니다.

## 이런 경우에 더 적합합니다

- 접근성 과업을 에이전트로 실험해보고 싶을 때
- 성공보다 실패 trace와 병목 지점을 보고 싶을 때
- prompt, observer, verifier, report 구조를 탐색하고 싶을 때
- 내부 아이디어 검증용 하네스가 필요할 때

## 이런 용도로는 아직 적합하지 않습니다

- 실제 서비스의 접근성 pass/fail 판정
- 사람 테스트를 대체하는 자동화 도구
- 안정적인 회귀 테스트 인프라
- 재현성이 높은 운영용 진단 도구

## 무엇이 남는가

실행 결과는 보통 아래 파일들로 남습니다.

- `trace.jsonl`: step별 리플레이 로그
- `trace.json`: 최종 합본 trace
- `metrics.json`: 총 step 수, 종료 이유, action count, timing
- `prompts.json`: step별 prompt 기록
- `report/index.html`: 사람이 보기 좋은 리포트
- `diagnostics.jsonl`: 런타임 경고/에러가 있을 때만 생성

이 산출물은 최종 판정서라기보다, 실험 과정과 실패 지점을 다시 보기 위한 기록에 가깝습니다.

## 빠른 시작

```bash
pnpm install
cp .env.sample .env
# .env 에서 AI_PROVIDER, AI_API_KEY, AI_MODEL 값을 채운다
# openai-compatible provider면 AI_BASE_URL도 함께 채운다
pnpm rawstep run examples/tasks/simple-cta.json
```

기본 출력 경로는 `./.rawstep/out/<mode>/<taskId>/<runId>/` 입니다.  
실행이 끝나면 CLI가 `report/index.html` 경로를 출력합니다.

이 repo에는 바로 실행 가능한 기본 [rawstep.config.ts](./rawstep.config.ts)가 이미 들어 있습니다.  
처음에는 설정 파일을 새로 만들기보다 `.env`만 채우고 `examples/tasks/` 아래 예시 task부터 실행하면 됩니다.

이 예시는 기능을 간단히 확인해보는 용도입니다.  
실행이 된다고 해서 실제 사이트 과업을 안정적으로 수행한다고 보기는 어렵습니다.

## 실행 모델

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

## Task 예시

task 파일은 어느 페이지에서 무엇을 해야 하는지를 적는 실행 단위입니다.

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

자세한 스펙은 [docs/task.ko.md](./docs/task.ko.md)를 보면 됩니다.

## 리포트에서 볼 수 있는 것

리포트에는 보통 아래 정보가 정리됩니다.

- 최종 성공/실패
- failure point
- action breakdown
- timing overview
- step detail
- screenreader announcement 근거
- experience summary
- planning / reflection 결과

리포트 구조는 [docs/report.ko.md](./docs/report.ko.md)에서 자세히 볼 수 있습니다.

### 리포트 예시

![RawStep report overview](./docs/assets/report-overview.png)

## 세부 문서

- [docs/task.ko.md](./docs/task.ko.md): task 스펙, `input`, `verify`, override 규칙
- [docs/config.ko.md](./docs/config.ko.md): `rawstep.config.ts`, defaults, modes, planning, observe, 우선순위
- [docs/cli.ko.md](./docs/cli.ko.md): CLI 옵션, provider 환경 변수, 허용 키/action 목록
- [docs/report.ko.md](./docs/report.ko.md): 리포트 구조와 각 항목 설명
- [docs/prompts.ko.md](./docs/prompts.ko.md): 프롬프트 파일 구조와 템플릿 변수 설명
- [docs/editing-map.ko.md](./docs/editing-map.ko.md): 수정 포인트와 변경 후 확인 항목

## 현재 한계

- 이 프로젝트는 아직 프로토타입 단계입니다.
- 실제 과업 수행 성공률이 낮고, 같은 task도 실행마다 결과 차이가 큽니다.
- 에이전트는 제한된 관측 채널만 받기 때문에 실제 사용자처럼 모든 문맥을 알 수는 없습니다.
- `screenreader` 모드는 backend 품질과 환경 상태에 크게 영향을 받습니다.
- `screenreader + guidepup-voiceover` 조합에서는 `typeText` 후 synthetic announcement가 쓰일 수 있습니다.
- 자유로운 텍스트 생성 입력은 허용하지 않고, task가 제공한 값만 입력합니다.
- 결과를 실제 접근성 품질의 확정 판정으로 사용하기에는 아직 불안정합니다.

## 라이선스

이 프로젝트는 MIT License로 공개됩니다.  
전체 문구는 [LICENSE](./LICENSE) 파일을 보면 됩니다.
