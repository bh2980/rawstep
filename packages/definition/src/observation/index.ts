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
};

export type Observation = KeyboardObservation | ScreenReaderObservation;
