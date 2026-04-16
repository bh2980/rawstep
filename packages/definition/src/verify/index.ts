export type RequestVerificationRule = {
  requestSeen: {
    urlIncludes: string;
    method?: string;
  };
};

export type ResponseVerificationRule = {
  responseSeen: {
    urlIncludes: string;
    method?: string;
    status?: number;
  };
};

export type ActivatedAnnouncementVerificationRule = {
  activatedAnnouncementIncludes: string;
};

export type DomEventVerificationRule = {
  domEventSeen: {
    selector: string;
    event: string;
  };
};

export type VerifyRule =
  | { titleIncludes: string }
  | { urlIncludes: string }
  | { textVisible: string }
  | { textVisibleExact: string }
  | ActivatedAnnouncementVerificationRule
  | DomEventVerificationRule
  | RequestVerificationRule
  | ResponseVerificationRule;

export type VerifySpec = {
  all: VerifyRule[];
};

export { validateVerifySpec } from "./schema";
