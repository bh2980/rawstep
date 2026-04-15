export const AGENT_PROVIDER_VALUES = ["anthropic", "openai-compatible"] as const;

export type AgentProvider = (typeof AGENT_PROVIDER_VALUES)[number];

export function isAgentProvider(value: unknown): value is AgentProvider {
  return typeof value === "string"
    && (AGENT_PROVIDER_VALUES as readonly string[]).includes(value);
}

export function parseAgentProvider(value: unknown): AgentProvider {
  if (isAgentProvider(value)) {
    return value;
  }

  throw new Error(
    `Unsupported agent provider: ${String(value)}. Expected one of ${AGENT_PROVIDER_VALUES.join(", ")}.`
  );
}
