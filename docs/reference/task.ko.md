# 태스크 파일 레퍼런스

태스크 JSON 파일(`tasks/*.json`, [`packages/core/src/contracts/index.ts`](../../packages/core/src/contracts/index.ts)의 `resolveTask()`에서 검증됨)의 전체 작성 규칙입니다.

---

## 1. 태스크 파일 예시

```json
{
  "id": "account-login",
  "url": "https://example.com/login",
  "goal": "Sign in to the customer portal using the provided email and password.",
  "context": "ExampleShop customer portal login page.",
  "maxSteps": 40,
  "timeoutMs": 120000,
  "input": {
    "email": "reader@example.com",
    "password": "correct-horse-battery-staple"
  },
  "inputOptions": {
    "email": {
      "sensitive": false,
      "description": "Account email address"
    },
    "password": {
      "sensitive": true,
      "description": "Account password"
    }
  },
  "navigation": {
    "strategy": "same-origin",
    "readOnly": false,
    "denyUrlIncludes": ["/logout", "/delete-account"]
  },
  "browser": {
    "mode": "launch",
    "personCheck": false
  },
  "verify": {
    "all": [
      { "urlIncludes": "/dashboard" },
      {
        "event": {
          "kind": "appeared",
          "role": "heading",
          "name": { "includes": "Welcome" }
        },
        "after": "lastActivation"
      }
    ]
  }
}
```

---

## 2. 최상위 필드

