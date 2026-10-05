# 현재 task 안내

예전 Guidepup/LLMAgent workspace 전용 설정과 명령은 제거되었습니다. 현재 단일 패키지의 사용법은 [한국어 README](../README.ko.md), 상세 API는 [마이그레이션 가이드](./migration.md), 소스 위치는 [구조 안내](./editing-map.ko.md)를 참고하세요. 스크린샷 기반 모델 탐색은 `screenshot-run`을 사용합니다. legacy-run은 0.2에서 제거했습니다. [SystemOne 설정](./systemone.md)을 참고하세요.

## 입력(input)

task의 `input`은 이름을 문자열 값에 대응시킵니다. 의사결정 정책(보통 모델)은 각 입력의 이름, 민감 여부, 선택적 설명만 볼 수 있고 값은 절대 보지 못합니다. 정책이 이름 붙은 입력을 입력하라고 요청하면 runner가 실제 값을 입력합니다.

`inputOptions`로 입력별 옵션을 지정합니다. 키는 반드시 `input`에 있는 이름이어야 하고, 각 항목에는 다음 두 필드만 쓸 수 있습니다.

- `sensitive`(boolean, 기본값 `true`): 값이 정책의 관찰에서 가려집니다. 키보드 모드에서는 스크린샷에 해당 필드가 점으로 보이고, 스크린리더 모드에서는 음성에서 값이 `[REDACTED]`로 바뀌며 값을 입력한 직후의 음성은 통째로 숨겨집니다. 검색어처럼 무해한 값은 `false`로 두면 가리지 않습니다.
- `description`(문자열, 1~200자): 모델에게 입력 이름과 함께 보여 주는 설명으로, 입력의 용도를 알려 줍니다.

```json
{
  "url": "fixtures/login.html",
  "goal": "Sign in with the stored email and password",
  "input": { "email": "traveler@example.com", "password": "super-secret", "query": "red shoes" },
  "inputOptions": {
    "email": { "description": "Account email address" },
    "query": { "sensitive": false, "description": "Product search term" }
  },
  "verify": { "all": [{ "titleIncludes": "Welcome" }] }
}
```

위 예에서 `password`는 항목이 없으므로 민감 입력입니다. `goal`은 그대로 모델에 전달되므로, `goal`에 4자 이상인 민감 입력의 값이 들어 있으면 `resolveTask`가 task를 거부합니다. 위 예처럼 값 대신 이름으로 가리키십시오. 4자 미만의 값이나 `sensitive: false` 입력의 값은 `goal`에 써도 됩니다.

