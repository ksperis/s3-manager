type JsonRecord = Record<string, unknown>;

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

type ParseLifecycleRulesResult = { rules: JsonRecord[] } | { error: string };
type ParseNotificationConfigurationResult = { configuration: JsonRecord } | { error: string };
type ParseCorsRulesResult = { rules: JsonRecord[] } | { error: string };
type ParsePolicyStatementsResult = { policy: JsonRecord; statements: JsonRecord[] } | { error: string };

export const parseLifecycleRules = (raw: string): ParseLifecycleRulesResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide lifecycle rules in JSON format." };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed) && !Array.isArray(parsed)) {
      return { error: "Lifecycle rules must be a JSON object or array." };
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { error: "Provide at least one lifecycle rule." };
      }
      const invalidIndex = parsed.findIndex((rule) => !isJsonObject(rule));
      if (invalidIndex >= 0) {
        return { error: `Lifecycle rule at index ${invalidIndex} must be a JSON object.` };
      }
      return { rules: parsed as JsonRecord[] };
    }
    return { rules: [parsed] };
  } catch {
    return { error: "Invalid JSON." };
  }
};

export type NotificationConfigurationTypeKey = "topic" | "queue" | "lambda" | "eventbridge";

export const NOTIFICATION_CONFIGURATION_ARRAY_KEYS = {
  topic: "TopicConfigurations",
  queue: "QueueConfigurations",
  lambda: "LambdaFunctionConfigurations",
} as const satisfies Record<Exclude<NotificationConfigurationTypeKey, "eventbridge">, string>;

export const NOTIFICATION_EVENTBRIDGE_KEY = "EventBridgeConfiguration";

const NOTIFICATION_ARRAY_TYPES = Object.keys(
  NOTIFICATION_CONFIGURATION_ARRAY_KEYS
) as Array<Exclude<NotificationConfigurationTypeKey, "eventbridge">>;

type NotificationConfigurationChange = {
  type: NotificationConfigurationTypeKey;
  action: "replace" | "add" | "remove";
  index?: number;
  before?: JsonRecord;
  after?: JsonRecord;
};

const getNotificationConfigurationId = (configuration: JsonRecord) => {
  const rawId = configuration.Id ?? configuration.ID ?? configuration.id;
  if (typeof rawId === "string") {
    const trimmed = rawId.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof rawId === "number") {
    return String(rawId);
  }
  return null;
};

export const normalizeNotificationConfigurationForBulk = (configuration: unknown): JsonRecord => {
  if (!isJsonObject(configuration)) return {};
  const normalized: JsonRecord = {};

  NOTIFICATION_ARRAY_TYPES.forEach((type) => {
    const key = NOTIFICATION_CONFIGURATION_ARRAY_KEYS[type];
    const rawEntries = configuration[key];
    if (!Array.isArray(rawEntries)) return;
    const entries = rawEntries.filter(isJsonObject).map((entry) => entry as JsonRecord);
    if (entries.length > 0) {
      normalized[key] = entries;
    }
  });

  const eventBridge = configuration[NOTIFICATION_EVENTBRIDGE_KEY];
  if (isJsonObject(eventBridge)) {
    normalized[NOTIFICATION_EVENTBRIDGE_KEY] = eventBridge;
  }

  return normalized;
};

export const isNotificationConfigurationEmpty = (configuration: unknown) => {
  const normalized = normalizeNotificationConfigurationForBulk(configuration);
  const hasArrayConfig = NOTIFICATION_ARRAY_TYPES.some((type) => {
    const key = NOTIFICATION_CONFIGURATION_ARRAY_KEYS[type];
    const entries = normalized[key];
    return Array.isArray(entries) && entries.length > 0;
  });
  return !hasArrayConfig && !Object.prototype.hasOwnProperty.call(normalized, NOTIFICATION_EVENTBRIDGE_KEY);
};

