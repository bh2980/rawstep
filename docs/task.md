# Task

task 파일은 "어느 페이지에서 무엇을 해야 하는지"를 적는 과업 본문입니다.

---

## 빠른 시작

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

### `input`이 있는 예시

```json
{
  "id": "login",
  "url": "../../fixtures/credential-login.html",
  "goal": "이메일과 비밀번호 입력칸에 각각 email, password input 값을 넣고, Sign in 버튼을 눌러 로그인 성공 메시지가 보이게 만들어라.",
  "mode": "screenreader",
  "maxSteps": 24,
  "timeoutMs": 180000,
  "input": {
    "email": "traveler@example.com",
    "password": "super-secret"
  },
  "verify": {
    "all": [
      { "textVisible": "Signed in." },
      { "titleIncludes": "Credential Login Completed" }
    ]
  }
}
```

---

## 필드 레퍼런스

### task top-level 키

| 키 | 필수 | 설명 |
|----|------|------|
| `url` | ✓ | 실행할 페이지 URL. 상대 경로면 task 파일 기준으로 resolve |
| `goal` | ✓ | 자연어 과업 목표 |
| `verify` | ✓ | 성공 판정 규칙 |
| `id` | | 생략하면 파일명 기반 ID 사용 |
| `mode` | | `keyboard \| screenreader` |
| `maxSteps` | | 최대 step 수 override |
| `timeoutMs` | | 제한 시간(ms) override |
| `input` | | named string map. 예: `email`, `password`, `otp` |
| `config` | | task 단위 실행 override (아래 참고) |

### `input`

에이전트가 임의 텍스트를 만들지 않고, task에 선언된 실제 값만 직접 입력하도록 합니다. 예를 들어 프롬프트에는 `email="traveler@example.com"` 같이 라벨과 값이 함께 보이고, 응답은 `{"action":"typeText","value":"traveler@example.com"}` 형태로 반환합니다.

> **`screenreader` + `guidepup-voiceover` 조합 주의사항**  
> 이 조합에서는 `typeText`를 특별 취급합니다. 실제 텍스트 입력은 브라우저 쪽 입력 경로로 수행하고, 입력 후 값이 기대값과 일치하면 다음 step 관측으로 `Email, current value traveler@example.com` 같은 synthetic announcement를 제공합니다.  
> 이 값은 실제 VoiceOver 발화의 직접 캡처가 아니라, text entry / 발화 수집의 불안정을 줄이기 위한 안정화된 대체 관측입니다. `guidepup-virtual`, `guidepup-nvda`는 기존 입력/관측 경로를 유지합니다.

### `config` override

task `config`는 실행 옵션만 받습니다. `provider`, `apiKey`, `model`, `baseURL`은 넣을 수 없습니다.

`config.outDir`를 쓰면 그 값은 최종 폴더가 아니라 **출력 루트 디렉터리**로 해석됩니다.  
실제 저장 위치는 `config.outDir/<taskId>/<runId>`이며, 상대 경로면 task 파일 기준으로 resolve됩니다.

```json
{
  "config": {
    "mode": "screenreader",
    "outDir": "./custom-out",
    "timeoutMs": 600000,
    "memory": "all",
    "headless": true,
    "screenReaderBackend": "guidepup-virtual",
    "allowedScreenReaderActions": ["sr.next", "sr.act"],
    "observe": {
      "silenceWindowMs": 1500,
      "maxObserveMs": 12000
    }
  }
}
```

> 공통 실행값은 `rawstep.config.ts > modes.<mode>`로 올리고, task에는 과업 본문만 두는 편이 읽기 쉽습니다. `config`는 예외적인 override가 있을 때만 쓰세요.

---

## verify 레퍼런스

`verify`는 task 성공 판정 규칙입니다. 반드시 `all` 배열이어야 하고, 배열 안의 rule이 **전부 통과**해야 성공입니다. 각 rule object는 키를 **정확히 하나만** 가져야 합니다.

verifier는 기본적으로 agent가 `success`를 선언했을 때 실행됩니다. `--verifier-auto-complete`를 켜면 성공 가능성이 있는 action 뒤에도 추가로 확인합니다.

### rule 종류

| rule | 설명 |
|------|------|
| `textVisible` | 페이지에 해당 텍스트가 실제로 보이면 통과. 부분 포함 검사 |
| `textVisibleExact` | 페이지에 해당 텍스트가 정확히 같은 visible text로 보이면 통과 |
| `titleIncludes` | `document.title`에 지정한 문자열이 포함되면 통과 |
| `urlIncludes` | 현재 페이지 전체 URL에 지정한 값이 포함되면 통과 |
| `requestSeen` | 실행 중 관측된 네트워크 요청 중 조건에 맞는 것이 하나라도 있으면 통과 |
| `responseSeen` | 실행 중 관측된 네트워크 응답 중 조건에 맞는 것이 하나라도 있으면 통과 |

`requestSeen`, `responseSeen`은 `urlIncludes`, `method`, `status`를 받으며 `method`와 `status`는 선택 사항입니다.

```json
{ "requestSeen":  { "urlIncludes": "/api/cart", "method": "POST" } }
{ "responseSeen": { "urlIncludes": "/api/cart", "method": "POST", "status": 200 } }
```

### 자주 쓰는 패턴

```jsonc
// 화면 상태 변화
{ "all": [{ "textVisible": "Started!" }, { "titleIncludes": "Completed" }] }

// 라우팅 이동
{ "all": [{ "urlIncludes": "/checkout" }] }

// 폼 제출
{ "all": [{ "textVisible": "Signed in." }, { "responseSeen": { "urlIncludes": "/api/login", "status": 200 } }] }

// 값이 정확히 일치해야 하는 성공 문구 확인
{ "all": [{ "textVisibleExact": "Signed in." }] }
```
