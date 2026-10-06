# Rawstep — Design Language & Screen Direction

UI 디렉터가 정리한 대시보드 디자인 언어와 화면 방향입니다. 대시보드 UI를 바꿀 때 이 문서를 기준으로 삼습니다.

## 1. Product Definition

Rawstep은 테스트 결과 대시보드가 아니다.
키보드·스크린리더 사용자가 목표까지 이동한 경로를 기록하고, 사람이 병목의 근거를 조사할 수 있게 만드는 행동 추적 도구다.
Rawstep이 보여 주어야 하는 것은 결론이 아니라 흔적이다.

```
Goal
 ↓
Perception
 ↓
Action
 ↓
Page response
 ↓
Next action
 ↓
…
 ↓
Outcome
```

따라서 제품의 핵심 질문은 "통과했는가?"가 아니라, "어디에서 경로가 길어졌고, 그때 페이지와 모델에 각각 무슨 일이 있었는가?"다.

## 2. Design Concept

**RAW TRACE — Trace Analysis Instrument**

Rawstep의 디자인은 일반적인 SaaS Dashboard보다 다음 세 가지에서 가져온다: 실행 추적기, 진단 장비, 조사 기록지. 단, 실제 비행기 계기판이나 오실로스코프를 흉내 내지는 않는다. 그들이 정보를 다루는 방식을 가져온다.

핵심 문장: **판정하지 않고, 경로를 남긴다.**

시각 언어의 핵심은 세 단어다.

- **TRACE** — 무엇이 어떤 순서로 일어났는가.
- **EVIDENCE** — 그 판단을 뒷받침하는 실제 화면·발화·행동·변화는 무엇인가.
- **SOURCE** — 그 현상이 페이지에서 관찰된 것인지, 모델의 판단 과정에서 생긴 것인지.

## 3. Design Principles

### 3.1. Outcome보다 Path

목표 도달 여부는 중요한 정보지만 화면의 주인공이 되어서는 안 된다. `PASS` / `FAIL`처럼 크게 표시하는 테스트 러너 UI를 피한다. 대신 다음을 보여 주고, 바로 아래에서 어떤 요소에서 경로가 늘어났는지 읽을 수 있게 한다.

```
목표 도달     2 / 3
보통 행동 수  12
가장 빠름     10
```

### 3.2. Evidence before Interpretation

Rawstep은 `사실 → 근거 → 사람의 판단` 순서를 지킨다. AI가 "이 버튼은 접근성 문제가 있습니다."라고 결론 내리는 인터페이스를 만들지 않는다. 대신 판단 재료를 제공한다.

```
버튼 · 결제하기

3번 중 2번
키보드 포커스가 페이지 밖으로 이동했습니다.

실행 #12 · 행동 7
실행 #14 · 행동 9
```

### 3.3. Element is the Unit

분석의 최소 단위는 내부 이벤트나 힌트 타입이 아니라 사용자가 만나는 페이지 요소다. 역할과 accessible name을 하나의 `Element Identity`로 취급한다. 같은 요소에 관련된 여러 실행과 여러 현상은 가능한 한 함께 묶는다.

```
BUTTON
결제하기

DIALOG
배송지 변경

STATUS
결제가 완료되었습니다
```

## 4. 가장 중요한 위계

화면의 정보는 항상 다음 순서로 강도가 낮아진다.

1. 목표와 현재 맥락
2. 관찰된 사실
3. 페이지에서 관찰된 현상
4. 모델 행동 / 불확실성
5. 원본 기록

특히 페이지 현상과 모델 행동을 같은 카드 스타일로 만들지 않는다. 이 둘은 단순히 `solid border / dashed border` 수준보다 더 크게 분리한다.

## 5. Page Evidence vs Model Behavior

**Page Evidence** — 페이지에서 실제로 관찰된 현상. 시각적으로 단단한 영역으로 표현한다.

