import { ProjectError } from '@rawstep/project/errors';

export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** The Korean text the dashboard shows for each ProjectError code; an unlisted code falls back to a generic message. */
const korean: Record<string, string> = {
  'no-config': '프로젝트에 rawstep.config.json이 없습니다.',
  'invalid-config': '설정 파일 형식이 잘못되었습니다.',
  'config-conflict': '설정이 외부 또는 다른 창에서 변경되었습니다. 다시 불러온 뒤 변경을 적용하세요.',
  'duplicate-id': 'ID가 중복되었습니다.',
  'analysis-needs-llm': '사후 분석에는 LLM 모델을 선택하세요.',
  'duplicate-task-file': '작업 파일 경로가 중복되었습니다.',
  'duplicate-prompt-id': '프롬프트 ID가 중복되었습니다.',
  'task-profile-missing': '작업의 실행 프로필을 찾을 수 없습니다.',
  'path-outside-project': '프로젝트 내부의 파일 경로가 필요합니다.',
  'symlink-outside-project': '프로젝트 밖의 심볼릭 링크나 외부 파일은 사용할 수 없습니다.',
  'task-file-missing': '작업 파일을 찾을 수 없습니다.',
  'task-not-found': '작업을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.',
  'task-file-reserved': '설정·패키지·실행 기록 파일을 Task로 사용할 수 없습니다.',
  'task-file-not-registered': '등록한 Task JSON 경로가 필요합니다.',
  'task-file-exists': '이 경로의 파일이 이미 있습니다. 기존 JSON 가져오기를 사용하거나 새 경로를 지정하세요.',
  'invalid-credential': '인증키 형식이 잘못되었습니다.',
  'credential-target': '인증키를 저장할 환경변수 이름이 없습니다. 사용자 지정 모델에 환경변수 이름을 먼저 지정하세요.',
  'missing-credential': '모델의 인증키가 설정되지 않았습니다. 모델 설정에서 인증키를 입력하세요.',
  'invalid-provider': '이 종류의 모델에서 쓸 수 없는 제공자입니다.',
  'invalid-base-url': '서버 주소는 https:// 주소여야 합니다(이 컴퓨터의 서버는 http:// 도 가능). 인증 정보나 쿼리는 넣을 수 없습니다.',
  'model-http': '모델 서버가 오류 응답을 보냈습니다. 응답 본문은 표시하지 않습니다.',
  'model-empty': '응답이 없습니다.',
  'model-too-large': '모델 응답 크기 제한 초과',
  'model-json': '모델 서버 JSON 형식 오류',
  'model-unreachable': '모델 서버에 연결할 수 없습니다. 주소와 서버 상태를 확인하세요.',
  'model-list-missing': '모델 목록 API가 없습니다. 명시적인 모델 ID와 입력 지원을 수동으로 등록하세요.',
  'unsupported-action': '이 백엔드가 지원하지 않는 행동이 선택되었습니다.',
  'unknown-input': '작업에 없는 입력 이름이 선택되었습니다.',
  'analysis-only-model': '분석 전용 모델입니다.',
  'model-needs-images': '키보드 실행에는 현재·이전 이미지를 지원하는 모델이 필요합니다.',
  'model-needs-text': '스크린리더 실행에는 텍스트 입력 지원이 필요합니다.',
  'too-many-choices': '선택한 행동의 후보 수가 모델 지원 범위를 초과합니다.',
  'focus-gate-llm': '확률 기반 포커스 제한은 결정 모델만 지원합니다. 실행 프로필이나 작업 설정에서 해제하세요.',
  'voiceover-macos': 'VoiceOver는 macOS에서 실행하세요.',
  'nvda-windows': 'NVDA는 Windows에서 실행하세요.',
  'endpoint-not-loopback': '실제 실행에는 이 호스트의 loopback AT Driver WebSocket 주소가 필요합니다.',
  'environment-unsupported': '이 대시보드 백엔드는 네이티브 확대·OS 대비 환경을 적용할 수 없습니다.',
  'analysis-model-invalid': 'LLM 분석 모델을 선택하세요.',
  'diagnose-keyboard-only': '중단 진단은 마지막 스크린샷을 사용하는 키보드 모드 전용입니다.',
};
/** The dashboard's text for a project error. */
export const koreanMessage = (error: ProjectError) => korean[error.code] ?? '요청을 처리하지 못했습니다. 프로젝트 파일과 설정을 확인하세요.';
/** Maps a project failure to the HTTP error the API answers with; anything else is returned unchanged. */
export function toHttpError(error: unknown): unknown { return error instanceof ProjectError ? new HttpError(error.status, koreanMessage(error)) : error; }
