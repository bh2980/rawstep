# FIXTURES

> v1의 통과 판정은 **외부 사이트가 아니라 이 4개의 로컬 HTML**로 한다.
> fixture가 의도한 대로 반응하지 않으면 그것이 버그이고, 리포트 내용 자체는 그다음 문제다.

위치: `fixtures/*.html`, `examples/tasks/*.json`

---

## F-01 — `simple-cta.html`

**목적**: 성공 경로(happy path)가 정상 동작하는지 확인.

**페이지 내용**
- `<h1>Welcome</h1>`
- `<a href="#about">About</a>` (첫 번째 tabbable)
- `<button id="cta">Get started</button>` (두 번째 tabbable, 명확한 focus ring)
- 버튼 클릭 시 `<p id="result">Started!</p>` 노출

**Task goal**
> "Get started 버튼을 찾아서 활성화하고, 결과 메시지가 보이는 상태로 만들어라."

**기대 결과**
- `result: "success"`
- `actionCounts.rawKeyCount` ≤ 10 (Tab × 2 + Enter 가 최소)
- `endedBy: "success"`

**왜 이 fixture가 있는가**: 전체 파이프라인이 살아있는지 매 커밋마다 확인하는 카나리. 실패하면 구현이 깨진 것.

---

## F-02 — `modal.html`

**목적**: focus trap, Escape 복귀 같은 복합 상호작용에서 agent가 길을 잃지 않는지 확인.

**페이지 내용**
- `<button id="open">Open dialog</button>` (첫 tabbable)
- 버튼 클릭 시 `<dialog>` open
- dialog 내부에 `<button id="confirm">Confirm</button>`, `<button id="cancel">Cancel</button>`
- Escape 시 dialog close, focus가 `#open` 으로 복귀

**Task goal**
> "Dialog를 열었다가 Confirm 없이 닫아라. 페이지가 처음 상태로 돌아간 것이 보여야 한다."

**기대 결과**
- `result: "success"`
- step 수: Tab → Enter(open) → Escape(close) 최소. trace에 이 순서가 관찰되면 성공.
- `endedBy: "success"`

**왜 이 fixture가 있는가**: focus 복귀와 상태 전환을 screenshot 차이만으로 판단할 수 있는지 검증. 여기서 성공이 나지 않으면 focus 상태 표현이 부족하다는 신호.

---

## F-03 — `bad-focus.html`

**목적**: focus indicator 결함을 탐지하는 "의도된 실패" 케이스. v1의 측정 대상 바로 그것.

**페이지 내용**
- `<a href="#s1">Section 1</a>`
- `<a href="#s2">Section 2</a>`
- `<button id="cta">Buy now</button>`
- 전역 CSS: `*:focus { outline: none; }` — focus indicator 완전 제거
- CTA 클릭 시 `/thanks` 등가의 상태 전환

**Task goal**
> "Buy now 버튼을 찾아서 활성화하라."

**기대 결과** (둘 중 하나여야 한다)
- `result: "failure"`, `endedBy: "stuck"` — agent가 "포커스 위치를 못 찾겠다"고 선언
- `result: "failure"`, `endedBy: "maxSteps"` — agent가 무한 Tab을 돌다 소진

**왜 이 fixture가 있는가**: 만약 여기서 `result: "success"` 가 나온다면, 둘 중 하나다.
1. agent가 DOM이나 activeElement를 어떻게든 보고 있다 → 치팅 발생, 즉시 버그 리포트
2. focus indicator 부재가 우연히 문제가 안 됐다 (drop-through 성공) → goal 난이도를 올려서 재현 가능하게 만든다

이 fixture의 통과/실패 자체가 프로젝트 존재 의의를 증명한다.

---

## F-04 — `email-login.html`

**목적**: named input이 실제 fixture에서 end-to-end로 동작하는지 확인.

**페이지 내용**
- 상단 보조 링크 2개
- `<input type="email">` 1개
- 선택형 checkbox 1개
- `Send magic link` 버튼 1개
- 유효한 이메일이 입력되면 버튼 활성화
- 제출 성공 시 live status와 성공 섹션 노출, title 변경

**Task goal**
> "이메일 입력칸에 email input 값을 넣고, Send magic link 버튼을 눌러 성공 메시지가 보이게 만들어라."

**기대 결과**
- `result: "success"`
- `actionCounts.typeTextCount` ≥ 1
- `endedBy: "success"`

**왜 이 fixture가 있는가**: 지금까지 fixture 예제는 주로 이동과 활성화만 다뤘다. 이 fixture는 고정 문자열 입력, 버튼 활성화, 제출 후 성공 상태 전환을 한 번에 검증한다.

---

## 공통 규약

- 모든 fixture는 **외부 네트워크 호출 없음**. 이미지, 폰트, 스크립트 전부 인라인 또는 동일 디렉터리.
- 모든 fixture는 **1280x800 viewport**에서 한 화면에 들어가야 한다 (스크롤 힌트 로직 테스트는 F-02 확장 케이스로 v3+).
- 각 fixture에는 대응되는 `examples/tasks/{id}.json` 가 존재해야 한다.
- fixture 편집 시 이 문서의 "기대 결과"를 함께 갱신한다. 기대 결과가 문서 없이 바뀌면 회귀를 놓친다.