```
PAGE

BUTTON
결제하기

키보드 포커스가 페이지 밖으로 이동했습니다.

2 / 3 executions
#12   #14
```

특징: solid border, 명확한 왼쪽 rail, element identity 강조, 실행 증거 바로 연결, 높은 visual weight.

**Model Behavior** — 모델 자체가 망설이거나 돌아간 현상. 별도의 보조 layer로 다룬다.

```
MODEL BEHAVIOR

BUTTON
결제하기

이 요소와 다른 버튼 사이를 반복해서 이동했습니다.

실행 2회
추정
```

특징: surface를 만들지 않거나 아주 약하게 사용, open marker, inset layout, `모델 행동` source label 항상 표시, 추정이면 `추정`을 텍스트로 명시.

핵심: 페이지 증거는 "무슨 일이 있었다"고 보여 주고, 모델 행동은 "이 실행에서 이렇게 움직였다"고 보여 준다. 모델 행동을 페이지 결함처럼 보이게 해서는 안 된다.

## 6. Visual Character

기존의 "검은 개발자 도구 + 초록색" 이미지에서는 벗어난다. Rawstep은 코드 작성 도구가 아니라 관찰 도구다. 따라서 기본 테마는 Light를 권장한다.

## 7. Color Language

Neutral

```
Canvas         #F6F7F5
Surface        #FFFFFF
Raised         #F0F2EF
Ink            #202421
Ink Secondary  #5F6661
Border         #D8DDD9
Border Strong  #B9C0BA
```

Semantic

```
Trace Blue       실행 / 현재 위치 / focus
Reach Green      목표 도달
Inspect Amber    살펴볼 지점
Not-Reached      목표에 닿지 못함
Model Violet     모델 행동 / 모델 관련 정보
```

색상은 상태를 강화할 뿐 상태 자체가 아니다. 항상 label, shape, line style, icon 또는 marker 중 하나 이상과 같이 사용한다.

## 8. Dark Theme

Dark theme도 제공한다. 하지만 기본 방향은 **Light = analysis desk, Dark = analysis room**이다. Dark theme를 IDE처럼 만들지 않는다. Pure black을 피하고 graphite / deep gray-green 계열을 사용한다. syntax highlighting처럼 많은 색을 사용하지 않는다.

## 9. Typography

UI / Body는 Geist, raw technical value는 Geist Mono. Mono 대상: URL, key, action, selector, model id, timestamp, raw event. 화면 전체를 monospace로 만들지 않는다.

```
STEP 017
00:21.482

ACTION
Tab

FOCUS
button "결제하기"
```

## 10. Shape

shadcn/ui 특유의 둥근 카드 느낌은 줄인다. Panel/Input radius 4–6px, small control 4px, pill 최소화, shadow 거의 없음, border 적극 사용. 여러 개의 floating card보다 하나의 분석 surface를 선으로 나눈 화면에 가까워야 한다.

## 11. Density

높은 정보 밀도가 맞다. 다만 모든 화면을 같은 밀도로 만들지 않는다.

- **Scan Density** (작업 목록 / 실행 기록): row 36–40px, text 13–14px, 작은 gap. 빠르게 비교하는 공간.
- **Read Density** (설정 / 새 작업): body 14px, section gap 24–32px. 설명을 읽으면서 입력하는 공간.
- **Focus Density** (실행 상세): 선택한 단계 하나를 넓게 보여 주고 주변 정보는 최소화. 전체적으로는 dense하지만, 현재 조사하는 대상 주변에는 여백을 준다.

## 12. Core Components

shadcn component를 그대로 제품 언어로 사용하지 않고, Rawstep만의 semantic component를 만든다.

