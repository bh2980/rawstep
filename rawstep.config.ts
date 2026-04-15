import {
  defineConfig,
  kb,
  sr,
  type ProjectConfigSource,
} from "@rawstep/config";

const providerFromEnv = process.env.AI_PROVIDER;

const config: ProjectConfigSource = defineConfig({
  version: 1,
  defaults: {
    provider:
      providerFromEnv === "anthropic" || providerFromEnv === "openai-compatible"
        ? providerFromEnv
        : undefined,
    model: process.env.AI_MODEL,
    baseURL: process.env.AI_BASE_URL,
    apiKey: process.env.AI_API_KEY,
  },
  modes: {
    keyboard: {
      outDir: "./.rawstep/out/keyboard",
      maxSteps: 30,
      timeoutMs: 240000,
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: 8,
      allowedKeys: [
        kb.arrow.down({
          hint: "ArrowDown은 스크롤을 내리거나 복합 위젯 내부에서 아래쪽으로 이동할 때 사용하라.",
        }),
        kb.arrow.left({
          hint: "ArrowLeft는 복합 위젯 내부에서 왼쪽으로 이동할 때 사용하라.",
        }),
        kb.arrow.right({
          hint: "ArrowRight는 복합 위젯 내부에서 오른쪽으로 이동할 때 사용하라.",
        }),
        kb.arrow.up({
          hint: "ArrowUp은 스크롤을 올리거나 복합 위젯 내부에서 위쪽으로 이동할 때 사용하라.",
        }),
        kb.enter({
          hint: "Enter는 현재 포커스된 요소를 활성화할 때 사용하라.",
        }),
        kb.escape({
          hint: "Escape는 열린 dialog, menu, popup을 닫거나 현재 상태를 정리할 때 사용하라.",
        }),
        kb.shiftTab({
          hint: "Shift+Tab은 포커스 가능한 요소를 이전으로 이동할 때 사용하라.",
        }),
        kb.space({
          hint: "Space는 현재 포커스된 요소를 활성화하거나 토글할 때 사용하라.",
        }),
        kb.tab({
          hint: "Tab은 포커스 가능한 요소를 다음으로 이동할 때 사용하라.",
        }),
        kb.home({
          hint: "Home은 현재 문맥의 시작으로 크게 이동할 때 사용하라.",
        }),
        kb.end({ hint: "End는 현재 문맥의 끝으로 크게 이동할 때 사용하라." }),
      ],
    },
    screenreader: {
      outDir: "./.rawstep/out/screenreader",
      headless: false,
      maxSteps: 240,
      timeoutMs: 420000,
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all",
      screenReaderBackend: "guidepup-voiceover",
      allowedScreenReaderActions: [
        sr.next({
          hint: "next는 screen reader cursor를 다음 위치로 이동할 때 사용하라.",
        }),
        sr.previous({
          hint: "previous는 screen reader cursor를 이전 위치로 이동할 때 사용하라.",
        }),
        sr.key.arrow.down({
          hint: "ArrowDown은 스크롤을 내리거나 복합 위젯 내부에서 아래쪽으로 이동할 때 사용하라.",
        }),
        sr.key.arrow.left({
          hint: "ArrowLeft는 복합 위젯 내부에서 왼쪽으로 이동할 때 사용하라.",
        }),
        sr.key.arrow.right({
          hint: "ArrowRight는 복합 위젯 내부에서 오른쪽으로 이동할 때 사용하라.",
        }),
        sr.key.arrow.up({
          hint: "ArrowUp은 스크롤을 올리거나 복합 위젯 내부에서 위쪽으로 이동할 때 사용하라.",
        }),
        sr.key.enter({
          hint: "Enter는 현재 포커스된 요소를 활성화할 때 사용하라.",
        }),
        sr.key.escape({
          hint: "Escape는 열린 dialog, menu, popup을 닫거나 현재 상태를 정리할 때 사용하라.",
        }),
        sr.key.shiftTab({
          hint: "Shift+Tab은 포커스 가능한 요소를 이전으로 이동할 때 사용하라.",
        }),
        sr.key.space({
          hint: "Space는 현재 포커스된 요소를 활성화하거나 토글할 때 사용하라.",
        }),
        sr.key.tab({
          hint: "Tab은 포커스 가능한 요소를 다음으로 이동할 때 사용하라.",
        }),
        sr.key.home({
          hint: "Home은 현재 문맥의 시작으로 크게 이동할 때 사용하라.",
        }),
        sr.key.end({
          hint: "End는 현재 문맥의 끝으로 크게 이동할 때 사용하라.",
        }),
        sr.key.mod.a({
          hint: "입력창에 포커스를 둔 상태에서 텍스트를 전체 선택할 때 사용하라.",
        }),
        sr.key.backspace({ hint: "입력 중인 텍스트를 지울 때 사용하라." }),
        sr.interact({
          hint: "interact는 현재 web area나 그룹 안으로 들어가 더 자세히 탐색할 때 사용하라.",
        }),
        sr.stopInteracting({
          hint: "stopInteracting은 현재 상호작용 문맥에서 빠져나올 때 사용하라.",
        }),
        sr.act({ hint: "act는 현재 항목의 기본 동작을 실행할 때 사용하라." }),
      ],
    },
  },
});

export default config;
