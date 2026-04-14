# rawstep demo

`apps/demo` 는 realistic task를 만들기 위한 전용 UI 샌드박스입니다.

현재 포함된 것:

- `Vite + React + TypeScript`
- `Tailwind CSS v4`
- `shadcn/ui`
- `@/*` import alias

실행:

```bash
pnpm demo:dev
```

빌드:

```bash
pnpm demo:build
```

이 앱은 smoke test용 `fixtures/*.html` 를 대체하지 않습니다.
복잡한 로그인, 검색, 탭, 모달 폼, 오류 상태 같은 realistic flow를 여기서 빠르게 조립하는 용도입니다.
