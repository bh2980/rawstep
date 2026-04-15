# RawStep
> 과업 기반 접근성 진단 도구

## 왜 이 프로젝트가 필요한가

axe-core, Lighthouse와 같은 기존 도구는 DOM을 스캔해 **규칙 위반**을 찾는 데 강합니다.  
하지만 이런 방식만으로는 실제 사용자가 과업을 수행하는 과정에서 겪는 문제를 충분히 드러내기 어렵습니다.

- 키보드만 사용하는 사용자가 실제로 **장바구니 담기** 버튼까지 도달할 수 있는가?
- 도달하기까지 몇 번의 입력이 필요한가?
- 스크린리더 사용자는 Enter를 누른 뒤 어떤 변화가 일어났는지 이해할 수 있는가?
- 사용자는 구체적으로 **어디서** 막히는가?

`RawStep`은 AI를 활용해 제한된 행동 집합과 관측 채널 안에서 **주어진 과업의 수행 과정**을 추적하는 도구입니다.  
정적 규칙 검사만으로는 드러나지 않는 실제 사용 흐름의 병목을 확인하고, 서비스가 제한된 조건에서도 과업을 수행할 수 있는지, 또 수행 가능하더라도 어떤 불편이 발생하는지 진단하는 데 목적이 있습니다.

|                     | axe / Lighthouse / Pa11y | rawstep                         |
|---------------------|--------------------------|---------------------------------|
| 평가 단위           | 규칙 위반                | 과업 완수                       |
| 에이전트 입력       | DOM / ARIA               | 픽셀 또는 음성 텍스트           |
| 출력                | 규칙별 통과/실패         | 전체 trace + 입력 비용 + 실패점 |
| 실사용자 관점       | 간접적                   | 직접적 (실제로 시도)            |
| UX 막다른 길 탐지   | ✗                        | ✓                               |

---

## 빠른 시작

```bash
pnpm install
pnpm build
cp .env.sample .env
# .env 에서 AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_BASE_URL 값을 채운다
pnpm rawstep run examples/tasks/simple-cta.json
open ./.rawstep/out/keyboard/report/index.html
```

이 repo에는 바로 실행 가능한 기본 [rawstep.config.ts](./rawstep.config.ts)가 포함되어 있습니다.
처음에는 `rawstep.config.ts`를 새로 만들기보다 `.env.sample`을 복사해 `.env`만 채우면 됩니다.

> **스크린리더 모드를 사용하는 경우**  
> guidepup-voiceover, guidepup-nvda 등 실제 OS 스크린리더를 사용할 때는 OS별 권한 설정이 필요할 수 있으며,
> 선택한 backend에 따라 headed 브라우저가 필요할 수 있습니다.

---

## 사용자 모델

### `keyboard` — 키보드만 쓰는 시력 있는 사용자

- **관측**: 현재 viewport screenshot + 직전 screenshot 1장
- **행동**: `Tab`, `Shift+Tab`, Arrow keys, `Enter`, `Space`, `Escape`, `Home`, `End` 등 지정된 키값 + task input이 있을 때만 `typeText`

### `screenreader` — 스크린리더 사용자

- **관측**: 스크린리더가 실제로 말한 announcement 텍스트. screenshot, DOM, accessibility tree 없음
- **행동**: 스크린리더 canonical action + `sr.key.*` 기반 이동/조작 + task input이 있을 때만 `typeText`
- 개발자 디버깅용 screenshot은 별도로 저장할 수 있지만 에이전트 입력에는 들어가지 않습니다

### 의도적으로 주지 않는 정보

- `document.activeElement`, ARIA role/label, accessibility tree
- DOM 셀렉터, 요소의 존재 여부
- 정밀 scroll 수치 (keyboard 모드에서 `top/middle/bottom` 수준은 허용)

---

## Task 작성

task 파일은 "어느 페이지에서 무엇을 해야 하는지"를 적는 과업 본문입니다.

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

task 전체 스펙, `input`, `verify`, `config` override는 [docs/task.md](./docs/task.md)에서 확인합니다.

---

## 세부 문서

- [docs/task.md](./docs/task.md): task 스펙, `input`, `verify`, override 규칙
- [docs/config.md](./docs/config.md): `rawstep.config.ts`, defaults, modes, observe, 우선순위
- [docs/cli.md](./docs/cli.md): CLI 옵션, provider 환경 변수, 허용 키/action 목록
- [docs/report.md](./docs/report.md): 리포트 구조와 각 항목 설명
- [docs/prompts.md](./docs/prompts.md): 프롬프트 파일 구조와 템플릿 변수 설명
- [docs/editing-map.md](./docs/editing-map.md): 수정 포인트, 생성 파일 규칙, 변경 후 확인 항목

---

## 한계

**에이전트 특성상 발생하는 한계**

- 에이전트의 판단은 제한된 행동 집합과 관측 채널에 의존하므로, 실제 사용자 행동을 완전히 대체하지는 않습니다. 
- 결과는 과업 수행 가능성과 병목을 파악하기 위한 참고 신호로 해석해야 합니다. 
- LLM 기반 에이전트를 사용하는 특성상 동일한 과업과 환경에서도 실행 결과가 달라질 수 있으며, 성공 여부는 에이전트가 실제로 관측한 결과를 바탕으로 판단합니다.

**스크린리더 모드 관련 한계**

- 스크린리더 모드는 Guidepup을 통해 음성 출력을 수집합니다. 이 과정에서 일부 발화가 캡처되지 않거나 누락될 수 있으므로, 관측 결과가 실제 스크린리더 출력과 완전히 일치하지 않을 수 있습니다. 
- `screenreader + guidepup-voiceover` 조합에서는 `typeText` 단계에 synthetic announcement가 쓰일 수 있습니다.
- 안정적으로 지원되는 sr.* action 범위는 backend마다 다르며, 이는 guidepup의 지원 범위에 직접적으로 의존합니다. 특정 스크린리더 명령이 환경에 따라 동작하지 않을 수 있으므로, 사용 전 guidepup 문서에서 해당 backend의 지원 현황을 확인하는 것을 권장합니다.

**기타 제약**

- `keyboard` 모드는 screenshot 이미지를 함께 전송하므로, 선택한 provider/model이 이미지 입력을 지원해야 합니다. 
- 자유로운 텍스트 입력은 지원하지 않으며, task가 고정 문자열을 제공한 경우에만 제한된 text input action을 허용합니다.
