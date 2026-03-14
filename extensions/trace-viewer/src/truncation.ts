const DEFAULT_MAX_TEXT = 4_000;
const DEFAULT_MAX_JSON = 30_000;

export function truncateText(
  value: string | undefined,
  max = DEFAULT_MAX_TEXT,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function previewUnknown(value: unknown, max = 500): string | undefined {
  const text = stringifyUnknown(value);
  return text ? truncateText(text, max) : undefined;
}

export function sanitizeUnknown(value: unknown, max = DEFAULT_MAX_JSON): unknown {
  const text = stringifyUnknown(value);
  if (!text) {
    return undefined;
  }
  if (text.length > max) {
    return truncateText(text, max);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