- **Element Identity** — `BUTTON / 결제하기`, `DIALOG / 배송지 변경`.
- **Fact Line** — `목표 도달 2 / 3 · 보통 행동 12번 · 가장 빠름 10번`. KPI card로 만들지 않는 한 줄의 compact한 사실 영역.
- **Evidence Row** — `BUTTON 결제하기 / 포커스가 페이지 밖으로 이동했습니다. / 2 / 3  실행 보기 →`.
- **Run Strip** — 최근 실행을 작은 glyph sequence로: `■ ■ □ ■ △ ■ ■ □ ■ ■`. filled = 목표 도달, striped = 목표 못 닿음, hollow = 판단 불가. 색은 보조 정보.
- **Trace Rail** — 한 실행의 행동 순서 `○──●──○──◉──○──○──●`. Rawstep의 대표 component.
- **Evidence Link** — `실행 #14 · 행동 9 →`. Evidence를 보면 반드시 원본까지 내려갈 수 있어야 한다.

## 13. HOME

처음 사용자는 "지금 뭘 해야 하는가?", 기존 사용자는 "최근 어떤 실행이 있었는가?"를 알고 싶다. 두 상태를 분리한다.

- **First-use Home**: 큰 hero 없이 Setup Rail. 현재 해야 할 단계만 시각적으로 강조하고, 각 항목 아래에는 한 문장만 둔다.

```
시작하기

01 ━ 모델 연결             완료
02 ━ 첫 작업 만들기        지금 할 일
03 ┄ 첫 실행 보기
```

- **Returning Home**: 첫 실행 이후 Setup Rail은 작게 접힌다. 중심은 최근 작업 3개(카드보다 compact row), 최근 실행 표, 실행 중인 작업(있으면 최상단). 홈에서 분석 결과를 요약해서 판단해 주지는 않는다.

## 14. TASK LIST

Test Inventory가 아니라 Route Index다. 가장 높은 Scan Density.

```
작업               목표 도달     행동       최근 실행     페이지 현상
Checkout           7 / 10        12 / 8     ■■□■■■□■■■   2
Search             10 / 10        7 / 6     ■■■■■■■■■■   0
```

- 작업: 이름 + URL(mono, secondary).
- 목표 도달: 큰 progress bar보다 `7 / 10` + 작은 선.
- 행동 수: `12 / 8` (median / fastest), header에서 의미를 설명.
- 최근 10번: 높이가 다른 chart보다 Run Strip.
- 페이지 현상: 문장 전체를 넣지 않고 `2곳` 또는 `2곳 / BUTTON 결제하기`. 상세는 작업 화면에서 본다.

## 15. TASK

가장 중요한 overview screen. 화면 전체를 하나의 Task Investigation Sheet로 본다.

- Header 왼쪽: 작업 이름, URL, 목표 문장, `완료 확인 2개 · 기본 키보드`.
- Header 오른쪽: Run Control (MODEL, MODE, REPEAT, 실행). 카드처럼 떠 있지 않고 header 내부에서 명확하게 구획한다.

## 16. TASK / Overview

첫 줄: `목표 도달 2 / 3 · 보통 행동 12번 · 가장 빠름 10번 (#4)`. 그 아래가 핵심인 PAGE EVIDENCE. 카드 여러 개보다 **Evidence Ledger** 형태: 한 요소 = 하나의 기록 항목, 요소가 중심이고 그 밑에 사실이 붙는다.

```
페이지에서 관찰된 현상                           2

BUTTON
결제하기
키보드 포커스가 페이지 밖으로 이동했습니다.
3번 중 2번                             실행 보기 →
──────────────────────────────────────────────────
DIALOG
배송지 변경
열린 뒤 포커스가 대화상자 안으로 이동하지 않았습니다.
3번 중 1번                             실행 보기 →
```

## 17. MODEL BEHAVIOR

Page Evidence보다 한 단계 아래에 둔다. 영역 전체의 grammar가 달라야 한다: Page `■ solid marker`, Model `○ open marker`, Model 쪽 section background는 약하게.

