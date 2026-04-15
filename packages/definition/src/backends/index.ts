export {
  BACKEND_SPEC,
  SCREEN_READER_BACKEND_IDS,
  backendSupportsPlatform,
  backendSupportsRawPerform,
  findBackendSpecById,
  formatQuotedScreenReaderBackendIdList,
  formatScreenReaderBackendIdList,
  getBackendBrowserPolicy,
  isScreenReaderBackendId,
  listBackendSpecs,
  parseScreenReaderBackendId,
} from "./source";
export {
  getGuidepupNvdaCapabilities,
  getGuidepupVirtualCapabilities,
  getGuidepupVoiceOverCapabilities,
  getScreenReaderBackendCapabilities,
  resolveGuidepupNvdaPerformCommand,
  resolveGuidepupVirtualPerformCommand,
  resolveGuidepupVoiceOverPerformCommand,
} from "./capabilities";
export type {
  NamedScreenReaderBackendSpec,
  ScreenReaderBackendId,
  ScreenReaderBackendSpec,
  ScreenReaderBackendsSupportingRawPerform,
  ScreenReaderBrowserPolicy,
} from "./source";
