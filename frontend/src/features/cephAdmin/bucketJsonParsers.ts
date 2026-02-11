export type JsonRecord = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
};

export const parseLifecycleRules = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide lifecycle rules in JSON format." } as const;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed) && !Array.isArray(parsed)) {
      return { error: "Lifecycle rules must be a JSON object or array." } as const;
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { error: "Provide at least one lifecycle rule." } as const;
      }
      const invalidIndex = parsed.findIndex((rule) => !isJsonObject(rule));
      if (invalidIndex >= 0) {
        return { error: `Lifecycle rule at index ${invalidIndex} must be a JSON object.` } as const;
      }
      return { rules: parsed as JsonRecord[] } as const;
    }
    return { rules: [parsed] } as const;
  } catch {
    return { error: "Invalid JSON." } as const;
  }
};

export const parseCorsRules = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide CORS rules in JSON format." } as const;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed) && !Array.isArray(parsed)) {
      return { error: "CORS rules must be a JSON object or array." } as const;
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { error: "Provide at least one CORS rule." } as const;
      }
      const invalidIndex = parsed.findIndex((rule) => !isJsonObject(rule));
      if (invalidIndex >= 0) {
        return { error: `CORS rule at index ${invalidIndex} must be a JSON object.` } as const;
      }
      return { rules: parsed as JsonRecord[] } as const;
    }
    return { rules: [parsed] } as const;
  } catch {
    return { error: "Invalid JSON." } as const;
  }
};

export const parsePolicyStatements = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide a policy in JSON format." } as const;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed) && !Array.isArray(parsed)) {
      return { error: "Policy must be a JSON object or array." } as const;
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { error: "Provide at least one policy statement." } as const;
      }
      const invalidIndex = parsed.findIndex((statement) => !isJsonObject(statement));
      if (invalidIndex >= 0) {
        return { error: `Policy statement at index ${invalidIndex} must be a JSON object.` } as const;
      }
      return { policy: { Statement: parsed }, statements: parsed as JsonRecord[] } as const;
    }

    const parsedObj = parsed as JsonRecord;
    const rawStatements = parsedObj.Statement;
    if (Array.isArray(rawStatements)) {
      if (rawStatements.length === 0) {
        return { error: "Provide at least one policy statement." } as const;
      }
      const invalidIndex = rawStatements.findIndex((statement) => !isJsonObject(statement));
      if (invalidIndex >= 0) {
        return { error: `Policy statement at index ${invalidIndex} must be a JSON object.` } as const;
      }
      return { policy: parsedObj, statements: rawStatements as JsonRecord[] } as const;
    }

    if (isJsonObject(rawStatements)) {
      return { policy: { ...parsedObj, Statement: [rawStatements] }, statements: [rawStatements] } as const;
    }

    return { policy: { Statement: [parsedObj] }, statements: [parsedObj] } as const;
  } catch {
    return { error: "Invalid JSON." } as const;
  }
};

export const parseRuleIds = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return [] as string[];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[\n,]/g)
    .map((value) => value.trim())
    .filter(Boolean);
};