```
모델이 헤맨 지점

이 항목은 페이지 문제라고 단정할 수 없습니다.
실행 중 모델이 반복하거나 확신이 낮았던 위치입니다.

○ BUTTON · 할인 적용
  같은 두 요소 사이를 4번 이동했습니다.
  실행 #12
  추정
```

## 18. 실행 기록 Collapsible

기본적으로 접힌다. 열면 실행별 행동 수 가로 막대(여기서는 bar chart가 유효 — 비교 대상이 명확한 양적 값)와 실행 표.

## 19. TASK / Completion Check

"설정 폼"처럼 보이지 않게 한다. 컨셉은 **Goal Boundary**: "어디까지 도달하면 이 작업을 끝냈다고 볼 것인가?"

- Current Boundary를 맨 위에 자연어로 먼저 보여 준다: `이 작업은 아래 조건이 모두 맞으면 목표에 닿은 것으로 봅니다. ✓ 주소에 /checkout이 포함됨 ✓ "결제 정보" 문구가 화면에 나타남`.
- 그 아래 Rule Editor: `무엇을 확인할까요?` 라디오(화면에 문구가 보임, 주소가 바뀜, 안내 문구가 읽힘, 요소가 나타남 / 사라짐 …). 기술적인 내부 rule 이름을 먼저 보여주지 않는다.

## 20. AI Suggestions

chat UI로 만들지 않는다. 명칭은 `AI 제안`. 각 suggestion을 candidate rule로: `제안 01 / 주소가 /checkout으로 바뀌는지 확인 / [ 추가 ]`. 검증 코드는 `ADVANCED CHECK · Generated code`로 명확히 분리하고, "코드를 읽었고 실행되는 내용을 이해했습니다." 확인 전에는 활성화하지 않는다. 위험하거나 고급인 기능의 시각적 무게도 높인다.

## 21. NEW TASK

1100px 이상에서 왼쪽 Task Specification(URL, Goal, Completion check), 오른쪽 Completion ideas. 오른쪽 AI 영역은 assistant chat이 아니라 왼쪽 문서를 보조하는 reference panel.

## 22. RUN DETAIL

대표 화면. Concept: **Trace Inspector**. 원칙: 한 순간에 하나의 행동만 조사한다.

## 23. Run Header

```
실행 #14
목표에 닿음
Keyboard · Jev · 기본 프로필
행동 10번 · 4.4초 · 가장 빠른 실행
```

`목표에 닿음`을 거대한 green banner로 만들지 않는다. 실행 결과는 context이지 화면 목적이 아니다.

## 24. Trace Overview

100 step까지 고려해 두 단계 구조.

- **Overview Rail**: 전체 실행을 항상 한눈에. 4~6px 정도의 작은 tick으로 100개까지. 현재 viewport 범위를 outline으로 표시(코드 에디터 minimap과 비슷한 역할). 클릭하면 해당 위치로 jump.
- **Detail Rail**: 현재 위치 주변 10~20개 행동만 크게. 키보드 좌우 방향키는 전체 step을 그대로 이동한다.

## 25. Timeline Semantics

```
·        이동
●        실행 / activate
◌        모델 확신 낮음
◎ amber  살펴볼 지점
┄        아직 실행되지 않음
▣ blue   현재 보고 있는 행동
```

선택 상태와 실행 성공 상태를 같은 green으로 표현하지 않는다. 현재 선택은 trace blue, green은 goal reached에 남긴다.

## 26. Selected Step

다음 순서로 재편한다.

1. **무엇을 보고 있었나** — Keyboard: Screenshot / Screen reader: Speech transcript. 모드에 따라 primary evidence를 바꾼다.
2. **무엇을 했나** — 가장 큰 technical text (`ACTION 07 / Tab`).
3. **무엇이 바뀌었나** — `PAGE RESPONSE / Focus → button "상품 4"`. Action → Response가 Rawstep trace의 기본 단위다.
4. **살펴볼 지점** — 있는 경우에만 amber.
5. **Model detail** — 접힘 (`모델이 본 선택지`).
6. **Raw record** — 가장 아래, 접힘.

