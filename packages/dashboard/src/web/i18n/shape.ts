/**
 * The shape another language's locale file must have: every key of the Korean file, with any wording. A missing or extra key fails
 * typecheck. English may add `<key>_one` next to a key that takes `{{count}}`, for i18next's singular form; the plain key is the plural.
 */
export type LocaleShape<T> = { -readonly [K in keyof T]: T[K] extends string ? string : LocaleShape<T[K]> } & { [plural: `${string}_one`]: string };
