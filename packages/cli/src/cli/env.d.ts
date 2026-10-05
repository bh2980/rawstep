declare namespace NodeJS {
  interface ProcessEnv {
    RAWSTEP_DECISION_PROVIDER?: 'vercel-evaluation' | 'systemone-http' | 'openrouter-systemone';
    RAWSTEP_DECISION_BASE_URL?: string;
    RAWSTEP_DECISION_API_KEY?: string;
    RAWSTEP_DECISION_OPENROUTER_API_KEY?: string;
    RAWSTEP_DECISION_MODEL?: string;
    RAWSTEP_DECISION_INPUTS?: 'text' | 'text,image';
    RAWSTEP_ANALYSIS_PROVIDER?: 'openai-compatible';
    RAWSTEP_ANALYSIS_BASE_URL?: string;
    RAWSTEP_ANALYSIS_API_KEY?: string;
    RAWSTEP_ANALYSIS_MODEL?: string;
  }
}