## 27. Screenshot

일반 이미지 카드가 아니라 Evidence viewport다. 주변 UI보다 높은 우선순위. Keyboard mode에서는 focus target을 명확히 표시한다. 가능하면 `Before | After` 토글. 두 screenshot을 항상 나란히 보여 주지는 않는다.

## 28. Screen Reader Mode

스크린리더 실행에서는 speech가 주 증거다. `SCREEN READER OUTPUT` 영역에 읽은 문장을 보여 주고 screenshot은 secondary evidence. Keyboard mode와 동일한 화면 배치를 강제하지 않는다.

## 29. Decision Candidate Scores

분석의 보조 정보. 기본적으로 접힌 상태. 열면 `MODEL CANDIDATES`와 막대 + 점수, 반드시 "모델 점수 · 확률로 보정된 값이 아님"을 표시. `43%`처럼 확률로 오해할 표현보다는 raw score 표현도 고려한다.

## 30. LIVE RUN

중요한 것은 "진행률"이 아니라 "살아 있고 무엇을 하고 있는가"다. progress bar는 사용하지 않는다(최대 20 중 7이 35% 완료라는 뜻이 아니므로).

```
● 실행 중
행동 7
00:42
최대 행동 20

현재
Tab → button "배송지 변경"
```

Trace Rail은 행동이 발생할 때마다 하나씩 늘어난다. 최신 단계에는 작은 active cursor만. 과도한 pulse animation은 쓰지 않는다.

## 31. RUN HISTORY

순수하게 log index. 가장 높은 정보 밀도. 열: 시간, 작업, 모델, 모드, 결과, 행동, 시간. 필터는 위쪽 한 줄(Search / task / model / outcome). 큰 filter cards는 사용하지 않는다.

## 32. SETTINGS

Dashboard 안의 또 다른 card collection으로 만들지 않는다. 전체 페이지 + sub navigation(Models, Run profiles, This computer). 각 화면을 Configuration Sheet로 디자인한다.

## 33. SETTINGS / Models

목록 열: NAME, KIND, PROVIDER, STATUS. `+ 모델 추가` wizard: 1. 종류 2. 제공자 3. 모델 4. 연결 확인. 종류를 plain language로 설명한다 (LLM: 상황을 읽고 다음 행동을 직접 선택합니다. / Decision model: 주어진 행동 후보에 점수를 매기고 하나를 고릅니다.).

## 34. SETTINGS / Run Profiles

Profile을 "설정 묶음"보다 실험 조건으로 이해할 수 있게 한다.

```
기본 키보드
Allowed actions    Keyboard only
Blocked detection  5 repeated actions
Viewport           1440 × 900
Analysis           Default
```

Allowed actions는 카드 세 개보다 큰 radio row가 더 compact하다.

## 35. SETTINGS / This Computer

단순 path input보다 환경 상태가 먼저 보여야 한다 (Browser: Chrome 129 Ready / Screen reader driver: AT Driver Ready / Browser window: 1440 × 900 Open). 아래에서 실제 경로와 실행 방식을 편집한다. Deterministic한 환경 확인은 적극적으로 보여줘도 된다.

## 36. Empty States

illustration을 넣지 않는다. 항상 "무엇이 없는가 / 왜 필요한가 / 다음 행동" 세 가지로 구성한다. (예: 등록된 모델이 없습니다 / 작업을 실행하려면 행동을 선택할 모델이 필요합니다. / [모델 연결])

## 37. Error States

모든 오류를 같은 빨간 alert로 처리하지 않는다. 최소 Setup error, Start failure, Runtime failure, Data failure, Connection loss를 구분한다. 각 오류에는 무슨 일이 있었나, 무엇까지 실행됐나, 사용자가 할 수 있는 다음 행동, 원본 오류 보기를 제공한다. Provider의 민감한 원문은 그대로 노출하지 않는다.

