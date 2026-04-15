import type { ScreenReaderObservation } from "@rawstep/definition";
import type {
  AnnouncementReader,
  AnnouncementState,
  ScreenReaderObserveProfileName
} from "./types";

export class ScreenReaderObserver {
  private previousAnnouncement?: string;
  private pendingInitialObservation?: AnnouncementState;
  private nextProfile: ScreenReaderObserveProfileName = "default";

  constructor(
    private readonly readAnnouncement: AnnouncementReader,
    prefetchedInitialObservation?: AnnouncementState
  ) {
    this.pendingInitialObservation = prefetchedInitialObservation;
  }

  prepareNextObservation(profile: ScreenReaderObserveProfileName): void {
    this.nextProfile = profile;
  }

  async observe(): Promise<ScreenReaderObservation> {
    const profile = this.pendingInitialObservation ? "initial" : this.nextProfile;
    this.nextProfile = "default";
    const announcementState = this.pendingInitialObservation ?? await this.readAnnouncement(profile);
    this.pendingInitialObservation = undefined;
    const observation: ScreenReaderObservation = {
      kind: "screenreader",
      announcement: announcementState.announcement,
      announcementCapture: announcementState.announcementCapture,
      announcementCount: announcementState.announcementCount,
      observeReason: announcementState.observeReason
    };

    if (this.previousAnnouncement !== undefined) {
      observation.previousAnnouncement = this.previousAnnouncement;
    }

    this.previousAnnouncement = announcementState.announcement;
    return observation;
  }
}
