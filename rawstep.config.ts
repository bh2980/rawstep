import {
  defineConfig,
  kb,
  sr,
  type ProjectConfigSource,
} from "@rawstep/config";

const providerFromEnv = process.env.AI_PROVIDER;
const reasoningEffortFromEnv = process.env.AI_REASONING_EFFORT;
const resolvedReasoningEffort =
  reasoningEffortFromEnv === "none" ||
  reasoningEffortFromEnv === "low" ||
  reasoningEffortFromEnv === "medium" ||
  reasoningEffortFromEnv === "high" ||
  reasoningEffortFromEnv === "xhigh"
    ? reasoningEffortFromEnv
    : undefined;

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
    reasoningEffort: "medium",
  },
  modes: {
    keyboard: {
      maxSteps: 30,
      timeoutMs: 240000,
      headless: true,
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all",
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
      headless: false,
      maxSteps: 1000,
      timeoutMs: 600000,
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [
        sr.next({
          hint: "next는 VoiceOver 커서를 다음 읽기 항목으로 이동할 때 사용하라. 화면 구조를 넓게 파악할 때는 Tab보다 먼저 검토하라.",
        }),
        sr.previous({
          hint: "previous는 VoiceOver 커서를 이전 읽기 항목으로 이동할 때 사용하라. 방금 지나친 항목으로 되돌아갈 때 사용하라.",
        }),

        sr.form.next({
          hint: "form.next는 다음 폼 컨트롤(입력칸, 체크박스, 셀렉트, 버튼)로 이동할 때 사용하라. 입력칸을 찾을 때 가장 먼저 검토하라.",
        }),
        sr.form.previous({
          hint: "form.previous는 이전 폼 컨트롤로 이동할 때 사용하라. 방금 지나친 입력칸이나 체크박스로 돌아갈 때 사용하라.",
        }),
        sr.heading.next({
          hint: "heading.next는 다음 제목으로 크게 이동할 때 사용하라. 페이지 구조를 빠르게 파악하거나 섹션을 건너뛸 때 사용하라.",
        }),
        sr.heading.previous({
          hint: "heading.previous는 이전 제목으로 이동할 때 사용하라. 이전 섹션으로 되돌아가 구조를 다시 잡을 때 사용하라.",
        }),
        sr.landmark.next({
          hint: "landmark.next는 다음 랜드마크 영역으로 이동할 때 사용하라. main, navigation, form 주변 큰 구조를 빠르게 찾을 때 사용하라.",
        }),
        sr.landmark.previous({
          hint: "landmark.previous는 이전 랜드마크 영역으로 이동할 때 사용하라. 지나친 큰 영역으로 돌아갈 때 사용하라.",
        }),
        sr.interact({
          hint: "interact는 현재 그룹이나 web area 안으로 들어가 더 자세히 읽거나 조작 준비를 할 때 사용하라. 위치를 찾은 뒤 실제 입력 전에 자주 필요하다.",
        }),
        sr.stopInteracting({
          hint: "stopInteracting은 현재 상호작용 문맥에서 빠져나올 때 사용하라. 깊게 들어간 뒤 다시 바깥 구조 탐색으로 돌아갈 때 사용하라.",
        }),
        sr.act({
          hint: "act는 현재 VoiceOver 커서가 가리키는 항목의 기본 동작을 실행할 때 사용하라. 버튼, 링크, 체크박스처럼 현재 항목이 명확할 때만 사용하라.",
        }),
        sr.key.arrow.down({
          hint: "ArrowDown은 현재 문맥이 화살표 탐색을 기대할 때만 사용하라. 리스트, 메뉴, 복합 위젯 안 이동이나 세로 탐색에 사용하라.",
        }),
        sr.key.arrow.left({
          hint: "ArrowLeft는 현재 문맥이 좌우 이동을 기대할 때만 사용하라. 탭, 그리드, 슬라이더 같은 복합 위젯 안 이동에 사용하라.",
        }),
        sr.key.arrow.right({
          hint: "ArrowRight는 현재 문맥이 좌우 이동을 기대할 때만 사용하라. 탭, 그리드, 슬라이더 같은 복합 위젯 안 이동에 사용하라.",
        }),
        sr.key.arrow.up({
          hint: "ArrowUp은 현재 문맥이 화살표 탐색을 기대할 때만 사용하라. 리스트, 메뉴, 복합 위젯 안에서 위쪽으로 되돌아갈 때 사용하라.",
        }),
        sr.key.enter({
          hint: "Enter는 현재 항목을 활성화하거나 제출할 때 사용하라. 현재 커서가 버튼, 링크, 명확한 컨트롤에 있을 때만 사용하라.",
        }),
        sr.key.escape({
          hint: "Escape는 열린 dialog, menu, popup을 닫거나 현재 상태를 정리할 때 사용하라. 예상치 못한 브라우저 UI가 끼어들었을 때 우선 검토하라.",
        }),
        sr.key.space({
          hint: "Space는 현재 항목을 활성화하거나 토글할 때 사용하라. 체크박스, 버튼, 토글처럼 Space 반응이 자연스러운 항목에서 사용하라.",
        }),
        // sr.key.shiftTab({
        //   hint: "Shift+Tab은 키보드 포커스를 이전 포커스 가능 요소로 이동할 때 사용하라. 주 탐색 수단이 아니며, 이미 페이지 안 키보드 포커스가 있다고 볼 근거가 있을 때만 사용하라.",
        // }),
        // sr.key.tab({
        //   hint: "Tab은 키보드 포커스를 다음 포커스 가능 요소로 이동할 때 사용하라. 주 탐색 수단이 아니며, 이미 페이지 안 키보드 포커스가 있다고 볼 근거가 있을 때만 사용하라.",
        // }),
        // sr.key.home({
        //   hint: "Home은 현재 문맥의 시작 쪽으로 크게 이동할 때 사용하라. 긴 목록이나 문맥 안에서 처음으로 빠르게 돌아갈 때 사용하라.",
        // }),
        // sr.key.end({
        //   hint: "End는 현재 문맥의 끝 쪽으로 크게 이동할 때 사용하라. 긴 목록이나 문맥 안에서 마지막으로 빠르게 이동할 때 사용하라.",
        // }),
      ],
    },
  },
});

export default config;
