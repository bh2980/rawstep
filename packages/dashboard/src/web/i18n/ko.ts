import type { Hint, ObservedChange } from '../../shared/api';
import type { RunState } from '../../shared/config';

type HintKind = Hint['kind'];

/**
 * Dashboard strings. Rawstep is not a pass/fail runner: run states describe whether the goal was reached,
 * and friction hints carry most of the meaning.
 */
export const ko = {
  app: {
    title: 'rawstep',
    skip: '본문으로 이동',
    loadingTitle: '프로젝트를 불러오는 중',
    loadingBody: '로컬 Node 서비스의 연결 상태를 확인하고 있습니다.',
    errorTitle: '처리하지 못했습니다',
    reload: '편집을 버리고 다시 불러오기',
    saved: '프로젝트 파일에 저장했습니다.',
    requestFailed: '요청 실패',
  },
  topBar: {
    connected: '서버 연결됨',
    reconnecting: '재연결 중',
    counts: (running: number, queued: number) => `${running} 실행 중 · ${queued} 대기`,
    newExperiment: '새 실험',
    settings: '설정',
    settingsLabel: '설정 열기',
    openNavigation: '작업과 실행 목록 열기',
    local: 'LOCAL',
  },
  sidebar: {
    label: '작업과 실행',
    tasks: '작업',
    addTask: '작업 추가',
    importTask: '기존 Task JSON 가져오기',
    search: '검색',
    searchPlaceholder: '작업·모델·프롬프트 검색',
    filter: '보기',
    filters: { all: '전체', hints: '힌트 있음', running: '실행 중', missed: '목표 미도달' },
    tree: '작업, 조합, 실행 트리',
    empty: '표시할 작업이나 실행이 없습니다.',
    emptyFiltered: '조건에 맞는 실행이 없습니다.',
    noRuns: '아직 실행이 없습니다',
    runCount: (n: number) => `실행 ${n}개`,
    liveCount: (n: number) => `${n}개 실행 중`,
    repeat: (n: number) => `반복 #${n}`,
    steps: (n: number) => `${n} 스텝`,
    hintsLoading: '힌트 확인 중',
    treeHelp: '화살표 키로 이동하고 Enter로 선택합니다.',
    unnamedTask: '이름 없는 작업',
    modes: { keyboard: '키보드', screenreader: '스크린리더' },
  },
  runStates: {
    queued: '대기',
    running: '실행 중',
    success: '목표 도달',
    failure: '목표 미도달',
    inconclusive: '판단 불가',
    cancelled: '취소됨',
    interrupted: '중단됨',
  } satisfies Record<RunState, string>,
  overview: {
    title: '개요',
    description: '작업 × 모델 조합마다 목표 도달 여부와 자주 나온 마찰 힌트를 요약합니다. 행을 선택하면 해당 작업으로 이동합니다.',
    caption: '작업 × 모델 × 모드별 실행 요약',
    empty: '아직 실행한 기록이 없습니다.',
    emptyHint: '상단의 새 실험 버튼으로 작업과 모델을 조합해 실행해 보세요.',
    columns: { task: '작업', model: '모델', mode: '모드', runs: '실행', reached: '목표 도달', median: '중앙 스텝', reference: '참조 스텝', hints: '자주 나온 힌트' },
    runsOf: (finished: number, total: number) => `${total}개 (완료 ${finished})`,
    reachedOf: (reached: number, finished: number) => `${reached} / ${finished}`,
    noHints: '없음',
    openLatest: '최근 실행 열기',
    referenceHelp: '목표에 도달한 가장 짧은 실행의 스텝 수',
    loadFailed: '개요를 불러오지 못했습니다.',
  },
  task: {
    runsTitle: '이 작업의 실행',
    runsEmpty: '이 작업으로 실행한 기록이 없습니다.',
    runsCaption: '이 작업의 실행 목록',
    columns: { started: '시작', condition: '모델 · 프롬프트 · 환경', state: '상태', steps: '스텝', hints: '힌트' },
    selectFirst: '왼쪽에서 작업을 선택하세요.',
    unknown: '작업 정보를 찾을 수 없습니다. 이 작업은 설정에서 삭제되었을 수 있습니다.',
    importTitle: '기존 Task JSON 가져오기',
    importDescription: '프로젝트 안에 있는 Task JSON 파일을 작업 목록에 등록합니다.',
    importPath: '가져올 Task 경로',
    importPathHint: '프로젝트 내부 JSON 경로',
    importAction: '가져오기',
    importFallbackName: '가져온 작업',
    newName: '새 작업',
  },
  run: {
    notFound: '선택한 실행을 찾을 수 없습니다.',
    backToOverview: '개요로 돌아가기',
    steps: (n: number) => `${n} 스텝`,
    duration: (seconds: string) => `${seconds}초`,
    facts: { state: '상태', steps: '스텝', duration: '소요 시간', reference: '참조 대비' },
    versus: (extra: number) => extra === 0 ? '참조와 같은 스텝' : extra > 0 ? `참조 대비 +${extra} 스텝` : `참조 대비 ${extra} 스텝`,
    cancel: '취소',
    retry: '같은 조건으로 재실행',
    openReport: '보고서 열기',
    downloadTrace: 'trace 다운로드',
    downloadAnalysis: '분석 다운로드',
    downloadStopReason: '중단 진단 다운로드',
    stopQueue: '큐 중지',
    simulationNotice: '모의 VoiceOver 실행입니다. 실제 네이티브 발화 검증 결과가 아닙니다.',
    serverPromptNotice: '이 /choose 서버는 지침을 소유합니다. UI의 기본 지침은 실제 적용 문구를 의미하지 않으며, 프롬프트 편집 실행은 제한됩니다.',
    outcome: (status: string, reason: string) => `기록된 실행 결과: ${status} · ${reason}`,
    noReason: '—',
    tabsLabel: '실행 상세 보기',
    tabs: { hints: '힌트', steps: '단계', compare: '비교', events: '기록' },
    retryTitle: '같은 조건으로 재실행',
    retryBody: '모델·프롬프트·허용 행동·환경은 기존 실행의 설정을 사용합니다. 입력값은 현재 작업 파일에서 다시 읽습니다.',
    retryChanged: (fields: string) => `현재 작업 파일과 다른 항목: ${fields}`,
    retryUnchanged: '입력값 외 작업 조건에 변경이 없습니다.',
    retryDiff: '작업 조건 차이 확인',
    retryOriginal: '기존',
    retryCurrent: '현재',
    retryConfirm: '기존 조건으로 실행',
    close: '닫기',
    noTaskFile: '이 초기 기록에는 원본 Task 파일 경로가 없습니다. 새 실험에서 새 실행을 구성하세요.',
  },
  hints: {
    title: '마찰 힌트',
    empty: '마찰 힌트가 없습니다',
    emptyBody: '이 실행에서는 눈에 띄는 마찰이 기록되지 않았습니다. 힌트는 판정이 아니라 사람이 살펴볼 지점을 가리킵니다.',
    pending: '실행이 끝나면 마찰 힌트를 계산합니다. 단계 탭에서 진행 중인 기록을 볼 수 있습니다.',
    loadFailed: '힌트를 불러오지 못했습니다.',
    observed: '관찰됨',
    observedHelp: '기록된 사실에서 바로 확인한 항목입니다.',
    suspected: '추정',
    suspectedHelp: '간접 신호에서 추정한 항목으로, 틀릴 수 있습니다.',
    goToStep: (n: number) => `단계 ${n}`,
    goToStepLabel: (n: number) => `단계 ${n}로 이동`,
    stepsLabel: '관련 단계',
    limitations: '해석할 때 유의할 점',
    liveLine: '실행 중인 기록에서 계산한 임시 힌트입니다. 실행이 끝나면 확정됩니다.',
    reachedLine: '목표에 도달했지만 아래 지점을 살펴볼 만합니다.',
    notReachedLine: '목표에 도달하지 못했습니다. 아래 지점이 원인과 관련 있는지 살펴보세요.',
    unknownLine: '목표 도달 여부를 판단하지 못했습니다.',
    referenceLine: (steps: number, referenceSteps: number) => `이 실행 ${steps} 스텝 · 참조 ${referenceSteps} 스텝`,
    kinds: {
      'slow-run': '참조보다 오래 걸림',
      'excess-keystrokes': '키 입력 과다',
      'backtracking': '되돌아감',
      'repeated-state': '같은 화면 반복',
      'focus-lost': '포커스 사라짐',
      'focus-not-visible': '포커스가 보이지 않음',
      'modal-focus-outside': '대화상자 밖 포커스',
      'missing-announcement': '안내 없음',
      'invisible-focus-change': '화면 변화 없는 포커스 이동',
      'model-hesitation': '모델 망설임',
      'early-stop': '일찍 중단',
      'goal-met-at-start': '시작부터 목표 충족',
      'focus-left-page': '포커스가 페이지 밖으로',
    } satisfies Record<HintKind, string>,
  },
  steps: {
    title: '단계별 기록',
    empty: '아직 기록된 단계가 없습니다.',
    loadFailed: '단계 기록을 불러오지 못했습니다.',
    live: '실행 중 · 새 단계가 기록되면 자동으로 갱신합니다',
    start: '시작 화면',
    stepNumber: (n: number) => `단계 ${n}`,
    baselineTrue: (n: number) => `시작 시점에 이미 참인 목표 규칙 ${n}개`,
    baselineNone: '시작 시점에 이미 참인 목표 규칙 없음',
    baselineAll: '목표 규칙이 모두 시작 시점에 충족되어 있었습니다.',
    screenshot: (n: number) => `단계 ${n} 화면`,
    screenshotOpen: (n: number) => `단계 ${n} 화면 크게 보기`,
    screenshotMissing: '화면을 불러오지 못했습니다',
    screenshotDialog: '화면 크게 보기',
    redacted: '입력 보호로 가림',
    redactedBody: '민감할 수 있는 값은 기록과 화면에서 가렸습니다.',
    actionFailed: '행동 실패',
    stop: (reason: string) => `중단 · ${reason}`,
    stopSource: (source: string) => `판단 주체 ${source}`,
    modelScores: '모델 점수(보정 안 됨)',
    modelScoresHelp: '모델이 후보마다 낸 점수이며 확률로 해석하면 안 됩니다.',
    chosen: '선택',
    candidateCount: (n: number) => `후보 ${n}개`,
    showAllCandidates: (n: number) => `후보 ${n}개 모두 보기`,
    inference: (ms: number) => `추론 ${ms}ms`,
    observed: '관찰된 변화',
    noObserved: '기록된 변화 없음',
    verification: '목표 규칙',
    verificationCount: (met: number, total: number) => `${total}개 중 ${met}개 충족`,
    ruleMet: '충족',
    ruleUnmet: '미충족',
    speech: '스크린리더 발화',
    speechSimulation: '시뮬레이션',
    speechNative: '네이티브',
    speechUnspecified: '출처 미상',
    hints: '이 단계의 힌트',
    jumpHighlight: '선택한 단계',
    keyAction: (key: string) => key,
    typeText: (name: string) => name ? `텍스트 입력 ${name}` : '텍스트 입력',
    replaceText: (name: string) => name ? `텍스트 교체 ${name}` : '텍스트 교체',
    intents: { next: '다음 항목', previous: '이전 항목', activate: '활성화' } as Record<string, string>,
    unknownAction: '행동',
  },
  observed: {
    focus: (target: string) => `포커스 → ${target}`,
    focusLost: '포커스 사라짐',
    pageBlur: '포커스가 페이지 밖으로',
    pageFocus: '포커스가 페이지로 돌아옴',
    liveRegion: (text: string) => `라이브 영역: “${text}”`,
    liveRegionEmpty: '라이브 영역 갱신',
    appeared: (target: string) => `${target} 나타남`,
    disappeared: (target: string) => `${target} 사라짐`,
    dialogAppeared: '대화상자 나타남',
    state: (attr: string, value: string, target: string) => `${target} ${attr}=${value}`,
    navigation: (url: string) => `이동 → ${url}`,
    submit: (target: string) => `제출 ${target}`,
    element: '요소',
  },
  compare: {
    title: '참조 실행과 비교',
    description: '같은 작업·모드에서 목표에 도달한 가장 짧은 실행을 기준으로, 단계 번호에 맞춰 나란히 봅니다.',
    thisRun: '이 실행',
    referenceRun: '참조 실행',
    stepColumn: '단계',
    none: '비교할 참조 실행이 아직 없습니다',
    noneBody: '같은 작업·모드에서 목표에 도달한 실행이 생기면 가장 짧은 실행을 기준으로 비교합니다. 아직 목표에 도달한 실행이 없어 이 실행이 어디서 길어졌는지 비교할 수 없습니다.',
    diverged: '처음 달라진 단계',
    identical: '두 실행의 행동이 단계 끝까지 같습니다.',
    divergedAt: (n: number) => `단계 ${n}에서 처음 달라졌습니다.`,
    openReference: '참조 실행 열기',
    missing: '— 이 단계 없음 —',
    loading: '참조 실행을 불러오는 중',
    loadFailed: '참조 실행의 단계를 불러오지 못했습니다.',
    caption: '단계 번호별 두 실행의 행동 비교',
    stepCount: (n: number) => `${n} 스텝`,
  },
  events: {
    title: (n: number) => `원본 기록 ${n}개`,
    description: '저장된 trace 이벤트 원본입니다. 새 이벤트가 기록되면 자동으로 갱신합니다.',
    empty: '기록된 이벤트가 없습니다.',
    loadFailed: '이벤트를 불러오지 못했습니다.',
    redacted: '가림 처리',
    keyboardObservation: (seq: number) => `키보드 관찰 단계 ${seq}`,
    showMore: (n: number) => `${n}개 더 보기`,
    settings: '적용한 설정과 프롬프트',
  },
  newExperiment: {
    title: '새 실험',
    description: '작업 × 모델 × 프롬프트 × 환경을 조합해 같은 조건에서 비교합니다.',
  },
  settings: {
    title: '설정',
    description: '모델 연결과 전역 실행 설정을 관리합니다.',
    tabs: { models: '연결과 모델', globals: '전역 설정' },
    tabsLabel: '설정 구역',
  },
  live: {
    running: '실행 중',
  },
} as const;

