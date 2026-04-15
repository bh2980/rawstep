import type {
  DiagnosticEvent,
  ScreenReaderDomFocusSnapshot,
} from "@rawstep/definition";

export type PendingDiagnosticEvent = Omit<DiagnosticEvent, "ts" | "step">;

export type ScreenReaderDomFocusCapture =
  | {
      status: "captured";
      snapshot: ScreenReaderDomFocusSnapshot;
    }
  | {
      status: "failed";
      diagnostic: PendingDiagnosticEvent;
    };

export type ScreenReaderCursorScreenshotCapture =
  | {
      status: "captured";
      sourcePath: string;
    }
  | {
      status: "disabled";
    }
  | {
      status: "unsupported" | "failed";
      diagnostic: PendingDiagnosticEvent;
    };

export type ScreenReaderTraceArtifacts = {
  domFocus?: ScreenReaderDomFocusCapture;
  cursorScreenshot?: ScreenReaderCursorScreenshotCapture;
};
