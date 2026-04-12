# RUNTIME_LOOP

> runner 구현의 **유일한 근거**. 이 문서와 다르게 구현하면 버그다.
> 여기 적힌 루프가 현재 keyboard + screenreader-strict + screenreader-hybrid 공통 실행 모델이다.

---

## 의사코드

```
runTask(task) -> TraceSession:
  trace = TraceRecorder(task)
  browser = createBrowserSession(task.url, headless = (task.mode == "keyboard"))
  screenshotPolicy = options.screenshotPolicy ?? "all"
  verifierAutoComplete = options.verifierAutoComplete ?? false
  agentMemoryWindow = options.agentMemoryWindow ?? 1
  agentMemoryAll = options.agentMemoryAll ?? false
  includeExperienceSummary = options.includeExperienceSummary ?? false
  agentMemory = []
  if task.mode == "keyboard":
    observer = KeyboardObserver(browser.page)
    screenReaderRuntime = null
  else:
    screenReaderRuntime = createVoiceOverRuntime(browser.page)
    observer = screenReaderRuntime.observer
  actuator = Actuator(browser.page, { screenReaderController: screenReaderRuntime?.controller })
  agent = LLMAgent(model, userModel=task.mode)

  deadline = now() + task.timeoutMs
  endedBy = null

  try:
    for step in 0..task.maxSteps:
      if now() >= deadline:
        endedBy = "timeout"; break

      obs = observer.observe()                # §settle 이 먼저 수행됨
      ctx = {
        goal: task.goal,
        allowedKeys: ALLOWED_KEYS if task.mode != "screenreader-strict" else [],
        allowedScreenReaderCommands: SCREENREADER_COMMANDS if task.mode != "keyboard" else undefined,
        memory: selectAgentMemoryExcerpt(agentMemory, agentMemoryAll, agentMemoryWindow),
      }

      decision = await agent.decide(ctx, obs)  # malformed → {verdict:"stuck", ...}
      verdictAnalysis = null

      if decision.verdict == "success" and task.verify:
        verification = verifyTask(task, browser)
        verdictAnalysis = {
          agentVerdict: "success",
          verificationResult: verification.passed ? "passed" : "failed",
          finalResult: verification.passed ? "success" : "continued",
          completionSource: "agent"
        }
        trace.append(step, obs, decision, execution={ok:true, costDelta:0}, verification, verdictAnalysis)
        agentMemory.push(createAgentMemoryEntry(...))
        if verification.passed:
          endedBy = "success"; break
        verificationFailures += 1
        if verificationFailures >= 2:
          endedBy = "stuck"; break
        continue

      if decision.verdict == "success":
        verdictAnalysis = {
          agentVerdict: "success",
          verificationResult: "not-run",
          finalResult: "success",
          completionSource: "agent"
        }
        trace.append(step, obs, decision, execution={ok:true, costDelta:0}, verdictAnalysis)
        agentMemory.push(createAgentMemoryEntry(...))
        endedBy = "success"; break

      if decision.verdict == "stuck":
        verdictAnalysis = {
          agentVerdict: "stuck",
          verificationResult: "not-run",
          finalResult: "failure",
          completionSource: "agent"
        }
        trace.append(step, obs, decision, execution={ok:true, costDelta:0}, verdictAnalysis)
        agentMemory.push(createAgentMemoryEntry(...))
        endedBy = "stuck"; break

      try:
        if decision.action.key and task.mode == "screenreader-strict":
          throw NotAllowedKeyError("Raw key actions are not allowed in screenreader-strict mode.")
        execution = actuator.execute(decision.action, task.input)
        if verifierAutoComplete and task.verify and execution.ok and execution.costDelta > 0:
          verification = verifyTask(task, browser)
          if verification.passed:
            verdictAnalysis = {
              verificationResult: "passed",
              finalResult: "success",
              completionSource: "verifier-auto-complete"
            }
            trace.append(step, obs, decision, execution, verification, verdictAnalysis)
            agentMemory.push(createAgentMemoryEntry(...))
            endedBy = "success"; break
        trace.append(step, obs, decision, execution)
        agentMemory.push(createAgentMemoryEntry(...))
        if !execution.ok:
          continue
      catch NotAllowedKeyError as e:
        trace.append(step, obs, decision, execution={ok:false, error:str(e), costDelta:0})
        agentMemory.push(createAgentMemoryEntry(...))
        endedBy = "error"; break

      settle(browser.page)                    # §settle 규칙

    else:
      endedBy = "maxSteps"

  finally:
    if screenReaderRuntime:
      screenReaderRuntime.close()
    browser.close()
    trace.finalize(endedBy)

  if includeExperienceSummary:
    summary = agent.summarizeExperience(task, trace.aggregate, fullTextMemory=agentMemory)
    trace.session.experienceSummary = summary

  return trace.session
```