export type Messages = typeof ko;

export function hintKindLabel(kind: string): string {
  return (ko.hints.kinds as Record<string, string>)[kind] ?? kind;
}

export function runStateLabel(state: string): string {
  return (ko.runStates as Record<string, string>)[state] ?? state;
}

/** Short text for one page-observer change, for chips in the step timeline. */
export function describeChange(change: ObservedChange): string {
  const target = describeTarget(change);
  switch (change.kind) {
    case 'focus': return ko.observed.focus(target);
    case 'focus-lost': return ko.observed.focusLost;
    case 'page-blur': return ko.observed.pageBlur;
    case 'page-focus': return ko.observed.pageFocus;
    case 'live-region': return change.text ? ko.observed.liveRegion(change.text) : ko.observed.liveRegionEmpty;
    case 'appeared': return change.role === 'dialog' || change.role === 'alertdialog' ? ko.observed.dialogAppeared : ko.observed.appeared(target);
    case 'disappeared': return ko.observed.disappeared(target);
    case 'state': return ko.observed.state(change.attr ?? '', String(change.value ?? ''), target);
    case 'navigation': return ko.observed.navigation(change.url ?? '');
    case 'submit': return ko.observed.submit(target);
    default: return change.kind;
  }
}

function describeTarget(change: ObservedChange): string {
  const role = change.role ?? ko.observed.element;
  return change.name ? `${role} “${change.name}”` : role;
}
