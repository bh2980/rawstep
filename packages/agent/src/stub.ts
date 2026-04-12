import type {
  AgentContext,
  AgentMemoryEntry,
  Decision,
  Observation
} from "@a11y-task/core";
import { withOptionalRationale } from "./parser";

export function decideWithStub(
  ctx: AgentContext | undefined,
  obs: Observation | undefined,
  fullMemory: AgentMemoryEntry[] | undefined,
  includeRationale = false
): Decision {
  const memory = fullMemory ?? ctx?.memory ?? [];

  if (!obs || obs.kind !== "keyboard") {
    return includeRationale
      ? {
          verdict: "stuck",
          rationale: "Stub agent only supports keyboard observations."
        }
      : { verdict: "stuck" };
  }

  const title = obs.browserChrome.title;
  const stepCount = memory.length;

  if (title.includes("Completed") || title.includes("Closed")) {
    return {
      verdict: "success",
      ...withOptionalRationale(includeRationale ? "관찰 가능한 브라우저 제목이 목표 달성 상태로 바뀌었다." : undefined)
    };
  }

  if (title.includes("Dialog Open")) {
    return {
      action: { key: "Escape" },
      ...withOptionalRationale(includeRationale ? "Dialog가 열린 상태로 보이므로 Escape로 닫기를 시도한다." : undefined)
    };
  }

  if (title.includes("Simple CTA Fixture")) {
    if (stepCount < 2) {
      return {
        action: { key: "Tab" },
        ...withOptionalRationale(includeRationale ? "CTA 버튼 전까지 포커스를 이동하기 위해 Tab을 누른다." : undefined)
      };
    }

    if (stepCount === 2) {
      return {
        action: { key: "Enter" },
        ...withOptionalRationale(includeRationale ? "목표 CTA에 도달했다고 가정하고 활성화한다." : undefined)
      };
    }
  }

  if (title.includes("Modal Fixture")) {
    if (stepCount === 0) {
      return {
        action: { key: "Tab" },
        ...withOptionalRationale(includeRationale ? "Dialog를 여는 첫 버튼으로 이동하기 위해 Tab을 누른다." : undefined)
      };
    }

    if (stepCount === 1) {
      return {
        action: { key: "Enter" },
        ...withOptionalRationale(includeRationale ? "열기 버튼을 활성화한다." : undefined)
      };
    }
  }

  if (title.includes("Bad Focus Fixture")) {
    if (stepCount < 4) {
      return {
        action: { key: "Tab" },
        ...withOptionalRationale(includeRationale ? "포커스를 찾기 위해 계속 Tab으로 탐색한다." : undefined)
      };
    }

    return {
      verdict: "stuck",
      ...withOptionalRationale(includeRationale ? "포커스 단서를 찾지 못해 더 진행할 수 없다." : undefined)
    };
  }

  return {
    verdict: "stuck",
    ...withOptionalRationale(includeRationale ? "Stub agent does not know how to solve this task." : undefined)
  };
}