---

## §settle 규칙

매 action 이후, 다음 observe() 직전까지 "페이지가 안정화되기를" 기다린다.

```
settle(page):
  await page.waitForLoadState("networkidle", timeout=1000)  # best effort
  await sleep(120ms)                                         # 애니메이션/포커스 링 갱신 여유
```

- 네트워크가 1초 이내에 idle 안 되면 그대로 진행한다 (우리가 테스트하는 건 "사용자 경험이지 완벽한 로드"가 아님).
- 120ms는 focus outline transition이 굳을 정도의 최소 시간. 이 숫자는 `packages/core/src/constants.ts` 의 `SETTLE_MS` 상수로 export.
- DOM 이벤트 대기 금지 (`waitForSelector` 등). 우리는 DOM을 모르는 에이전트를 시뮬레이션한다.

---

## §screenreader observe 규칙

screenreader observe는 단발 읽기가 아니라 **폴링 기반 수집기**로 동작한다.

- `spokenPhraseLog()` 를 짧은 간격으로 폴링한다.
- 새 phrase가 들어오면 버퍼에 누적한다.
- 마지막 새 phrase 이후 `silenceWindowMs` 동안 변화가 없으면 관측을 종료한다.
- 그래도 너무 오래 걸리면 `maxObserveMs` 에서 종료한다.

여기서 "새 phrase" 의 의미는 문자열 diff가 아니라, **이번 poll에서 read-and-clear로
읽힌 log line** 이다. 같은 문장이 나중 poll에 다시 들어오면 다시 센다.

프로파일은 세 가지다.

- `initial` — step 0 첫 발화 확보용. 가장 관대하게 기다린다.
- `default` — 일반 탐색용.
- `interactive` — `srCommand(act)` 직후처럼 상태 변화가 기대되는 step용.

step 0은 `initial` 프로파일을 먼저 쓰고, 첫 결과가 `announcementCapture: "none"`이면
페이지 루트에 다시 포커스를 맞춘 뒤 `initial` 로 한 번 더 재수집한다.

`srCommand(act)` 가 성공적으로 실행된 step의 **다음 observation** 은 `interactive`
프로파일을 사용한다.

screenreader observation trace에는 아래 메타가 함께 저장된다.

- `announcementCapture` — `log` | `fallback` | `none`
- `announcementCount` — 이번 step에서 잡은 phrase line 개수
- `observeReason` — `silence` | `timeout` | `fallback`

의미는 다음처럼 고정한다.

- `announcementCapture` — 무엇으로 발화를 얻었는가
- `observeReason` — 왜 관측을 여기서 닫았는가

즉 fallback 케이스에서는 현재 구현상 둘 다 `fallback` 이 될 수 있지만, 역할은
획득 경로와 종료 이유로 구분해서 읽어야 한다.

---

## §timeout / maxSteps / verdict 규칙

| 상황 | `aggregate.endedBy` | `aggregate.result` | `failurePoint` |
|---|---|---|---|
| agent가 `verdict:"success"` 반환 + verifier 통과 | `"success"` | `"success"` | 없음 |
| verifier auto-complete 옵션 켜짐 + 성공 action 이후 verifier 통과 | `"success"` | `"success"` | 없음 |
| agent가 `verdict:"success"` 반환 + verifier 실패 2회 | `"stuck"` | `"failure"` | 마지막 step |
| agent가 `verdict:"stuck"` 반환 | `"stuck"` | `"failure"` | 마지막 step |
| step 루프가 `maxSteps` 에 도달 | `"maxSteps"` | `"failure"` | 마지막 step |
| `now() >= deadline` | `"timeout"` | `"failure"` | 마지막 완료된 step |
| actuator가 NotAllowedKeyError throw | `"error"` | `"failure"` | 에러 발생 step |

**원칙**: `result = (endedBy === "success" ? "success" : "failure")`. 다른 모든 경로는 failure다. oracle이 독립적으로 overwrite하는 필드는 v3+.

---

## §screenshot 저장 시점

