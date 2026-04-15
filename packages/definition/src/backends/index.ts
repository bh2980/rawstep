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
  getScreenReaderBackendCapabilities,
} from "./capabilities";
export type {
  NamedScreenReaderBackendSpec,
  ScreenReaderBackendId,
  ScreenReaderBackendSpec,
  ScreenReaderBackendsSupportingRawPerform,
  ScreenReaderBrowserPolicy,
} from "./source";
