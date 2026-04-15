import {
  SCREEN_READER_CLI_TOKEN_LABELS,
  SCREEN_READER_HELPER_PATH_TO_SEMANTIC,
  SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC,
  SCREEN_READER_PUBLIC_SEMANTICS_BY_BACKEND,
  buildDefaultScreenReaderActionRefs,
  buildScreenReaderActionPlan,
  createCatalogScreenReaderExtensionRef,
  createRawPerformScreenReaderExtensionRef,
  createStableScreenReaderActionRef,
  formatScreenReaderActionRef,
  parseCommaSeparatedScreenReaderActionRefs,
  parseScreenReaderActionRefs,
  type PromptObjectSchema,
  type ScreenReaderActionDescriptor,
  type ScreenReaderActionPlan,
  type ScreenReaderActionRef,
  type ScreenReaderCapabilities,
  type ScreenReaderExtensionCatalogActionRef,
  type ScreenReaderExtensionRawPerformActionRef,
  type ScreenReaderSemanticAction,
  type ScreenReaderStableActionRef
} from "@rawstep/action-catalog";
import {
  getScreenReaderBackendCapabilities,
  type ScreenReaderBackendId
} from "@rawstep/definition";
import { z } from "zod";
import {
  buildNestedHelperTree,
  type ExpandDeep,
  type PathToTree,
  type UnionToIntersection
} from "./helper-tree";

type ScreenReaderActionOptions = {
  hint?: string;
};

type StableScreenReaderActionRefFor<TSemantic extends ScreenReaderSemanticAction> =
  ScreenReaderStableActionRef & { semantic: TSemantic };

type ScreenReaderExtensionCatalogOptions<TSchema extends z.ZodObject<any>> = {
  hint: string;
  argsSchema: TSchema;
  argsExample: z.input<TSchema>;
};

type ScreenReaderExtensionRawPerformOptions<TSchema extends z.ZodObject<any>> = {
  hint: string;
  payloadSchema: TSchema;
  payloadExample: z.input<TSchema>;
};

type ScreenReaderHelperPath = keyof typeof SCREEN_READER_HELPER_PATH_TO_SEMANTIC & string;

export type ScreenReaderHelperApi = ExpandDeep<
  UnionToIntersection<{
    [Path in ScreenReaderHelperPath]: PathToTree<
      Path,
      (options?: ScreenReaderActionOptions) => StableScreenReaderActionRefFor<
        (typeof SCREEN_READER_HELPER_PATH_TO_SEMANTIC)[Path]
      >
    >;
  }[ScreenReaderHelperPath]>
>;

export const sr = buildNestedHelperTree(
  SCREEN_READER_HELPER_PATH_TO_SEMANTIC,
  (semantic) => (options?: ScreenReaderActionOptions) =>
    createStableScreenReaderActionRef(
      semantic as ScreenReaderSemanticAction,
      options?.hint
    )
) as ScreenReaderHelperApi;

export type ScreenReaderExtensionHelperApi = {
  catalog: <TSchema extends z.ZodObject<any>>(
    id: string,
    options: ScreenReaderExtensionCatalogOptions<TSchema>
  ) => ScreenReaderExtensionCatalogActionRef;
  rawPerform: <TSchema extends z.ZodObject<any>>(
    options: ScreenReaderExtensionRawPerformOptions<TSchema>
  ) => ScreenReaderExtensionRawPerformActionRef;
};

export const srx: ScreenReaderExtensionHelperApi = {
  catalog: <TSchema extends z.ZodObject<any>>(
    id: string,
    options: ScreenReaderExtensionCatalogOptions<TSchema>
  ): ScreenReaderExtensionCatalogActionRef =>
    createCatalogScreenReaderExtensionRef(
      id,
      options.hint,
      options.argsSchema as PromptObjectSchema<Record<string, unknown>>,
      options.argsExample as Record<string, unknown>
    ),
  rawPerform: <TSchema extends z.ZodObject<any>>(
    options: ScreenReaderExtensionRawPerformOptions<TSchema>
  ): ScreenReaderExtensionRawPerformActionRef =>
    createRawPerformScreenReaderExtensionRef(
      options.hint,
      options.payloadSchema as PromptObjectSchema<Record<string, unknown>>,
      options.payloadExample as Record<string, unknown>
    )
};

export function parseConfiguredScreenReaderActions(
  value: unknown,
  label: string
): ScreenReaderActionRef[] {
  return parseScreenReaderActionRefs(value, label, { allowExtensions: true });
}

export function parseTaskScreenReaderActions(
  value: unknown,
  label: string
): ScreenReaderActionRef[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of stable sr.* action tokens.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${label}[${index}] must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}.`);
    }

    const semantic = SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC[
      entry as keyof typeof SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC
    ];
    if (!semantic) {
      throw new Error(`${label}[${index}] must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}.`);
    }

    return createStableScreenReaderActionRef(semantic);
  });
}

export function parseCommaSeparatedConfiguredScreenReaderActions(
  value: unknown,
  label: string
): ScreenReaderActionRef[] {
  return parseCommaSeparatedScreenReaderActionRefs(value, label, { allowExtensions: true });
}

export function resolveConfiguredScreenReaderActions(
  configuredActions: readonly ScreenReaderActionRef[] | undefined,
  backendId: ScreenReaderBackendId
): {
  plan: ScreenReaderActionPlan;
  promptActions: readonly ScreenReaderActionDescriptor[];
} {
  const capabilities = getScreenReaderBackendCapabilities(backendId);
  const refs = configuredActions ?? buildDefaultScreenReaderActionRefs(backendId, capabilities);
  const plan = buildScreenReaderActionPlan(refs, backendId, capabilities);

  return {
    plan,
    promptActions: plan.descriptors
  };
}

export function formatConfiguredScreenReaderAction(action: ScreenReaderActionRef): string {
  return formatScreenReaderActionRef(action);
}

export type BackendStableScreenReaderSemantic<TBackend extends ScreenReaderBackendId> =
  (typeof SCREEN_READER_PUBLIC_SEMANTICS_BY_BACKEND)[TBackend][number];
