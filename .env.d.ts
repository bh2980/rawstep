declare namespace NodeJS {
  interface ProcessEnv {
    AI_PROVIDER?: "anthropic" | "openai-compatible";
    AI_API_KEY?: string;
    AI_MODEL?: string;
    AI_BASE_URL?: string;
  }
}

export {};
