import type {
  ScreenReaderBackendId,
  ScreenReaderCapabilities
} from "@rawstep/action-catalog";
import { SCREEN_READER_BACKEND_CAPABILITIES } from "./generated-capabilities";

export function getScreenReaderBackendCapabilities(
  backendId: ScreenReaderBackendId
): ScreenReaderCapabilities {
  return SCREEN_READER_BACKEND_CAPABILITIES[backendId];
}
