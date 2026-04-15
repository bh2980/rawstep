import type { ScreenReaderObservation } from "@rawstep/definition";
import type {
  AnnouncementReader,
  AnnouncementState
} from "./types";

export class ScreenReaderObserver {
  private previousAnnouncement?: string;
  private pendingObservation?: AnnouncementState;

  constructor(
    private readonly readAnnouncement: AnnouncementReader,
    prefetchedObservation?: AnnouncementState
  ) {
    this.pendingObservation = prefetchedObservation;
  }

  async observe(): Promise<ScreenReaderObservation> {
    const announcementState = this.pendingObservation ?? await this.readAnnouncement();
    this.pendingObservation = undefined;
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
