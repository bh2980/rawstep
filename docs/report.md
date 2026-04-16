# 리포트

한 번의 실행마다 HTML 리포트와 실행 산출물이 `outDir/<taskId>/<runId>/` 아래에 저장됩니다. 여기서 `outDir`는 설정된 출력 루트 디렉터리입니다. 리포트는 성공/실패 결과만 보는 것이 아니라, **어느 step에서 무엇을 보고 어떤 행동을 했는지** 과정을 다시 따라갈 수 있도록 설계되어 있습니다.

---

## 생성되는 산출물

| 항목 | 설명 |
|------|------|
| `trace.jsonl` | step별 사용자용 리플레이 기록 |
| `diagnostics.jsonl` | 내부 런타임 경고/에러 기록. 이벤트가 있을 때만 생성 |
| `trace.json` | 최종 합본 trace |
| `metrics.json` | aggregate 요약 수치 |
| `prompts.json` | step별 system/user prompt와 이미지 개수 |
| Verdict | 과업 달성 / 막힘 / 시간 초과 여부 |
| 단계별 리플레이 | 각 step의 관측, 행동, 이유 |
| 입력 비용 | 전체 키 입력 수, 키 종류별 분포 |
| 타이밍 분해 | setup / 각 step의 observe / decide / execute / verify 시간 |
| 관측 근거 | screenreader step마다 announcement capture 경로, phrase 수, 종료 이유 |
| Experience summary | `overall`, `blockers`, `surprise`, `oneLineFeel` (opt-in) |
| 성공 근거 | agent 선언 성공과 verifier 통과를 따로 표시 |
| 종료 출처 | agent 선언 종료인지 verifier auto-complete 종료인지 구분 |
| 실패 지점 | 실패 시 종료 직전 관측 하이라이트 |

---

## HTML 리포트 구성

**상단 요약 헤더** — task id, goal, mode, URL, 최종 result, 전체 step 수, 총 실행 시간

**summary 카드** — experience summary가 켜져 있으면 `overall`, `blockers`, `surprise`, `oneLineFeel` 표시. 생성 실패 시 에러 문구.

**flow / timeline** — 전체 step 흐름을 막대와 필터로 훑어볼 수 있습니다. `Important`, `Verify Fail`, `Failure Point`, `Verdict` 같은 상태로 step을 좁혀볼 수 있습니다.

**action breakdown** — 어떤 action이 많이 쓰였는지 분포로 표시.

**timing overview** — step별 decide 시간 스파크라인과 각 step의 `observe`, `decide`, `execute`, `verify` 시간. LLM 특성상 동일한 환경에서도 응답 시간이 달라질 수 있으므로, 타이밍 수치는 절대값보다 **step 간 상대적 차이**를 파악하는 참고 자료로 활용하세요.

**step detail panel** — 선택한 step의 observation, action, rationale, verification 결과, timing, 스크린샷.

screenreader 모드에서는 스크린샷이 "관찰 시점"이 아니라 "직전 행동 이후 상태"를 보여주므로, `Initial` 행에는 스크린샷이 없고 마지막 남는 이미지는 별도 `Result` 행에 표시됩니다.

---

## step detail 읽는 법

step 하나를 열면 아래 순서로 읽습니다.

1. **observation** — keyboard 모드면 title, URL path, focus hint, scroll hint. screenreader 모드면 announcement, capture 방식, announcement count, observe reason.
   screenreader 보조 수집 실패는 raw 에러 대신 `DOM Focus: Failed`, `Cursor Screenshot: Unsupported` 같은 상태만 표시됩니다.
2. **decision / action** — 어떤 키나 `sr.*` action을 선택했는지. rationale 저장이 켜져 있으면 선택 이유도 확인 가능.
3. **verification** — verifier가 돌았는지, 통과했는지, 어떤 rule에서 실패했는지.
4. **timing** — 느린 step이 observe 때문인지 decide 때문인지 분리해서 확인.

---

## step status

| status | 설명 |
|--------|------|
| `Success` | agent가 success verdict를 냈고 최종적으로 성공으로 끝난 경우 |
| `Verified` | verifier가 해당 step에서 통과한 경우 |
| `Verify Fail` | verifier가 돌았지만 실패한 경우 |
| `Failure Point` | aggregate가 계산한 대표 실패 지점 |
| `Stuck` | agent가 더 진행할 합리적인 다음 행동이 없다고 판단하고 멈춘 경우 |
| `Error` | 실행 오류가 발생한 경우 |

> `Success`와 `Verified`는 다릅니다. agent가 "된 것 같다"고 선언한 것과 verifier가 실제로 통과시킨 것은 분리해서 봐야 합니다.

---

## screenreader 리포트에서 볼 것

screenreader 실행에서는 아래 값을 함께 확인하는 것이 중요합니다.

| 항목 | 설명 |
|------|------|
| `announcement` | 이번 step에서 모델이 들은 핵심 텍스트 |
| `announcement capture` | 발화를 수집한 경로 |
| `announcement count` | 이번 관찰에서 잡힌 문구 수 |
| `observe reason` | `silence`, `timeout`, `fallback`, `synthetic` 등 관찰 종료 이유 |

- `timeout`이 반복되면 관찰 대기 시간이 짧거나, 실제 발화가 늦거나, backend 상태가 불안정할 수 있습니다.
- `synthetic`이면 실제 발화의 직접 캡처가 아니라 보정된 관측이라는 뜻입니다.
- `fallback`이 보이면 빈 로그를 대신하는 문구가 들어온 것인지 확인해야 합니다.

---

## `prompts.json` 활용

HTML 리포트만으로 부족할 때 `prompts.json`을 봅니다. step별 system prompt, user prompt, 첨부 이미지 수가 기록되어 있습니다.

아래 상황에서 특히 유용합니다.

- prompt를 수정한 뒤 실제로 어떤 텍스트가 모델에 전달됐는지 확인하고 싶을 때
- `availableActions`에 `hint`가 제대로 붙었는지 확인하고 싶을 때
- screenreader에서 announcement 블록이 어떻게 렌더링됐는지 보고 싶을 때

---

## `diagnostics.jsonl` 활용

`trace.jsonl`과 HTML 리포트는 사용자 관점 흐름을 보기 위한 파일입니다. 반대로 `diagnostics.jsonl`은 런타임 내부 경고/에러를 보는 파일입니다.

- `domFocus` 수집 실패 이유
- VoiceOver cursor screenshot 미지원/실패 이유
- raw 에러 문자열이나 stack이 필요한 디버깅

즉, **리플레이는 trace**, **엔진 고장 원인은 diagnostics**로 나눠서 보면 됩니다.

---

## 이상 징후 패턴

타이밍 관련 항목은 LLM 응답 시간의 변동성으로 인해 실행마다 수치가 달라질 수 있습니다. 특정 수치보다 **패턴의 반복 여부**를 기준으로 판단하세요.

| 증상 | 가능한 원인 |
|------|-------------|
| `Verify Fail`이 많다 | agent 판단과 실제 검증 규칙이 자주 어긋나고 있음 |
| `Failure Point`가 같은 action 앞에서 반복된다 | 탐색 전략보다 UI 흐름 자체가 막혀 있을 가능성 |
| action breakdown에서 `Tab` / `sr.next`만 압도적으로 많다 | 목표에 가까워지지 못하고 넓게 헤매고 있을 수 있음 |
| timing에서 `decide`만 유독 길다 | 관측은 충분하지만 판단하기 어려운 화면일 수 있음 |
| timing에서 `observe`만 길다 | screenreader 발화 대기, 페이지 반응 지연, observe 설정 문제 가능성 |
