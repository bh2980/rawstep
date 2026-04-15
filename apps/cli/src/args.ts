import { resolve } from "node:path";
import {
  formatRunCommandUsage,
  RUN_COMMAND_ARG_MANIFEST,
  type RunPlanCliOverrides
} from "@rawstep/config";

export function parseRunArgs(argv: string[]): RunPlanCliOverrides {
  if (argv.length === 0) {
    throw new Error(`Missing task file. ${formatRunCommandUsage()}`);
  }

  const taskFile = argv[0];
  const overrides: RunPlanCliOverrides = { taskFile };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const matched = matchManifestEntry(token);
    if (!matched) {
      throw new Error(`Unknown argument: ${token}`);
    }

    if (matched.kind === "toggle") {
      overrides[matched.field] = matched.value as never;
      continue;
    }

    const next = argv[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${token}.`);
    }

    const parsed = matched.resolvePath
      ? resolve(String(matched.parse(next, token)))
      : matched.parse(next, token);
    overrides[matched.field] = parsed as never;
    index += 1;
  }

  return overrides;
}

export function printUsage(): void {
  process.stderr.write(`${formatRunCommandUsage()}\n`);
}

function matchManifestEntry(token: string):
  | {
    kind: "value";
    field: Exclude<keyof RunPlanCliOverrides, "taskFile">;
    parse: (value: string, label: string) => unknown;
    resolvePath?: boolean;
  }
  | {
    kind: "toggle";
    field: Exclude<keyof RunPlanCliOverrides, "taskFile">;
    value: unknown;
  }
  | undefined {
  for (const entry of RUN_COMMAND_ARG_MANIFEST) {
    if (entry.flag === token) {
      if (entry.kind === "toggle") {
        return {
          kind: "toggle",
          field: entry.field,
          value: entry.positiveValue
        };
      }

      return entry;
    }

    if (entry.kind === "toggle" && entry.negativeFlag === token) {
      return {
        kind: "toggle",
        field: entry.field,
        value: entry.negativeValue
      };
    }
  }

  return undefined;
}
