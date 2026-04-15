import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  keyboardActionSource,
  screenReaderActionSource,
  screenReaderBackendIds,
  type KeyboardActionSource,
  type ScreenReaderActionSource,
  type ScreenReaderBackendId
} from "../src/source";

type CatalogKind = ScreenReaderActionSource["kind"];

function main(): Promise<void> {
  validateKeyboardCatalog(keyboardActionSource);
  validateScreenReaderCatalog(screenReaderActionSource);

  const generatedPath = resolve(__dirname, "../src/generated.ts");
  return writeFile(generatedPath, buildGeneratedModule(), "utf8");
}

function validateKeyboardCatalog(entries: readonly KeyboardActionSource[]): void {
  assertUnique(entries.map((entry) => entry.key), "keyboard key");
  assertUnique(entries.map((entry) => entry.helperPath), "keyboard helperPath");
  assertUnique(entries.map((entry) => entry.cliToken), "keyboard cliToken");
}

function validateScreenReaderCatalog(entries: readonly ScreenReaderActionSource[]): void {
  assertUnique(entries.map((entry) => entry.semantic), "screen reader semantic");
  assertUnique(entries.map((entry) => entry.helperPath), "screen reader helperPath");

  const catalogIds: string[] = [];

  for (const entry of entries) {
    if (entry.backendSupport.length === 0) {
      throw new Error(`screen reader semantic "${entry.semantic}" must support at least one backend`);
    }

    const invalidBackend = entry.backendSupport.find((backend) => !screenReaderBackendIds.includes(backend));
    if (invalidBackend) {
      throw new Error(`screen reader semantic "${entry.semantic}" uses unknown backend "${invalidBackend}"`);
    }

    if (entry.kind === "catalog") {
      if (!entry.catalogIdsByBackend) {
        throw new Error(`catalog semantic "${entry.semantic}" must define catalogIdsByBackend`);
      }

      for (const backend of entry.backendSupport) {
        const catalogId = entry.catalogIdsByBackend[backend];
        if (!catalogId) {
          throw new Error(`catalog semantic "${entry.semantic}" is missing catalog id for "${backend}"`);
        }
        catalogIds.push(catalogId);
      }

      for (const backend of Object.keys(entry.catalogIdsByBackend) as ScreenReaderBackendId[]) {
        if (!entry.backendSupport.includes(backend)) {
          throw new Error(`catalog semantic "${entry.semantic}" defines unsupported backend "${backend}"`);
        }
      }

      continue;
    }

    if (entry.catalogIdsByBackend && Object.keys(entry.catalogIdsByBackend).length > 0) {
      throw new Error(`non-catalog semantic "${entry.semantic}" must not define catalogIdsByBackend`);
    }
  }

  assertUnique(catalogIds, "screen reader catalog id");
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function buildGeneratedModule(): string {
  const keyboardDefinitions = Object.fromEntries(
    keyboardActionSource.map((entry) => [
      entry.key,
      {
        helperPath: entry.helperPath,
        cliToken: entry.cliToken,
        defaultAllowed: entry.defaultAllowed
      }
    ])
  );
  const keyboardHelperPathToKey = Object.fromEntries(
    keyboardActionSource.map((entry) => [entry.helperPath, entry.key])
  );
  const supportedKeys = keyboardActionSource.map((entry) => entry.key);
  const defaultAllowedKeys = keyboardActionSource
    .filter((entry) => entry.defaultAllowed)
    .map((entry) => entry.key);

  const screenReaderDefinitions = Object.fromEntries(
    screenReaderActionSource.map((entry) => [
      entry.semantic,
      {
        helperPath: entry.helperPath,
        promptToken: `sr.${entry.semantic}`,
        kind: entry.kind,
        argumentKind: entry.argumentKind ?? "none",
        backendSupport: entry.backendSupport,
        catalogIdsByBackend: entry.catalogIdsByBackend ?? {},
        ...(entry.fixedKey ? { fixedKey: entry.fixedKey } : {}),
        defaultAllowed: entry.defaultAllowed ?? true,
        public: entry.public ?? true
      }
    ])
  );
  const publicScreenReaderActionSource = screenReaderActionSource
    .filter((entry) => entry.public !== false);
  const publicScreenReaderSemantics = publicScreenReaderActionSource.map((entry) => entry.semantic);
  const screenReaderHelperPathToSemantic = Object.fromEntries(
    publicScreenReaderActionSource.map((entry) => [entry.helperPath, entry.semantic])
  );
  const screenReaderSemantics = screenReaderActionSource.map((entry) => entry.semantic);
  const screenReaderCliTokens = publicScreenReaderActionSource.map((entry) => `sr.${entry.semantic}`);
  const screenReaderPromptTokenToSemantic = Object.fromEntries(
    publicScreenReaderActionSource.map((entry) => [`sr.${entry.semantic}`, entry.semantic])
  );
  const semanticsByBackend = Object.fromEntries(
    screenReaderBackendIds.map((backend) => [
      backend,
      screenReaderActionSource
        .filter((entry) => entry.backendSupport.includes(backend))
        .map((entry) => entry.semantic)
    ])
  );
  const publicSemanticsByBackend = Object.fromEntries(
    screenReaderBackendIds.map((backend) => [
      backend,
      publicScreenReaderActionSource
        .filter((entry) => entry.backendSupport.includes(backend))
        .map((entry) => entry.semantic)
    ])
  );
  const semanticsByKind = groupSemanticsByKind(screenReaderActionSource);
  const catalogIdsBySemantic = Object.fromEntries(
    screenReaderActionSource
      .filter((entry) => entry.kind === "catalog")
      .map((entry) => [entry.semantic, entry.catalogIdsByBackend ?? {}])
  );
  const semanticByCatalogId = Object.fromEntries(
    screenReaderActionSource.flatMap((entry) =>
      entry.kind === "catalog"
        ? Object.values(entry.catalogIdsByBackend ?? {}).map((catalogId) => [catalogId, entry.semantic] as const)
        : []
    )
  );

  return [
    "// This file is generated by packages/action-catalog/scripts/generate.ts.",
    "// Do not edit by hand.",
    "",
    `export const SCREEN_READER_BACKEND_IDS = ${serialize(screenReaderBackendIds)} as const;`,
    "",
    `export const KEYBOARD_ACTION_DEFINITIONS = ${serialize(keyboardDefinitions)} as const;`,
    `export const KEYBOARD_HELPER_PATH_TO_KEY = ${serialize(keyboardHelperPathToKey)} as const;`,
    `export const SUPPORTED_KEYS = ${serialize(supportedKeys)} as const;`,
    `export const DEFAULT_ALLOWED_KEYS = ${serialize(defaultAllowedKeys)} as const;`,
    `export const SUPPORTED_KEY_LABELS = ${serialize(supportedKeys.join(", "))} as const;`,
    "",
    `export const SCREEN_READER_ACTION_DEFINITIONS = ${serialize(screenReaderDefinitions)} as const;`,
    `export const SCREEN_READER_HELPER_PATH_TO_SEMANTIC = ${serialize(screenReaderHelperPathToSemantic)} as const;`,
    `export const SCREEN_READER_SEMANTICS = ${serialize(screenReaderSemantics)} as const;`,
    `export const SCREEN_READER_SEMANTIC_LABELS = ${serialize(screenReaderSemantics.join(", "))} as const;`,
    `export const SCREEN_READER_PUBLIC_SEMANTICS = ${serialize(publicScreenReaderSemantics)} as const;`,
    `export const SCREEN_READER_CLI_TOKENS = ${serialize(screenReaderCliTokens)} as const;`,
    `export const SCREEN_READER_CLI_TOKEN_LABELS = ${serialize(screenReaderCliTokens.join(", "))} as const;`,
    `export const SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC = ${serialize(screenReaderPromptTokenToSemantic)} as const;`,
    `export const SCREEN_READER_SEMANTICS_BY_BACKEND = ${serialize(semanticsByBackend)} as const;`,
    `export const SCREEN_READER_PUBLIC_SEMANTICS_BY_BACKEND = ${serialize(publicSemanticsByBackend)} as const;`,
    `export const SCREEN_READER_INVOKE_SEMANTICS = ${serialize(semanticsByKind.invoke)} as const;`,
    `export const SCREEN_READER_READ_SEMANTICS = ${serialize(semanticsByKind.read)} as const;`,
    `export const SCREEN_READER_MAINTENANCE_SEMANTICS = ${serialize(semanticsByKind.maintenance)} as const;`,
    `export const SCREEN_READER_CATALOG_SEMANTICS = ${serialize(semanticsByKind.catalog)} as const;`,
    `export const SCREEN_READER_CATALOG_IDS_BY_SEMANTIC = ${serialize(catalogIdsBySemantic)} as const;`,
    `export const SCREEN_READER_SEMANTIC_BY_CATALOG_ID = ${serialize(semanticByCatalogId)} as const;`,
    ""
  ].join("\n");
}

function groupSemanticsByKind(entries: readonly ScreenReaderActionSource[]): Record<CatalogKind, string[]> {
  return {
    invoke: entries.filter((entry) => entry.kind === "invoke").map((entry) => entry.semantic),
    read: entries.filter((entry) => entry.kind === "read").map((entry) => entry.semantic),
    maintenance: entries.filter((entry) => entry.kind === "maintenance").map((entry) => entry.semantic),
    catalog: entries.filter((entry) => entry.kind === "catalog").map((entry) => entry.semantic)
  };
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