| 필드 | 타입 | 기본값 | 제약 사항 및 설명 |
| :--- | :--- | :--- | :--- |
| `id` | `string` *(선택)* | *(생략)* | 트레이스 메타데이터에 기록되는 태스크 식별자. |
| `url` | `string` | *(필수)* | 시작 URL (`http://`, `https://`, `file://`, 또는 로컬 HTML 파일 경로). 상대 경로는 `rawstep run <파일>`로 실행하면 태스크 파일이 있는 폴더 기준으로, `rawstep.config.json`에 등록된 태스크는 프로젝트 루트 기준으로 해석됩니다. |
| `goal` | `string` | *(필수)* | 플래너에게 전달할 자연어 목표. **민감 정보로 설정된 입력값(4자 이상)이 포함되어서는 안 됩니다.** |
| `context` | `string` *(선택)* | *(생략)* | 실제 사용자라면 시작 전에 이미 알고 있을 배경 정보 (최대 `1000`자). 민감 입력값이나 숨겨진 페이지 구조 힌트를 적으면 안 됩니다. |
| `profile` | `string \| EnvironmentProfile` *(선택)* | *(지정 안 함)* | 실행 프로필 없이 태스크를 단독 실행할 때 적용할 페이지 환경 (`narrow`, `text-200`, `forced-colors` 같은 내장 프리셋 또는 커스텀 객체. [페이지 환경](config.ko.md#33-페이지-환경-page) 참고). |
| `maxSteps` | `number` *(선택)* | `40` | `unmeasured`(`max-steps`)로 중단되기 전까지 허용할 최대 동작 횟수. `1` 이상의 정수. |
| `timeoutMs` | `number` *(선택)* | `120000` | 실행 제한 시간 (밀리초, `1–3600000` 정수). `personCheck`에서 사람이 봇 확인을 통과하기를 기다리는 시간은 제한 시간에서 제외됩니다. |
| `input` | `Record<string, string>` *(선택)* | `{}` | 시뮬레이션 사용자가 폼 필드에 입력할 수 있는 이름 붙은 문자열 값들 (`typeText` / `replaceText`). |
| `inputOptions` | `Record<string, { sensitive?: boolean, description?: string }>` *(선택)* | `sensitive: true` | 각 입력값의 민감 여부와 설명. `task.input`의 모든 값은 `"sensitive": false`를 명시하지 않으면 **기본적으로 민감 정보로 취급**됩니다. 각 키는 `input`에도 있어야 하며, `description`은 200자 이내의 비어 있지 않은 문자열입니다. |
| `navigation` | `NavigationPolicy` *(선택)* | `{ "strategy": "same-origin" }` | 이동 가능한 출처 범위와 HTTP 메서드 제한 규칙. |
| `browser` | `TaskBrowser` *(선택)* | `{ "mode": "launch" }` | 새 브라우저를 띄울지 기존 Chrome에 연결할지, 그리고 봇 차단 화면이 나올 때 사람이 직접 풀어줄지(`personCheck`)를 설정합니다. |
| `verify` | `{ all: VerifyRule[] }` | *(필수, 1개 이상)* | 독립 완료 검증 규칙 목록. `verify.all` 안의 모든 규칙이 동시에 만족되어야 `reached`로 판정됩니다. |

---

## 3. 브라우저 설정 (`browser`)

로그인된 브라우저 세션이 필요하거나 봇 확인(Cloudflare Turnstile, hCaptcha, reCAPTCHA 등)이 뜨는 사이트를 테스트할 때 사용합니다.

```json
"browser": {
  "mode": "connect",
  "copySignIn": true,
  "personCheck": true
}
```

- **`mode` (`'launch' | 'connect'`, 기본값 `'launch'`):**
  - `'launch'`: Rawstep이 새 Chromium 브라우저를 직접 실행합니다.
  - `'connect'`: 사용자가 `--remote-debugging-port` 옵션으로 미리 띄워 둔 Chrome(`rawstep.config.json`의 `machine.browserEndpoint`에 설정된 주소, 예: `http://localhost:9222`)에 연결해 격리된 브라우저 컨텍스트를 엽니다.
- **`copySignIn` (`boolean`, 선택, `mode === 'connect'`일 때만 사용 가능):**
  - 연결된 Chrome의 쿠키와 `localStorage`를 새 실행 컨텍스트로 복사해 이미 로그인된 상태로 테스트를 시작합니다.
- **`personCheck` (`boolean`, 선택):**
  - 화면에 보이는 브라우저 창(`headless: false`)을 엽니다. 실행 도중 봇 확인 페이지가 감지되면 실행을 일시 정지하고 사람이 직접 통과할 때까지 기다린 뒤, 대기한 시간만큼 `timeoutMs`를 보전해 줍니다. `launch` 모드에서 `personCheck`를 켜면 `.rawstep/browser-profile`에 브라우저 프로필을 유지하며 한 번에 하나씩만 실행됩니다.

---

## 4. 탐색 범위 정책 (`navigation`)

```json
"navigation": {
  "strategy": "same-origin",
  "readOnly": true,
  "denyUrlIncludes": ["/logout", "/billing"]
}
```

- **`strategy`:**
  - `'same-origin'` *(기본값)*: 시작 `url`과 프로토콜, 호스트명, 포트가 완전히 같은 URL로만 이동을 허용합니다.
  - `'start-url-prefix'`: 시작 `url`의 경로 접두사로 시작하는 하위 경로로만 이동을 허용합니다.
  - `'allow-url-list'`: 비어 있지 않은 `allowUrlList: string[]`에 나열된 HTTP(S) URL 접두사(인증 정보 포함 불가)로만 이동을 허용합니다. 다른 두 전략에서는 `allowUrlList`를 쓸 수 없습니다.
- **`readOnly` (`boolean`, 선택):** `true`로 설정하면 상태를 변경하는 요청을 차단하고 `GET`, `HEAD`, `OPTIONS` 요청만 허용합니다.
- **`denyUrlIncludes` (`string[]`, 선택):** URL에 지정된 부분 문자열이 포함된 모든 이동을 차단합니다 (비어 있지 않은 문자열 최대 100개, 각 200자 이내).
- **리다이렉트 및 팝업 차단:** CDP `Fetch.requestPaused`를 통해 HTTP 리다이렉트(최대 10홉)마다 정책을 검사하며, 새 팝업 창(`target="_blank"`, `window.open`)은 열리기 전에 닫습니다.

---

## 5. 입력값 보호 (`input` 및 `inputOptions`)

1. **기본 민감 정보 처리:** `task.input`의 모든 키는 기본적으로 `sensitive: true`입니다.
   - `"sensitive": true`인 입력값은 플래너에게 키 이름과 `description`만 전달되며 실제 값은 전달되지 않습니다.
   - `"sensitive": false`인 입력값(예: 상품 검색어)은 플래너가 어떤 단어를 입력하는지 알 수 있도록 실제 값이 전달됩니다.
2. **로드 시점 노출 검사:** 4자 이상인 민감 입력값이 `goal`, `context`, 또는 `script.source` 안에 그대로 적혀 있으면 실행 전에 `resolveTask()`가 오류를 발생시킵니다.
3. **트레이스 및 음성 기록 마스킹:** 실행 도중 민감 입력값이 한 번이라도 타이핑된 이후에는 다음 보호 조치가 적용됩니다.
   - 해당 입력 단계의 음성 출력은 `"[typed input withheld]"`로 대체됩니다.
   - 이후 모든 음성 발화, 트레이스 이벤트, 리포트에서 해당 민감 값(4자 이상, `encodeURIComponent`·폼 인코딩·JSON 이스케이프 변형 포함)은 `"[REDACTED]"`로 치환됩니다.
   - 입력 이후의 진단용 스크린샷 저장이 생략되어 화면에 찍힌 평문 텍스트가 디스크에 남지 않습니다.

---

## 6. 독립 완료 검증 규칙 (`verify.all`)

`verify.all`의 각 규칙은 매 단계가 끝날 때마다 브라우저에서 독립적으로 평가됩니다 (`not`과 `any`는 서로 최대 4단계까지 중첩할 수 있음). `event` 규칙 외의 각 규칙에는 키가 정확히 하나만 있어야 하며(`event`는 `after`를 더할 수 있음), 문자열 값은 비어 있으면 안 됩니다.

| 규칙 키 | 형태 | 통과 조건 |
| :--- | :--- | :--- |
| **`urlIncludes`** | `{ "urlIncludes": "/success" }` | 현재 페이지 URL에 해당 문자열이 포함되어 있을 때. |
| **`titleIncludes`** | `{ "titleIncludes": "Receipt" }` | `document.title`에 해당 문자열이 포함되어 있을 때. |
| **`textVisible`** | `{ "textVisible": "Order confirmed" }` | 화면에 보이는 요소 중 해당 문자열을 포함한 텍스트가 있을 때. |
| **`textVisibleExact`** | `{ "textVisibleExact": "Paid" }` | 화면에 보이는 요소 중 해당 문자열과 정확히 일치하는 텍스트가 있을 때. |
| **`focused`** | `{ "focused": { "role"?: string, "name"?: TextMatcher } }` | 현재 키보드 포커스가 `role` 및 `name` 조건에 맞는 요소에 가 있을 때 (둘 중 하나는 필수). |
| **`event`** | `{ "event": { "kind": ObservedEventKind, "role"?, "name"?, "text"?, "attr"?, "value"?, "url"? }, "after"?: "start" \| "lastActivation" }` | 실행 시작 이후(`"start"`, 기본값) 또는 마지막 활성화 동작 이후(`"lastActivation"`)에 페이지 관찰자가 조건에 맞는 이벤트(`'focus'`, `'focus-lost'`, `'appeared'`, `'disappeared'`, `'live-region'`, `'state'`, `'submit'`, `'navigation'`, `'page-blur'`, `'page-focus'`)를 기록했을 때. |
| **`activatedAnnouncementIncludes`** | `{ "activatedAnnouncementIncludes": "Added" }` | 가장 최근 활성화 동작 직후 수집된 스크린리더 음성에 해당 문자열이 포함되어 있을 때. |
| **`domEventSeen`** | `{ "domEventSeen": { "selector": "form#pay", "event": "submit" } }` | `selector`와 일치하는 요소에서 지정된 DOM 이벤트가 발생했을 때. |
| **`requestSeen`** | `{ "requestSeen": { "urlIncludes": "/api/cart", "method"?: "POST" } }` | 브라우저가 `urlIncludes`(및 선택적 `method`)와 일치하는 HTTP 요청을 보냈을 때. |
| **`responseSeen`** | `{ "responseSeen": { "urlIncludes": "/api/cart", "method"?: "POST", "status"?: 200 } }` | 브라우저가 `urlIncludes`, 선택적 `method`, 선택적 HTTP `status`(`100–599` 정수)와 일치하는 응답을 받았을 때. |
| **`not`** | `{ "not": VerifyRule }` | 내부 규칙이 `false`로 평가될 때 (내부 규칙의 근거를 얻을 수 없으면 통과하지 않고 실패로 처리). |
| **`any`** | `{ "any": VerifyRule[] }` | 배열(`1–20`개) 안의 규칙 중 하나 이상이 통과할 때. |
| **`script`** | `{ "script": { "description": string, "source": "(ctx) => boolean" } }` | `description`은 필수(300자 이내). 함수 표현식 `source`(`<= 4000`자, `(ctx) =>`, `async (ctx) =>`, `function`처럼 함수 형태로 시작해야 함)가 격리된 CDP 월드(`rawstep-verify`, 네트워크 API 차단, `2000 ms` 제한)에서 실행되어 `true`를 반환할 때. `ctx.timeline`으로 그때까지 기록된 관찰자 이벤트를 조회할 수 있습니다. |

### `TextMatcher` 작성 형식
`TextMatcher` 타입을 받는 필드(`focused.name`, `event.name`, `event.text`, `event.url`)에는 최대 200자 이내로 다음 네 가지 형식 중 하나를 쓸 수 있습니다.
- `"Checkout"` (대소문자 구분 부분 일치)
- `{ "includes": "Checkout" }` (대소문자 구분 부분 일치)
- `{ "equals": "Checkout" }` (완전 일치)
- `{ "regex": "^Checkout \\(\\d+\\)$", "flags": "i" }` (정규표현식, 허용 플래그: `i`, `m`, `s`, `u`)
