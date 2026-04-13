import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

export type PromptTemplates = {
  keyboardSystem: string;
  screenreaderStrictSystem: string;
  screenreaderHybridSystem: string;
  experienceSummarySystem: string;
  promptDir: string;
};

const TEMPLATE_FILES = {
  keyboardSystem: "keyboard.system.md",
  screenreaderStrictSystem: "screenreader-strict.system.md",
  screenreaderHybridSystem: "screenreader-hybrid.system.md",
  experienceSummarySystem: "experience-summary.system.md"
} as const satisfies Record<Exclude<keyof PromptTemplates, "promptDir">, string>;

const REQUIRED_PLACEHOLDERS: Partial<Record<Exclude<keyof PromptTemplates, "promptDir">, string[]>> = {
  keyboardSystem: ["{{allowedKeys}}", "{{taskInputRule}}", "{{responseFormat}}", "{{rationaleRule}}"],
  screenreaderStrictSystem: ["{{allowedScreenReaderCommands}}", "{{taskInputRule}}", "{{responseFormat}}", "{{rationaleRule}}"],
  screenreaderHybridSystem: ["{{allowedKeys}}", "{{allowedScreenReaderCommands}}", "{{taskInputRule}}", "{{responseFormat}}", "{{rationaleRule}}"]
};

const promptTemplateCache = new Map<string, PromptTemplates>();

export function loadPromptTemplates(startDir = process.cwd()): PromptTemplates {
  const promptDir = findPromptDir(startDir);
  const cached = promptTemplateCache.get(promptDir);
  if (cached) {
    return cached;
  }

  const templates = {
    keyboardSystem: readPromptFile(promptDir, "keyboardSystem"),
    screenreaderStrictSystem: readPromptFile(promptDir, "screenreaderStrictSystem"),
    screenreaderHybridSystem: readPromptFile(promptDir, "screenreaderHybridSystem"),
    experienceSummarySystem: readPromptFile(promptDir, "experienceSummarySystem"),
    promptDir
  };

  validatePromptTemplates(templates);
  promptTemplateCache.set(promptDir, templates);
  return templates;
}

export function clearPromptTemplateCache(): void {
  promptTemplateCache.clear();
}

export function renderPromptTemplate(
  template: string,
  replacements: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => replacements[key] ?? "");
}

function findPromptDir(startDir: string): string {
  let currentDir = resolve(startDir);

  while (true) {
    const candidate = join(currentDir, "prompt");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(
        `Missing prompt directory. Create ${join(resolve(startDir), "prompt")} with: ${Object.values(TEMPLATE_FILES).join(", ")}`
      );
    }

    currentDir = parentDir;
  }
}

function readPromptFile(
  promptDir: string,
  key: Exclude<keyof PromptTemplates, "promptDir">
): string {
  const filePath = join(promptDir, TEMPLATE_FILES[key]);
  if (!existsSync(filePath)) {
    throw new Error(`Missing prompt file: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf8").trim();
  if (!content) {
    throw new Error(`Prompt file is empty: ${filePath}`);
  }

  return content;
}

function validatePromptTemplates(templates: PromptTemplates): void {
  for (const [key, placeholders] of Object.entries(REQUIRED_PLACEHOLDERS) as Array<[Exclude<keyof PromptTemplates, "promptDir">, string[]]>) {
    const template = templates[key];
    for (const placeholder of placeholders) {
      if (!template.includes(placeholder)) {
        throw new Error(`Prompt template ${join(templates.promptDir, TEMPLATE_FILES[key])} must include ${placeholder}.`);
      }
    }
  }
}