export const parseNotificationConfiguration = (raw: string): ParseNotificationConfigurationResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide notification configuration in JSON format." };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed)) {
      return { error: "Notification configuration must be a JSON object." };
    }

    for (const type of NOTIFICATION_ARRAY_TYPES) {
      const key = NOTIFICATION_CONFIGURATION_ARRAY_KEYS[type];
      if (!(key in parsed)) continue;
      const rawEntries = parsed[key];
      if (!Array.isArray(rawEntries)) {
        return { error: `${key} must be an array.` };
      }
      const invalidIndex = rawEntries.findIndex((entry) => !isJsonObject(entry));
      if (invalidIndex >= 0) {
        return { error: `${key} entry at index ${invalidIndex} must be a JSON object.` };
      }
    }

    if (NOTIFICATION_EVENTBRIDGE_KEY in parsed && !isJsonObject(parsed[NOTIFICATION_EVENTBRIDGE_KEY])) {
      return { error: `${NOTIFICATION_EVENTBRIDGE_KEY} must be a JSON object.` };
    }

    const configuration = normalizeNotificationConfigurationForBulk(parsed);
    if (isNotificationConfigurationEmpty(configuration)) {
      return { error: "Provide at least one notification configuration." };
    }
    return { configuration };
  } catch {
    return { error: "Invalid JSON." };
  }
};

export const mergeNotificationConfigurations = (existingConfiguration: unknown, incomingConfiguration: unknown) => {
  const existing = normalizeNotificationConfigurationForBulk(existingConfiguration);
  const incoming = normalizeNotificationConfigurationForBulk(incomingConfiguration);
  const next: JsonRecord = {};
  const changes: NotificationConfigurationChange[] = [];
  const serialize = (value: JsonRecord) => stableStringify(value);

  NOTIFICATION_ARRAY_TYPES.forEach((type) => {
    const key = NOTIFICATION_CONFIGURATION_ARRAY_KEYS[type];
    const existingEntries = Array.isArray(existing[key]) ? ([...(existing[key] as JsonRecord[])] as JsonRecord[]) : [];
    const incomingEntries = Array.isArray(incoming[key]) ? (incoming[key] as JsonRecord[]) : [];
    const nextEntries = [...existingEntries];

    incomingEntries.forEach((incomingEntry) => {
      const incomingId = getNotificationConfigurationId(incomingEntry);
      if (incomingId) {
        const matchIndex = nextEntries.findIndex((entry) => getNotificationConfigurationId(entry) === incomingId);
        if (matchIndex >= 0) {
          if (serialize(nextEntries[matchIndex]) !== serialize(incomingEntry)) {
            changes.push({
              type,
              action: "replace",
              index: matchIndex,
              before: nextEntries[matchIndex],
              after: incomingEntry,
            });
            nextEntries[matchIndex] = incomingEntry;
          }
          return;
        }
      }

      const existsByContent = nextEntries.some((entry) => serialize(entry) === serialize(incomingEntry));
      if (!existsByContent) {
        changes.push({ type, action: "add", index: nextEntries.length, after: incomingEntry });
        nextEntries.push(incomingEntry);
      }
    });

    if (nextEntries.length > 0) {
      next[key] = nextEntries;
    }
  });

  const hasExistingEventBridge = Object.prototype.hasOwnProperty.call(existing, NOTIFICATION_EVENTBRIDGE_KEY);
  const hasIncomingEventBridge = Object.prototype.hasOwnProperty.call(incoming, NOTIFICATION_EVENTBRIDGE_KEY);
  if (hasExistingEventBridge) {
    next[NOTIFICATION_EVENTBRIDGE_KEY] = existing[NOTIFICATION_EVENTBRIDGE_KEY];
  }
  if (hasIncomingEventBridge) {
    const incomingEventBridge = incoming[NOTIFICATION_EVENTBRIDGE_KEY] as JsonRecord;
    const existingEventBridge = hasExistingEventBridge ? (existing[NOTIFICATION_EVENTBRIDGE_KEY] as JsonRecord) : null;
    if (!existingEventBridge || stableStringify(existingEventBridge) !== stableStringify(incomingEventBridge)) {
      changes.push({
        type: "eventbridge",
        action: hasExistingEventBridge ? "replace" : "add",
        before: existingEventBridge ?? undefined,
        after: incomingEventBridge,
      });
    }
    next[NOTIFICATION_EVENTBRIDGE_KEY] = incomingEventBridge;
  }

  return { configuration: next, changes };
};

