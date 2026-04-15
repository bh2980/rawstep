export type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer Result) => void
  ? Result
  : never;

export type PathToTree<Path extends string, Leaf> = Path extends `${infer Head}.${infer Tail}`
  ? { [Key in Head]: PathToTree<Tail, Leaf> }
  : { [Key in Path]: Leaf };

export type ExpandDeep<T> = T extends (...args: any[]) => any
  ? T
  : T extends object
    ? { [Key in keyof T]: ExpandDeep<T[Key]> }
    : T;

export function buildNestedHelperTree<TValue>(
  mapping: Record<string, TValue>,
  createLeaf: (value: TValue) => unknown
): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const [path, value] of Object.entries(mapping)) {
    assignNestedValue(root, path, createLeaf(value));
  }

  return root;
}

function assignNestedValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const segments = path.split(".");
  let cursor = target;

  while (segments.length > 1) {
    const segment = segments.shift();
    if (!segment) {
      throw new Error(`Invalid helper path: ${path}`);
    }

    const next = cursor[segment];
    if (typeof next === "object" && next !== null && !Array.isArray(next)) {
      cursor = next as Record<string, unknown>;
      continue;
    }

    const created: Record<string, unknown> = {};
    cursor[segment] = created;
    cursor = created;
  }

  const leafSegment = segments[0];
  if (!leafSegment) {
    throw new Error(`Invalid helper path: ${path}`);
  }

  cursor[leafSegment] = value;
}
