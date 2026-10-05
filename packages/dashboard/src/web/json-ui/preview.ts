import { parseDashboardSpec } from '../../shared/ui-catalog';
import keyboard from '../specs/keyboard-permissions.json';
import screenreader from '../specs/screenreader-permissions.json';

export const previewSpecs = {
  keyboard: parseDashboardSpec(keyboard),
  screenreader: parseDashboardSpec(screenreader),
};

export type PreviewMode = keyof typeof previewSpecs;
export const previewDefaults = {
  keyboard: { forward: true, backward: true, extraNavigation: false, activate: true, textEntry: false, replaceText: false },
  screenreader: { forward: true, backward: true, extraNavigation: true, activate: true, textEntry: false, replaceText: false },
};

export const previewLabels = {
  keyboard: { forward: 'Tab', backward: 'Shift+Tab', extraNavigation: '방향키 · 페이지 이동', activate: 'Enter · Space', textEntry: '텍스트 입력', replaceText: '기존 값 교체' },
  screenreader: { forward: '다음 항목', backward: '이전 항목', extraNavigation: '제목 · 폼 탐색', activate: '활성화', textEntry: '텍스트 입력', replaceText: '기존 값 교체' },
};