export const deleteNotificationConfigurations = (
  existingConfiguration: unknown,
  deleteIds: ReadonlySet<string>,
  deleteTypes: ReadonlySet<NotificationConfigurationTypeKey>
) => {
  const existing = normalizeNotificationConfigurationForBulk(existingConfiguration);
  const next: JsonRecord = {};
  const changes: NotificationConfigurationChange[] = [];

  NOTIFICATION_ARRAY_TYPES.forEach((type) => {
    const key = NOTIFICATION_CONFIGURATION_ARRAY_KEYS[type];
    const existingEntries = Array.isArray(existing[key]) ? (existing[key] as JsonRecord[]) : [];
    const removeWholeType = deleteTypes.has(type);
    const nextEntries: JsonRecord[] = [];
    existingEntries.forEach((entry, index) => {
      const entryId = getNotificationConfigurationId(entry);
      const shouldRemove = removeWholeType || Boolean(entryId && deleteIds.has(entryId));
      if (shouldRemove) {
        changes.push({ type, action: "remove", index, before: entry });
        return;
      }
      nextEntries.push(entry);
    });
    if (nextEntries.length > 0) {
      next[key] = nextEntries;
    }
  });

  const hasEventBridge = Object.prototype.hasOwnProperty.call(existing, NOTIFICATION_EVENTBRIDGE_KEY);
  if (hasEventBridge) {
    const eventBridge = existing[NOTIFICATION_EVENTBRIDGE_KEY] as JsonRecord;
    if (deleteTypes.has("eventbridge")) {
      changes.push({ type: "eventbridge", action: "remove", before: eventBridge });
    } else {
      next[NOTIFICATION_EVENTBRIDGE_KEY] = eventBridge;
    }
  }

  return { configuration: next, changes };
};

export const parseCorsRules = (raw: string): ParseCorsRulesResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide CORS rules in JSON format." };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed) && !Array.isArray(parsed)) {
      return { error: "CORS rules must be a JSON object or array." };
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { error: "Provide at least one CORS rule." };
      }
      const invalidIndex = parsed.findIndex((rule) => !isJsonObject(rule));
      if (invalidIndex >= 0) {
        return { error: `CORS rule at index ${invalidIndex} must be a JSON object.` };
      }
      return { rules: parsed as JsonRecord[] };
    }
    return { rules: [parsed] };
  } catch {
    return { error: "Invalid JSON." };
  }
};

export const parsePolicyStatements = (raw: string): ParsePolicyStatementsResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Provide a policy in JSON format." };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isJsonObject(parsed) && !Array.isArray(parsed)) {
      return { error: "Policy must be a JSON object or array." };
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { error: "Provide at least one policy statement." };
      }
      const invalidIndex = parsed.findIndex((statement) => !isJsonObject(statement));
      if (invalidIndex >= 0) {
        return { error: `Policy statement at index ${invalidIndex} must be a JSON object.` };
      }
      return { policy: { Statement: parsed }, statements: parsed as JsonRecord[] };
    }

    const parsedObj = parsed as JsonRecord;
    const rawStatements = parsedObj.Statement;
    if (Array.isArray(rawStatements)) {
      if (rawStatements.length === 0) {
        return { error: "Provide at least one policy statement." };
      }
      const invalidIndex = rawStatements.findIndex((statement) => !isJsonObject(statement));
      if (invalidIndex >= 0) {
        return { error: `Policy statement at index ${invalidIndex} must be a JSON object.` };
      }
      return { policy: parsedObj, statements: rawStatements as JsonRecord[] };
    }

    if (isJsonObject(rawStatements)) {
      return { policy: { ...parsedObj, Statement: [rawStatements] }, statements: [rawStatements] };
    }

    return { policy: { Statement: [parsedObj] }, statements: [parsedObj] };
  } catch {
    return { error: "Invalid JSON." };
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
