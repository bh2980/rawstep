import {
  DEFAULT_ALLOWED_KEYS,
  KEYBOARD_HELPER_PATH_TO_KEY,
  SCREEN_READER_ACTION_DEFINITIONS,
  SCREEN_READER_BACKEND_IDS,
  SCREEN_READER_CATALOG_IDS_BY_SEMANTIC,
  SCREEN_READER_HELPER_PATH_TO_SEMANTIC,
  SCREEN_READER_SEMANTIC_BY_CATALOG_ID,
  SCREEN_READER_SEMANTICS,
  SCREEN_READER_SEMANTICS_BY_BACKEND,
  SUPPORTED_KEYS
} from "@rawstep/action-catalog";
import {
  keyboardActionSource,
  screenReaderActionSource,
  screenReaderBackendIds
} from "../packages/action-catalog/src/source";
import { describe, expect, it } from "vitest";

describe("action catalog", () => {
  it("keeps keyboard source fields unique and generated in the same order", () => {
    expect(new Set(keyboardActionSource.map((entry) => entry.key)).size).toBe(keyboardActionSource.length);
    expect(new Set(keyboardActionSource.map((entry) => entry.helperPath)).size).toBe(keyboardActionSource.length);
    expect(new Set(keyboardActionSource.map((entry) => entry.cliToken)).size).toBe(keyboardActionSource.length);

    expect(SUPPORTED_KEYS).toEqual(keyboardActionSource.map((entry) => entry.key));
    expect(DEFAULT_ALLOWED_KEYS).toEqual(
      keyboardActionSource.filter((entry) => entry.defaultAllowed).map((entry) => entry.key)
    );
    expect(KEYBOARD_HELPER_PATH_TO_KEY).toEqual(
      Object.fromEntries(keyboardActionSource.map((entry) => [entry.helperPath, entry.key]))
    );
  });

  it("keeps screen reader source fields unique", () => {
    expect(new Set(screenReaderActionSource.map((entry) => entry.semantic)).size).toBe(screenReaderActionSource.length);
    expect(new Set(screenReaderActionSource.map((entry) => entry.helperPath)).size).toBe(screenReaderActionSource.length);

    const catalogIds = screenReaderActionSource.flatMap((entry) => Object.values(entry.catalogIdsByBackend ?? {}));
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
  });

  it("builds backend semantic lists directly from the catalog source", () => {
    expect(SCREEN_READER_BACKEND_IDS).toEqual(screenReaderBackendIds);
    expect(SCREEN_READER_SEMANTICS).toEqual(screenReaderActionSource.map((entry) => entry.semantic));

    for (const backend of screenReaderBackendIds) {
      expect(SCREEN_READER_SEMANTICS_BY_BACKEND[backend]).toEqual(
        screenReaderActionSource
          .filter((entry) => entry.backendSupport.includes(backend))
          .map((entry) => entry.semantic)
      );
    }
  });

  it("keeps helper path and catalog-id reverse mappings consistent", () => {
    expect(SCREEN_READER_HELPER_PATH_TO_SEMANTIC).toEqual(
      Object.fromEntries(screenReaderActionSource.map((entry) => [entry.helperPath, entry.semantic]))
    );

    for (const entry of screenReaderActionSource) {
      const semantic = entry.semantic as keyof typeof SCREEN_READER_ACTION_DEFINITIONS;
      expect(SCREEN_READER_ACTION_DEFINITIONS[semantic]).toMatchObject({
        helperPath: entry.helperPath,
        kind: entry.kind,
        backendSupport: entry.backendSupport
      });

      if (entry.kind !== "catalog") {
        continue;
      }

      const catalogSemantic = entry.semantic as keyof typeof SCREEN_READER_CATALOG_IDS_BY_SEMANTIC;
      expect(SCREEN_READER_CATALOG_IDS_BY_SEMANTIC[catalogSemantic]).toEqual(entry.catalogIdsByBackend);

      for (const catalogId of Object.values(entry.catalogIdsByBackend ?? {})) {
        const typedCatalogId = catalogId as keyof typeof SCREEN_READER_SEMANTIC_BY_CATALOG_ID;
        expect(SCREEN_READER_SEMANTIC_BY_CATALOG_ID[typedCatalogId]).toBe(entry.semantic);
      }
    }
  });
});
