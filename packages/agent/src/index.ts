import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_KEYS,
  isAllowedKey,
  type Agent,
  type AgentContext,
  type Decision,
  type KeyboardObservation,
  type Observation,
  type UserModel
} from "@a11y-task/core";

const DEFAULT_BACKEND = "anthropic";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

export type AgentBackend = "anthropic" | "stub";

export type LLMAgentOptions = {
  backend?: AgentBackend;
  apiKey?: string;
  model?: string;
};

export class LLMAgent implements Agent {
  private readonly backend: AgentBackend;
  private readonly model: string;
  private readonly client?: Anthropic;

  constructor(
    private readonly userModel: UserModel,
    options: LLMAgentOptions = {}
  ) {
    this.backend = options.backend ?? ((process.env.A11Y_TASK_AGENT_MODE as AgentBackend | undefined) ?? DEFAULT_BACKEND);
    this.model = options.model ?? process.env.A11Y_TASK_ANTHROPIC_MODEL ?? DEFAULT_MODEL;

    if (this.backend === "anthropic") {
      const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is required for the Anthropic agent. Set A11Y_TASK_AGENT_MODE=stub for local fixture smoke tests."
        );
      }

      this.client = new Anthropic({ apiKey });
    }
  }

  async decide(ctx: AgentContext, obs: Observation): Promise<Decision> {
    if (this.backend === "stub") {
      return decideWithStub(ctx, obs);
    }

    const client = this.client;
    if (!client) {
      throw new Error("Anthropic client was not initialized.");
    }

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 400,
      system: buildSystemPrompt(this.userModel),
      messages: [
        {
          role: "user",
          content: buildAnthropicContent(ctx, obs)
        }
      ]
    });

    const rawText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return parseDecision(rawText);
  }
}

export function buildSystemPrompt(userModel: UserModel): string {
  return [
    `너는 ${userModel} 사용자를 시뮬레이션한다.`,
    `너에게 허용된 키는 ${ALLOWED_KEYS.join(", ")} 뿐이다.`,
    "너는 DOM, 셀렉터, 접근성 트리에 접근할 수 없다.",
    '너는 한 턴에 action 또는 verdict 중 하나만 반환한다.',
    'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
  ].join("\n");
}

export function parseDecision(raw: string): Decision {
  const snippet = raw.trim().slice(0, 240);

  try {
    const candidate = JSON.parse(extractJsonObject(raw)) as {
      action?: { key?: string };
      verdict?: string;
      rationale?: string;
    };

    const rationale = typeof candidate.rationale === "string" && candidate.rationale.trim()
      ? candidate.rationale.trim()
      : "Agent returned an empty rationale.";

    const hasAction = candidate.action !== undefined;
    const hasVerdict = candidate.verdict !== undefined;

    if (hasAction === hasVerdict) {
      return malformedDecision(snippet);
    }

    if (candidate.action) {
      const key = candidate.action.key;
      if (!key || !isAllowedKey(key)) {
        return malformedDecision(snippet);
      }

      return {
        action: { key },
        rationale
      };
    }

    if (candidate.verdict === "success" || candidate.verdict === "stuck") {
      return {
        verdict: candidate.verdict,
        rationale
      };
    }

    return malformedDecision(snippet);
  } catch {
    return malformedDecision(snippet);
  }
}

function malformedDecision(snippet: string): Decision {
  return {
    verdict: "stuck",
    rationale: `agent returned malformed decision: ${snippet || "<empty response>"}`
  };
}

function extractJsonObject(raw: string): string {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return raw.trim();
}

function buildAnthropicContent(ctx: AgentContext, obs: Observation): Anthropic.MessageParam["content"] {
  const blocks: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text: buildUserPromptText(ctx, obs)
    }
  ];

  if (obs.kind === "keyboard") {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: obs.screenshot.pngBase64
      }
    });

    if (obs.previousScreenshot) {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: obs.previousScreenshot.pngBase64
        }
      });
    }
  }

  return blocks;
}

function buildUserPromptText(ctx: AgentContext, obs: Observation): string {
  const observationForPrompt =
    obs.kind === "keyboard"
      ? {
          kind: obs.kind,
          browserChrome: obs.browserChrome,
          scrollHint: obs.scrollHint,
          screenshot: {
            viewport: obs.screenshot.viewport
          },
          hasPreviousScreenshot: Boolean(obs.previousScreenshot)
        }
      : obs;

  return [
    `goal: ${ctx.goal}`,
    `recent history: ${JSON.stringify(ctx.history)}`,
    `observation: ${JSON.stringify(observationForPrompt)}`
  ].join("\n");
}

function decideWithStub(ctx: AgentContext, obs: Observation): Decision {
  if (obs.kind !== "keyboard") {
    return {
      verdict: "stuck",
      rationale: "Stub agent only supports keyboard observations."
    };
  }

  const title = obs.browserChrome.title;
  const stepCount = ctx.history.length;

  if (title.includes("Completed") || title.includes("Closed")) {
    return {
      verdict: "success",
      rationale: "관찰 가능한 브라우저 제목이 목표 달성 상태로 바뀌었다."
    };
  }

  if (title.includes("Dialog Open")) {
    return {
      action: { key: "Escape" },
      rationale: "Dialog가 열린 상태로 보이므로 Escape로 닫기를 시도한다."
    };
  }

  if (title.includes("Simple CTA Fixture")) {
    if (stepCount < 2) {
      return {
        action: { key: "Tab" },
        rationale: "CTA 버튼 전까지 포커스를 이동하기 위해 Tab을 누른다."
      };
    }

    if (stepCount === 2) {
      return {
        action: { key: "Enter" },
        rationale: "목표 CTA에 도달했다고 가정하고 활성화한다."
      };
    }
  }

  if (title.includes("Modal Fixture")) {
    if (stepCount === 0) {
      return {
        action: { key: "Tab" },
        rationale: "Dialog를 여는 첫 버튼으로 이동하기 위해 Tab을 누른다."
      };
    }

    if (stepCount === 1) {
      return {
        action: { key: "Enter" },
        rationale: "열기 버튼을 활성화한다."
      };
    }
  }

  if (title.includes("Bad Focus Fixture")) {
    if (stepCount < 4) {
      return {
        action: { key: "Tab" },
        rationale: "포커스를 찾기 위해 계속 Tab으로 탐색한다."
      };
    }

    return {
      verdict: "stuck",
      rationale: "포커스 단서를 찾지 못해 더 진행할 수 없다."
    };
  }

  return {
    verdict: "stuck",
    rationale: "Stub agent does not know how to solve this task."
  };
}