- `observer.observe()` 호출 시 **메모리에 base64로만** 보관.
- `trace.append()` 가 호출되는 시점에, base64를 `<out>/screenshots/step-###.png` 로 **디스크에 flush** 하고 JSONL에는 **상대 경로만** 기록.
- 이유: trace.jsonl이 base64로 부풀어 오르면 diff·검토가 불가능. HTML 리포트도 상대 경로를 그대로 `<img>` src로 쓴다.
- `previousScreenshot` 은 trace에는 저장하지 않는다 (직전 step의 screenshot 파일을 재사용하면 된다). agent에게 전달할 때만 동일한 PNG를 한 번 더 base64로 보낸다.

screenreader 모드의 개발자용 screenshot은 정책으로 줄일 수 있다.

- `all` — 모든 step 저장
- `important` — verdict step, verification step, 실행 실패 step, `typeText(task)`, `srCommand(act)` 저장
- `failure-only` — 실행 실패, verifier 실패, non-success verdict step 저장
- `none` — screenreader 리포트용 screenshot 저장 안 함

keyboard screenshot은 agent 입력 그 자체이므로 이 정책의 영향을 받지 않는다.

---

## §timing 계측 규칙

aggregate timing:

- `setupMs` — browser/session/runtime 초기화 전체 시간
- `browserLaunchMs` — Playwright browser launch 시간
- `pageLoadMs` — `goto` + 초기 page load 시간
- `voiceOverInitMs` — Guidepup VoiceOver 세션 start 시간
- `firstAnnouncementWaitMs` — 첫 spoken announcement를 확보하는 데 걸린 시간
- `reportMs` — HTML report 생성 시간

step timing:

- `observeMs` — observer가 이번 step 관측을 수집하는 시간
- `decideMs` — agent가 decision을 만드는 시간
- `executeMs` — actuator가 action을 수행하는 시간
- `verifyMs` — verifier가 실행된 시간 (없으면 0)

---

## §agent memory 규칙

`history` 대신 `agent memory` 를 사용한다.

- 각 step이 끝날 때 **가벼운 step archive JSON 1개**를 만든다.
- 다음 step decision에서는 이 archive를 최근 일부만 또는 전체를 agent에 전달한다.
- memory policy:
  - `window = 0` → memory 미전달
  - `window = N` → 최근 N개만 전달
  - `all` → 누적 text memory 전체 전달

memory item에는 아래 정보만 들어간다.

- `step`
- `mode`
- `observation`
- `decision`
- `execution`
- `verification`
- `result.stepOutcome`
- `result.completionSource?`
- `timings`

memory는 **텍스트만** 유지한다.

- keyboard 이미지 base64는 memory에 넣지 않는다.
- keyboard decision 시에는 기존처럼 **현재 screenshot + 직전 screenshot까지만** 별도 입력으로 사용한다.

`same agent instance` 는 provider native session/thread를 뜻하지 않는다.

- 동일한 logical agent abstraction이 run 동안 memory를 축적한다.
- 하지만 각 step 요청은 항상 `goal + current observation + selected memory excerpt` 로 새로 구성해 보낸다.

---

## §experience summary 규칙

`--include-experience-summary` 를 켜면 run 종료 후 experience summary를 생성한다.

- 기본값은 `false`
- summary는 별도 모델/별도 후처리 agent가 아니라 **같은 logical agent abstraction** 이 작성한다
- 다만 summary는 decision window와 분리된다
  - 예: `agent-memory-window = 1` 이어도 summary는 **run 동안 누적된 text memory 전체**를 사용한다

출력 형식은 아래로 고정한다.

- `overall`
- `biggestFriction`
- `nextChecks` 최대 2개

summary는 행동/관측 수준만 말해야 한다.

- 허용: 초기 방향 잡기 어려움, 반복 탐색, 빈 관측, 상호작용 후 피드백 약함, 종료 방식, 다음 확인 포인트
- 금지: DOM 구조 추정, ARIA/WCAG 단정, 시각 정보 본 척, pass/fail 재판정, 감정적 일반화

---

## §금지 사항 (runner 구현 시)

- runner와 agent에서는 `page.evaluate`, `page.$`, `page.$$`, `page.locator` 사용 금지
- `page.accessibility.snapshot()` 사용 금지 (D-002, D-007)
- `page.waitForSelector`, `page.waitForFunction` 사용 금지 (DOM 암묵적 접근)
- 허용된 Playwright API: `goto`, `keyboard.press`, `keyboard.type`, `screenshot`, `viewportSize`, `title`, `url`, `waitForLoadState("networkidle")`, `close`, `bringToFront`
- 새 Playwright API를 쓰고 싶으면 D-002 위반 여부부터 확인하고 DECISIONS.md 에 추가 결정을 남긴다
