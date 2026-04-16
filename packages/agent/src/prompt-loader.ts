import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

export type PromptTemplates = {
  keyboardBrowseSystem: string;
  keyboardBrowseUser: string;
  screenreaderBrowseSystem: string;
  screenreaderBrowseUser: string;
  keyboardSystem: string;
  keyboardUser: string;
  screenreaderSystem: string;
  screenreaderUser: string;
  planningSystem: string;
  planningUser: string;
  reflectionSystem: string;
  reflectionUser: string;
  experienceSummarySystem: string;
  experienceSummaryUser: string;
  promptDir: string;
};

const TEMPLATE_FILES = {
  keyboardBrowseSystem: "keyboard.browse.system.md",
  keyboardBrowseUser: "keyboard.browse.user.md",
  screenreaderBrowseSystem: "screenreader.browse.system.md",
  screenreaderBrowseUser: "screenreader.browse.user.md",
  keyboardSystem: "keyboard.system.md",
  keyboardUser: "keyboard.user.md",
  screenreaderSystem: "screenreader.system.md",
  screenreaderUser: "screenreader.user.md",
  planningSystem: "planning.system.md",
  planningUser: "planning.user.md",
  reflectionSystem: "reflection.system.md",
  reflectionUser: "reflection.user.md",
  experienceSummarySystem: "experience-summary.system.md",
  experienceSummaryUser: "experience-summary.user.md"
} as const satisfies Record<Exclude<keyof PromptTemplates, "promptDir">, string>;

const REQUIRED_PLACEHOLDERS: Partial<Record<Exclude<keyof PromptTemplates, "promptDir">, string[]>> = {
  keyboardBrowseSystem: [
    "{{outputExamples}}"
  ],
  keyboardBrowseUser: [
    "{{goal}}",
    "{{agentMemory}}",
    "{{taskInputs}}",
    "{{availableActions}}",
    "{{currentObservation}}"
  ],
  screenreaderBrowseSystem: [
    "{{outputExamples}}"
  ],
  screenreaderBrowseUser: [
    "{{goal}}",
    "{{agentMemory}}",
    "{{announcement}}",
    "{{readbacks}}",
    "{{taskInputs}}",
    "{{availableActions}}",
    "{{currentObservation}}"
  ],
  keyboardSystem: [
    "{{outputExamples}}"
  ],
  keyboardUser: [
    "{{goal}}",
    "{{agentMemory}}",
    "{{taskInputs}}",
    "{{availableActions}}"
  ],
  screenreaderSystem: [
    "{{outputExamples}}"
  ],
  screenreaderUser: [
    "{{goal}}",
    "{{agentMemory}}",
    "{{announcement}}",
    "{{readbacks}}",
    "{{taskInputs}}",
    "{{availableActions}}"
  ],
  planningSystem: [
    "{{outputExamples}}"
  ],
  planningUser: [
    "{{goal}}",
    "{{taskInputs}}",
    "{{availableActions}}",
    "{{currentObservation}}"
  ],
  reflectionSystem: [
    "{{outputExamples}}"
  ],
  reflectionUser: [
    "{{goal}}",
    "{{currentPlan}}",
    "{{currentFocus}}",
    "{{strategyNote}}",
    "{{recentSteps}}",
    "{{recentMemory}}"
  ],
  experienceSummaryUser: [
    "{{taskSummary}}",
    "{{aggregateSummary}}",
    "{{stepTimeline}}"
  ]
};

const promptTemplateCache = new Map<string, PromptTemplates>();

export function loadPromptTemplates(
  startDirOrOptions: string | { startDir?: string; promptDir?: string } = process.cwd()
): PromptTemplates {
  const promptDir = resolvePromptDir(startDirOrOptions);
  const cached = promptTemplateCache.get(promptDir);
  if (cached) {
    return cached;
  }

  const templates = {
    keyboardBrowseSystem: readPromptFile(promptDir, "keyboardBrowseSystem"),
    keyboardBrowseUser: readPromptFile(promptDir, "keyboardBrowseUser"),
    screenreaderBrowseSystem: readPromptFile(promptDir, "screenreaderBrowseSystem"),
    screenreaderBrowseUser: readPromptFile(promptDir, "screenreaderBrowseUser"),
    keyboardSystem: readPromptFile(promptDir, "keyboardSystem"),
    keyboardUser: readPromptFile(promptDir, "keyboardUser"),
    screenreaderSystem: readPromptFile(promptDir, "screenreaderSystem"),
    screenreaderUser: readPromptFile(promptDir, "screenreaderUser"),
    planningSystem: readPromptFile(promptDir, "planningSystem"),
    planningUser: readPromptFile(promptDir, "planningUser"),
    reflectionSystem: readPromptFile(promptDir, "reflectionSystem"),
    reflectionUser: readPromptFile(promptDir, "reflectionUser"),
    experienceSummarySystem: readPromptFile(promptDir, "experienceSummarySystem"),
    experienceSummaryUser: readPromptFile(promptDir, "experienceSummaryUser"),
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
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in replacements)) {
      throw new Error(`Missing prompt replacement for {{${key}}}.`);
    }

    return replacements[key];
  });
}

function resolvePromptDir(startDirOrOptions: string | { startDir?: string; promptDir?: string }): string {
  if (typeof startDirOrOptions === "string") {
    return findPromptDir(startDirOrOptions);
  }

  if (startDirOrOptions.promptDir) {
    return resolve(startDirOrOptions.promptDir);
  }

  return findPromptDir(startDirOrOptions.startDir ?? process.cwd());
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

  const content = stripMarkdownComments(readFileSync(filePath, "utf8")).trim();
  if (!content) {
    throw new Error(`Prompt file is empty: ${filePath}`);
  }

  return content;
}

function stripMarkdownComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
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
