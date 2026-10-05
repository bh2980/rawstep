export type EnvironmentProfile = {
  id: string;
  viewport: { width: number; height: number };
  browserZoom: number;
  textScale: number;
  textSpacing?: { lineHeight: number; letterSpacingEm: number; wordSpacingEm: number; paragraphSpacingEm: number };
  colorScheme: 'light' | 'dark' | 'no-preference';
  forcedColors: 'none' | 'active';
  contrast: 'no-preference' | 'more';
  reducedMotion: 'no-preference' | 'reduce';
  nativeMagnifier: 'not-requested' | 'required';
  nativeHighContrast: 'not-requested' | 'required';
  at?: { name: string; version?: string; configuration?: string };
  diagnostics: boolean;
  /** Refuse runs whose requested environment cannot be independently observed. */
  requireApplied: boolean;
};
export type ProfileSetting = { name: string; requested: unknown; observed?: unknown; status: 'applied' | 'unsupported' | 'mismatch' | 'not-requested'; mechanism: 'browser-native' | 'browser-media-emulation' | 'browser-content-user-style' | 'viewport' | 'native-os' | 'metadata'; detail?: string };
export type AppliedProfile = { profile: EnvironmentProfile; settings: ProfileSetting[]; supported: boolean; verifiedAt: string; browser: string; browserVersion: string; platform: string; limitations: string[] };
export type DiagnosticFinding = { code: string; certainty: 'observed-condition' | 'suspected'; detail: string; node?: string };
export type BrowserDiagnostic = {
  kind: 'independent-browser-diagnostic';
  /** Never exposed to the decision policy. */
  policyVisible: false;
  documentId: string;
  viewport: { width: number; height: number; documentWidth: number; scrollX: number; scrollY: number };
  focus: { identity: string | null; id: string | null; tag: string | null; role: string | null; visible: boolean; inViewport: boolean; centerOccluded: boolean; indicator: 'style-detected' | 'not-detected' | 'unknown'; outline?: string; shadow?: string; rect?: { x: number; y: number; width: number; height: number } };
  modal: { open: boolean; focusInside: boolean; id: string | null };
  findings: DiagnosticFinding[];
  errorState: { invalidCount: number; alertCount: number };
  limitations: string[];
};
