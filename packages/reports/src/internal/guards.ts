/** Package-internal helpers; deliberately absent from the exports map. */
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function pngFor(data: unknown): string | undefined {
  const png = record(record(data).screenshot).pngBase64;
  return typeof png === "string" && /^[A-Za-z0-9+/=]+$/.test(png) &&
    Buffer.from(png, "base64").subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? png : undefined;
}
