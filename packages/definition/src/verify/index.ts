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

export type VerifyRule =
  | { titleIncludes: string }
  | { urlIncludes: string }
  | { textVisible: string }
  | RequestVerificationRule
  | ResponseVerificationRule;

export type VerifySpec = {
  all: VerifyRule[];
};
