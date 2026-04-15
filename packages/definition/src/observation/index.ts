import type {
  ScreenReaderMaintenanceMethod,
  ScreenReaderReadMethod,
} from "@rawstep/action-catalog";

export type ScrollHint = "top" | "middle" | "bottom";

export type ScreenReaderReadback = {
  method: ScreenReaderReadMethod | ScreenReaderMaintenanceMethod;
  value?: string | string[];
  status?: "cleared";
};

export type ScreenReaderDomFocusSnapshot = {
  hasDocumentFocus: boolean;
  targetTagName?: string;
  targetId?: string;
  targetType?: string;
  targetName?: string;
  targetRole?: string;
  targetLabel?: string;
  targetText?: string;
  targetSelector?: string;
};

export type ScreenReaderCursorScreenshot = {
  sourcePath: string;
};

export type KeyboardObservation = {
  kind: "keyboard";
  screenshot: {
    pngBase64: string;
    viewport: { w: number; h: number };
  };
  previousScreenshot?: { pngBase64: string };
  browserChrome: {
    title: string;
    urlPath: string;
  };
  focusHint?: string;
  scrollHint?: ScrollHint;
};

export type ScreenReaderObservation = {
  kind: "screenreader";
  announcement: string;
  announcementCapture: "log" | "fallback" | "none" | "synthetic";
  announcementCount?: number;
  observeReason?: "silence" | "timeout" | "fallback" | "synthetic";
  previousAnnouncement?: string;
  readbacks?: ScreenReaderReadback[];
  domFocus?: ScreenReaderDomFocusSnapshot;
  cursorScreenshot?: ScreenReaderCursorScreenshot;
};

export type Observation = KeyboardObservation | ScreenReaderObservation;