가리기는 최선의 방어입니다. 4자 미만의 값은 값을 입력한 단계의 음성을 숨기는 것으로만 보호됩니다. 페이지의 다른 곳에 다시 표시된 값(예: "Hello Alice")이나 shadow DOM 안의 필드는 스크린샷에서 가려지지 않으며, 모델이 페이지의 동작에서 값을 추측할 수도 있습니다. 자세한 내용은 [마이그레이션 가이드](./migration.md#hiding-input-values-from-the-policy)를 참고하세요.

## 검증 규칙

`verify.all`은 모두 성립해야 하는 독립 규칙의 목록입니다. 기본 규칙은 페이지를 직접 읽습니다: `titleIncludes`, `urlIncludes`, `textVisible`, `textVisibleExact`, `domEventSeen`, `requestSeen`, `responseSeen`, `activatedAnnouncementIncludes`. 타임라인 목표 규칙은 실행이 끝났을 때 페이지가 어떻게 보이는지가 아니라 실행 중 무엇이 바뀌었는지를 묻습니다.

| 규칙 | 통과 조건 |
| --- | --- |
| `{ "event": { "kind": ..., "role"?, "name"?, "text"?, "attr"?, "value"?, "url"? }, "after"?: "start" \| "lastActivation" }` | 페이지 observer가 해당 `kind`의 변화를 기록했고, 나머지 지정 필드가 모두 일치합니다. |
| `{ "focused": { "role"?, "name"? } }` | 키보드 포커스가 지금 해당 role 및/또는 name의 요소에 있습니다. 둘 중 하나는 필수입니다. |
| `{ "not": <규칙> }` | 안쪽 규칙이 성립하지 않습니다. |
| `{ "any": [<규칙>, ...] }` | 1~20개의 안쪽 규칙 중 하나 이상이 성립합니다. |

`event.kind`는 `focus`, `focus-lost`, `appeared`, `disappeared`, `live-region`, `state`, `submit`, `navigation` 중 하나입니다. `role`과 `attr`는 정확히 일치해야 하고, `value`는 기록된 값과 같아야 하며, `name`, `text`, `url`에는 텍스트 매처를 쓸 수 있습니다. 지정한 모든 필드가 같은 하나의 기록된 변화에서 일치해야 합니다. `attr`와 `value`는 `state` 변화에, `url`은 `navigation`에, `text`는 `live-region`처럼 텍스트가 있는 변화에 해당합니다.

**텍스트 매처.** 일반 문자열은 "포함"을 뜻합니다. 객체 형태는 `{ "includes": "..." }`, `{ "equals": "..." }`(전체 텍스트 일치), `{ "regex": "...", "flags": "i" }`(텍스트 어디서든 검색, flags는 `i`, `m`, `s`, `u`만 가능)입니다. regex 플래그로 바꾸지 않는 한 대소문자를 구분합니다. 매처 객체에는 세 형태 중 정확히 하나만 쓸 수 있습니다. 문자열은 최대 200자이며, 잘못된 정규식은 task를 불러올 때 거부됩니다.

**`after`.** 최초 페이지 로드는 절대 세지 않습니다. 기본값(`"after": "start"`)에서는 첫 번째 동작 이후, 즉 step 1부터 기록된 변화만 고려하므로 로드 시점에 이미 목표가 보이는 페이지도 `event` 규칙을 만족시키지 못합니다. `"after": "lastActivation"`은 가장 최근에 성공한 activation 단계부터의 변화만 세어, 변화를 가장 최근 activation과 연결합니다. 아직 activation이 없으면 실패합니다.

**`focused`.** 가장 최근의 포커스 기록을 읽으므로, `focus-lost` 변화 뒤에는 포커스가 다시 어떤 요소에 놓일 때까지 false입니다. 이 규칙은 현재 포커스 위치를 나타내므로 최초 로드 시 기록된 포커스도 인정합니다.

**`not`과 `any`.** 규칙은 최대 4단계까지 중첩할 수 있습니다. 위반된 `not`은 안쪽 규칙의 witness를 근거로 실패하고, 통과한 `any`는 성립한 대안의 witness를 기록합니다. `not`은 안쪽 규칙이 성립하지 않으면 observer 데이터가 없을 때도 통과하므로, 페이지가 실제로 관찰되었음을 보여 주는 규칙과 함께 쓰십시오.

**페이지 observer 필요.** `event`와 `focused` 규칙은 페이지 observer의 타임라인을 읽으며, 브라우저 백엔드는 이를 기본으로 기록합니다(`observe: false`로 끌 수 있습니다). observer 데이터가 없으면 `event`/`focused` 규칙은 "page observer events are unavailable"로 실패하고, 이런 규칙만으로 이루어진 `not`/`any`도 실패합니다. 관찰하지 못했다면 "일어나지 않았다"고 확정할 수 없기 때문입니다. 타임라인은 이 규칙들을 위해 메모리에만 가공 없이 보관되며 의사결정 정책에는 전달되지 않습니다. witness는 새 `observer-event` 종류를 쓰고, 텍스트 입력 이후에는 trace에 `kind`, `step`, `role`만 남깁니다.

**baseline과 힌트.** runner는 step 1 전에 기본 verifier로 규칙을 한 번 평가해 `verifier.baseline` trace 이벤트를 기록합니다. 예: `{ "passed": false, "rules": [{ "ruleIndex": 0, "ruleType": "event", "passed": false }, ...] }`. 규칙 인덱스, 종류, 통과 여부만 남기며 witness나 실패 문구는 남기지 않습니다. 평가 중 예외가 나면 오류 이름만 저장합니다. 결과를 결정하지 않으며 사용자 지정 `verifier`가 있으면 생략됩니다. `rawstep hints`는 이를 `goal-met-at-start` 힌트로 바꿉니다. 첫 동작 전에 모든 규칙이 이미 성립했으면 `observed`, 일부만 성립했으면 `suspected`입니다. `not` 규칙은 시작 시점에 성립하는 것이 당연하므로 무시합니다. 로드 시점에 이미 충족된 목표라면 이후의 성공은 실제로 수행한 단계에 대한 약한 근거일 뿐입니다.

**스크린샷 replay export.** `event` 규칙은 최종 검증에 일치하는 `observer-event` witness가 있을 때 exact-pixel replay export에서 인정됩니다. `focused`, `not`, `any` 규칙은 replay export에서 인정되지 않습니다.

예시. `fixtures/friction-lab.html`에서 키 `Tab, Tab, Tab, Enter`로 실행합니다.

```json
{
  "url": "fixtures/friction-lab.html",
  "goal": "Add the item to the cart",
  "verify": {
    "all": [
      { "event": { "kind": "live-region", "role": "status", "text": "Added to cart" } },
      { "any": [
        { "event": { "kind": "appeared", "role": "alert", "name": { "regex": "cart", "flags": "i" } } },
        { "titleIncludes": "Nope" }
      ] },
      { "not": { "event": { "kind": "focus-lost" } } },
      { "titleIncludes": "Friction" }
    ]
  }
}
```

실행은 step 4에서 성공합니다. 그 전 검증은 알림이 아직 나타나지 않았으므로 실패하고, baseline에서는 `titleIncludes`와 `not`이 이미 true이고 `event` 규칙은 false이므로 `hints`가 suspected `goal-met-at-start`를 보고합니다.
