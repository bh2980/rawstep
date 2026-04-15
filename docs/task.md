# Task 문서

task 파일은 "어느 페이지에서 무엇을 해야 하는지"를 적는 과업 본문입니다.
쉽게 말해 실행 대상 URL, 목표 문장, 성공 판정 규칙을 묶어두는 JSON 파일입니다.

관련 문서:

- config 우선순위와 mode preset은 [config.md](./config.md)
- 실행 플래그는 [cli.md](./cli.md)

## 최소 예시

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

## `input`이 있는 예시

```json
{
  "id": "email-login",
  "url": "../../fixtures/email-login.html",
  "goal": "이메일 입력칸에 email input 값을 넣고, Send magic link 버튼을 눌러 성공 메시지가 보이게 만들어라.",
  "mode": "keyboard",
  "maxSteps": 24,
  "timeoutMs": 180000,
  "input": {
    "email": "traveler@example.com"
  },
  "verify": {
    "all": [
      { "textVisible": "Magic link sent." },
      { "textVisible": "traveler@example.com" },
      { "titleIncludes": "Completed" }
    ]
  }
}
```

`input`은 task가 제공하는 문자열 모음입니다.
에이전트는 마음대로 아무 텍스트나 만들지 않고, `email` 같은 키를 골라 그 값을 입력합니다.

Backend note:

- `screenreader + guidepup-voiceover` 조합에서는 `typeText`만 특별 취급합니다.
- 실제 텍스트 입력은 브라우저 입력 경로로 수행하고, 값이 기대값과 맞으면 다음 step 관측에 `Email, traveler@example.com` 같은 synthetic announcement를 넣습니다.
- 이 값은 실제 VoiceOver 발화를 직접 녹음한 것이 아니라, 입력 단계를 더 안정적으로 관측하기 위한 대체 텍스트입니다.

## top-level 키

| 키 | 필수 | 설명 |
|----|------|------|
| `url` | 예 | 실행할 페이지 URL. 상대 경로면 task 파일 기준으로 계산 |
| `goal` | 예 | 자연어 과업 목표 |
| `verify` | 예 | 성공 판정 규칙 |
| `id` | 아니오 | 생략하면 파일명 기반 ID 사용 |
| `mode` | 아니오 | `keyboard` 또는 `screenreader` |
| `maxSteps` | 아니오 | 최대 step 수 override |
| `timeoutMs` | 아니오 | 전체 제한 시간(ms) override |
| `input` | 아니오 | named string map. 예: `email`, `password`, `otp` |
| `config` | 아니오 | 실행 옵션 override |

## `config` override

task `config`는 실행 옵션만 받습니다.
여기에는 `provider`, `apiKey`, `model`, `baseURL`을 넣을 수 없습니다.

```json
{
  "config": {
    "mode": "screenreader",
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

권장 방식:

- 공통 실행값은 `rawstep.config.ts > modes.<mode>`에 둡니다.
- task에는 과업 본문만 적습니다.
- `config`는 정말 예외적인 override가 필요할 때만 씁니다.

실제 우선순위는 [config.md](./config.md)의 "실행 우선순위"를 봅니다.

## `verify`

`verify`는 task 성공 판정 규칙입니다.

- 반드시 `all` 배열이어야 합니다.
- 배열 안의 rule이 전부 통과해야 성공입니다.
- 각 rule object는 top-level 키를 정확히 하나만 가져야 합니다.

verifier는 기본적으로 agent가 `success`를 선언했을 때 실행됩니다.
`verifierAutoComplete`가 켜져 있으면 성공 가능성이 있는 action 뒤에도 추가 확인을 합니다.

### rule 종류

**`textVisible`**

- 페이지에 해당 텍스트가 실제로 보이면 통과
- 부분 포함 검사

```json
{ "textVisible": "Magic link sent." }
```

**`titleIncludes`**

- `document.title`에 지정한 문자열이 들어 있으면 통과

```json
{ "titleIncludes": "Completed" }
```

**`urlIncludes`**

- 현재 URL 전체 문자열에 지정 값이 들어 있으면 통과

```json
{ "urlIncludes": "/checkout" }
```

**`requestSeen`**

- 실행 중 관측된 네트워크 요청 중 조건과 맞는 것이 하나라도 있으면 통과

```json
{ "requestSeen": { "urlIncludes": "/api/cart", "method": "POST" } }
```

**`responseSeen`**

- 실행 중 관측된 네트워크 응답 중 조건과 맞는 것이 하나라도 있으면 통과

```json
{ "responseSeen": { "urlIncludes": "/api/cart", "method": "POST", "status": 200 } }
```

`requestSeen`, `responseSeen`의 `method`, `status`는 선택입니다.

## 자주 쓰는 패턴

```jsonc
// 화면 상태 변화
{ "all": [{ "textVisible": "Started!" }, { "titleIncludes": "Completed" }] }

// 라우팅 이동
{ "all": [{ "urlIncludes": "/checkout" }] }

// 폼 제출
{
  "all": [
    { "textVisible": "Magic link sent." },
    { "responseSeen": { "urlIncludes": "/api/login", "status": 200 } }
  ]
}
```
