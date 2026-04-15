export type ModeObservationKind = "visual" | "announcement";

type ModeSpec = {
  observation: ModeObservationKind;
  allowsRawKeys: boolean;
  requiresScreenReaderBackend: boolean;
  supportsVisualObservation: boolean;
};

export const USER_MODEL_VALUES = [
  "keyboard",
  "screenreader-strict",
  "screenreader-hybrid"
] as const;

export const MODE_SPEC = {
  keyboard: {
    observation: "visual",
    allowsRawKeys: true,
    requiresScreenReaderBackend: false,
    supportsVisualObservation: true
  },
  "screenreader-strict": {
    observation: "announcement",
    allowsRawKeys: false,
    requiresScreenReaderBackend: true,
    supportsVisualObservation: false
  },
  "screenreader-hybrid": {
    observation: "announcement",
    allowsRawKeys: true,
    requiresScreenReaderBackend: true,
    supportsVisualObservation: false
  }
} as const satisfies Record<(typeof USER_MODEL_VALUES)[number], ModeSpec>;

export type UserModel = keyof typeof MODE_SPEC;

export function isUserModel(value: unknown): value is UserModel {
  return typeof value === "string" && value in MODE_SPEC;
}

export function parseUserModel(value: unknown, label = "mode"): UserModel {
  if (isUserModel(value)) {
    return value;
  }

  throw new Error(
    `Unsupported ${label}: ${String(value)}. Expected one of ${USER_MODEL_VALUES.join(", ")}.`
  );
}

export function isScreenReaderMode(mode: UserModel): boolean {
  return MODE_SPEC[mode].observation === "announcement";
}

export function allowsRawKeyActions(mode: UserModel): boolean {
  return MODE_SPEC[mode].allowsRawKeys;
}

export function requiresScreenReaderBackend(mode: UserModel): boolean {
  return MODE_SPEC[mode].requiresScreenReaderBackend;
}

export function supportsVisualObservation(mode: UserModel): boolean {
  return MODE_SPEC[mode].supportsVisualObservation;
}

export function supportsScreenReaderObservation(mode: UserModel): boolean {
  return MODE_SPEC[mode].observation === "announcement";
}
