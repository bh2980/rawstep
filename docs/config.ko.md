# 현재 config 안내

Guidepup/LLMAgent 설정과 AI_* 환경변수는 복원하지 않습니다. --decision systemone은 RAWSTEP_DECISION_*만, analyze --llm은 RAWSTEP_ANALYSIS_*만 읽습니다. 우선순위는 CLI → 프로세스 env → .env.local → .env이며 파일을 덮어쓰지 않습니다. 라이브러리는 설정을 주입받습니다. [SystemOne 설정·검증](./systemone.md), 루트 .env.example, [마이그레이션](./migration.md)을 참고하세요.

## OpenRouter 스크린샷 실행

기존 TypeSafe/Jev 설정과 `RAWSTEP_DECISION_OPENROUTER_API_KEY`는 그대로 유지합니다. OpenRouter의 Clef Flash 이미지 요청을 **`state` 내부 콘텐츠 배열**로 수정했습니다. 실제 서비스에서 빨강/파랑 구분, 현재/이전 이미지 순서, 깨진 이미지 거부를 확인했습니다. 이전의 전역 이미지 차단은 제거했습니다. [수정·실험 기록](./openrouter-image-delivery.md)

```sh
npm run try:openrouter
```

이 명령은 **OpenRouter + Clef Flash + 스크린샷/키보드** 샘플을 실행합니다. 명시적 실행 옵션으로 기존 `.env.local`의 연결 설정을 덮어쓰지만 파일 자체는 수정하지 않습니다. 기존 전용 OpenRouter 키를 사용하며 Chrome 하나만 실행하고 종료합니다. VoiceOver, 사후 분석 LLM, 모델 다운로드, Python 설치는 사용하지 않습니다. 샘플 스크린샷은 원격 모델에 전송됩니다.

`openrouter-systemone`의 Jev 텍스트 판단은 `--decision-model typesafe/jev-1.13 --decision-inputs text`로 선택합니다. 기존 TypeSafe 연결과 스크린리더 제어 계층은 변경하지 않았습니다. 일반 SystemOne HTTP와 `/choose`를 통한 이미지 실행도 그대로 유지합니다. CLI env 로딩은 연결 설정을 만들 뿐이며, 추후 UI도 같은 설정 객체와 `{id, version, instructions}` 프롬프트를 주입할 수 있습니다.
