# RUNTIME_LOOP

> runner 구현의 **유일한 근거**. 이 문서와 다르게 구현하면 버그다.
> 이 루프를 확장하지 말 것. 여기 있는 것만이 v1의 전부다.

---

## 의사코드

```
runTask(task) -> TraceSession:
  validate_mode(task.mode)                    # "screenreader" → throw
  trace = TraceRecorder(task)
  browser = createBrowserSession(task.url)
  observer = KeyboardObserver(browser.page)
  actuator = Actuator(browser.page)
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
        allowedKeys: ALLOWED_KEYS,
        history: trace.recentDecisions(HISTORY_WINDOW),
      }

      decision = await agent.decide(ctx, obs)  # malformed → {verdict:"stuck", ...}

      if decision.verdict == "success":
        trace.append(step, obs, decision, execution={ok:true, costDelta:0})
        endedBy = "success"; break

      if decision.verdict == "stuck":
        trace.append(step, obs, decision, execution={ok:true, costDelta:0})
        endedBy = "stuck"; break

      try:
        actuator.press(decision.action.key)
        trace.append(step, obs, decision, execution={ok:true, costDelta:1})
      catch NotAllowedKeyError as e:
        trace.append(step, obs, decision, execution={ok:false, error:str(e), costDelta:0})
        endedBy = "error"; break

      settle(browser.page)                    # §settle 규칙

    else:
      endedBy = "maxSteps"

  finally:
    browser.close()
    trace.finalize(endedBy)

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

## §timeout / maxSteps / verdict 규칙

| 상황 | `aggregate.endedBy` | `reachedGoal` | `failurePoint` |
|---|---|---|---|
| agent가 `verdict:"success"` 반환 | `"success"` | `true` | 없음 |
| agent가 `verdict:"stuck"` 반환 | `"stuck"` | `false` | 마지막 step |
| step 루프가 `maxSteps` 에 도달 | `"maxSteps"` | `false` | 마지막 step |
| `now() >= deadline` | `"timeout"` | `false` | 마지막 완료된 step |
| actuator가 NotAllowedKeyError throw | `"error"` | `false` | 에러 발생 step |

**원칙**: `reachedGoal = (endedBy === "success")`. 다른 모든 경로는 false. oracle이 독립적으로 overwrite하는 필드는 v3+.

---

## §screenshot 저장 시점

- `observer.observe()` 호출 시 **메모리에 base64로만** 보관.
- `trace.append()` 가 호출되는 시점에, base64를 `<out>/screenshots/step-###.png` 로 **디스크에 flush** 하고 JSONL에는 **상대 경로만** 기록.
- 이유: trace.jsonl이 base64로 부풀어 오르면 diff·검토가 불가능. HTML 리포트도 상대 경로를 그대로 `<img>` src로 쓴다.
- `previousScreenshot` 은 trace에는 저장하지 않는다 (직전 step의 screenshot 파일을 재사용하면 된다). agent에게 전달할 때만 동일한 PNG를 한 번 더 base64로 보낸다.

---

## §HISTORY_WINDOW

```ts
export const HISTORY_WINDOW = 8;
```

agent에게 recentDecisions로 넘기는 최근 결정의 개수. 사람의 작업 기억 근사. 8보다 크면 사람보다 유리, 4보다 작으면 사람보다 불리한 것으로 간주한다. 이 값은 `packages/core/src/constants.ts` 에서 export한다.

---

## §금지 사항 (runner 구현 시)

- `page.evaluate`, `page.$`, `page.$$`, `page.locator` 사용 금지
- `page.accessibility.snapshot()` 사용 금지 (D-002, D-007)
- `page.waitForSelector`, `page.waitForFunction` 사용 금지 (DOM 암묵적 접근)
- 허용된 Playwright API: `goto`, `keyboard.press`, `screenshot`, `viewportSize`, `title`, `url`, `waitForLoadState("networkidle")`, `close`
- 새 Playwright API를 쓰고 싶으면 D-002 위반 여부부터 확인하고 DECISIONS.md 에 추가 결정을 남긴다