## 38. Onboarding

말풍선 튜토리얼을 전체 UI에 순서대로 붙이는 방식은 최소화한다. 개념 설명은 사용 시점에 한다 (처음 `실행 프로필`, `완료 확인`을 만났을 때 한 문장). 말풍선 walkthrough는 보조 수단이다.

## 39. Responsive

Desktop — Run Detail: Evidence View 3fr │ Analysis 2fr. Task: Task context │ Run controls.
Tablet / Mobile — 단순히 column을 아래로 쌓는 것에서 끝내지 않는다. Run Detail에서는 Trace → 현재 행동 → Evidence → Page response → Inspection 순서를 유지하고, 작은 sticky control(`← 이전  17 / 43  다음 →`)을 둘 수 있다.

## 40. Accessibility

Rawstep의 자체 접근성은 제품 신뢰도의 일부다. **Every visualization has a navigable textual equivalent.** Trace rail → 방향키 탐색 + step label, Run strip → 각 실행에 accessible name, 행동 수 chart → 동일 숫자를 text로, Model score bar → score text, 색상 → shape + text 병행.

## 41. Motion Language

motion은 실제 state 변화만 표현한다. 사용: 새 trace step 등장, panel reveal, selection 이동, screenshot transition, connection highlight. 피함: card lift, bounce, confetti, 성공 celebration, decorative gradient animation, constant pulsing. 목표 도달도 축하 이벤트가 아니다.

## 42. Product Voice

판단하지 않으므로 문체도 중립적이어야 한다.

- "문제가 발견되었습니다." 대신 "이 요소에서 포커스가 페이지 밖으로 이동했습니다."
- "모델이 혼란스러워했습니다." 대신 "같은 두 요소 사이를 4번 이동했습니다."
- "접근성이 좋지 않습니다." 대신 "3번의 실행 중 2번에서 목표에 닿지 못했습니다."

## 43. 화면별 Visual Strength

| 화면 | 강하게 | 중간 | 약하게 |
| --- | --- | --- | --- |
| Home | Onboarding | Density | Trace, Evidence |
| Task List | Scan density, Runs | Evidence | Trace |
| Task | Evidence, Element identity, Attribution | Trace | |
| Run Detail | Trace, Evidence, Current action | | Raw data |
| New Task | Clarity, Guidance | | Technical detail |
| Run History | Density, Chronology | | Decoration (minimal) |
| Settings | Structure | Explanation, Status | Decoration (minimal) |

## 44. 무엇을 하지 않을 것인가

Generic shadcn Dashboard(모든 내용을 `rounded-lg border p-4` 카드로), Testing CI Dashboard(Pass/Fail 숫자가 주인공), AI Assistant(채팅창과 AI 요약 중심), Accessibility Score Tool(페이지에 점수), IDE, Observability Dashboard(metric chart 나열). Rawstep의 핵심 데이터는 경로와 요소다.

## 45. 가장 먼저 다시 디자인할 세 곳

1. `TaskOverview` — 여러 finding card를 Element Evidence Ledger로.
2. `StepDots` — 단일 horizontal dot row를 Overview Rail + Detail Rail 구조로.
3. `StepDetail` — Evidence → Action → Page Response → Inspect → Model detail → Raw 순서로.

## 46. Core Formula

행동의 경로를 trace로, 관찰된 현상을 evidence로, 페이지와 모델의 원인을 source로 분리해 보여 주는 접근성 진단 인터페이스. 차분한 분석 테이블 위에 실행의 흔적을 펼쳐 놓고, 사용자가 한 단계씩 증거를 조사하는 도구.

가장 중요한 기준: **Rawstep이 답을 말해 주는 것처럼 보여서는 안 된다. 사람이 답을 내릴 수 있을 만큼 좋은 증거를 보여 주는 것처럼 보여야 한다.**
