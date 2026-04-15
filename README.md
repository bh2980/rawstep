# RawStep

> 과업 기반 접근성 진단 도구

RawStep은 정적 규칙 검사만으로는 잘 드러나지 않는 접근성 문제를, 실제 과업 수행 흐름 기준으로 확인하려는 도구입니다.
핵심 질문은 "규칙을 어겼는가?"보다 "이 사용자가 이 일을 끝낼 수 있는가?"입니다.

## 왜 이 프로젝트가 필요한가

axe-core, Lighthouse 같은 도구는 DOM을 스캔해서 규칙 위반을 찾는 데 강합니다.
하지만 실제 사용자가 과업을 수행할 때 어디서 막히는지는 따로 드러나지 않는 경우가 많습니다.

- 키보드만 쓰는 사용자가 실제로 원하는 버튼까지 갈 수 있는가
- 가기까지 입력이 몇 번 필요한가
- 스크린리더 사용자가 변화가 일어났다는 사실을 이해할 수 있는가
- 성공은 하더라도 어디에서 많이 헤매는가

RawStep은 제한된 관측과 제한된 행동만으로 과업을 실제로 시도하고, 그 전체 trace와 실패 지점을 남깁니다.

| 항목 | axe / Lighthouse / Pa11y | RawStep |
|------|---------------------------|---------|
| 평가 단위 | 규칙 위반 | 과업 완수 |
| 입력 | DOM / ARIA | 픽셀 또는 발화 텍스트 |
| 출력 | 규칙별 통과/실패 | trace, 입력 비용, 실패 지점 |
| 실사용 흐름 확인 | 약함 | 강함 |

## 빠른 시작

```bash
pnpm install
pnpm build
cp .env.sample .env
# .env 에서 AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_BASE_URL 값을 채운다
pnpm rawstep run examples/tasks/simple-cta.json
open ./.rawstep/out/keyboard/report/index.html
```

이 저장소에는 바로 실행 가능한 [rawstep.config.ts](./rawstep.config.ts)가 이미 들어 있습니다.
처음에는 config를 새로 만들기보다 `.env`만 채우고 예시 task를 실행하는 쪽이 가장 빠릅니다.

screenreader 모드에서 `guidepup-voiceover`, `guidepup-nvda`를 쓰면 실제 OS 스크린리더를 사용하므로 접근성 권한과 headed 브라우저가 필요할 수 있습니다.

## 핵심 개념

### 사용자 모델

- `keyboard`: 화면은 보지만 키보드만 쓰는 사용자입니다. screenshot을 보고 `Tab`, `Enter` 같은 제한된 키만 사용합니다.
- `screenreader`: 스크린리더 사용자입니다. screenshot이나 DOM 대신 announcement 텍스트를 보고 `sr.*` action만 사용합니다.

### 의도적으로 주지 않는 정보

에이전트에게 아래 정보는 일부러 주지 않습니다.

- DOM 셀렉터
- accessibility tree
- `document.activeElement`
- 요소 존재 여부를 바로 알 수 있는 내부 정보

이렇게 해야 "정답을 이미 아는 검사기"가 아니라, 제한된 조건에서 실제로 시도하는 사용자 모델에 더 가까워집니다.

## 최소 task 예시

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

task 파일은 "어느 페이지에서 무엇을 해야 하는지"를 적는 문서입니다.
자세한 task 형식은 [docs/task.md](./docs/task.md)에서 봅니다.

## 문서 안내

- [docs/task.md](./docs/task.md): task 스펙, `input`, `verify`, override 규칙
- [docs/config.md](./docs/config.md): `rawstep.config.ts`, defaults, modes, observe, 우선순위
- [docs/cli.md](./docs/cli.md): CLI 옵션, provider 환경 변수, 허용 키/action 목록
- [docs/contributing.md](./docs/contributing.md): 수정 포인트, generated 파일 주의사항

추가 참고:

- 리포트 형식과 프롬프트 편집 내용은 아직 이 README에 없고, 다음 단계에서 별도 문서로 분리할 수 있습니다.

## 한계

- 이 도구는 실제 사용자를 완전히 대체하지 않습니다. 결과는 "과업 수행 가능성과 병목을 빠르게 보는 신호"로 해석해야 합니다.
- LLM 기반이라 같은 환경에서도 실행 결과가 달라질 수 있습니다.
- 성공 판정은 agent가 관측한 결과와 `verify` 규칙에 의존합니다.
- screenreader 모드는 Guidepup 기반이라 일부 발화가 누락되거나 불완전하게 잡힐 수 있습니다.
- `screenreader + guidepup-voiceover` 조합에서는 `typeText` 단계에 synthetic announcement가 쓰일 수 있습니다.
- `keyboard` 모드는 screenshot 이미지를 모델에 보내므로, 사용하는 provider/model이 이미지 입력을 지원해야 합니다.
- 자유로운 텍스트 입력은 지원하지 않습니다. task가 제공한 `input` 값만 제한적으로 넣을 수 있습니다.
