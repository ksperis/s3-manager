/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type ReplicationRuleStatus = "Enabled" | "Disabled";

export type GraphicalReplicationRule = {
  id: string;
  status: ReplicationRuleStatus;
  priority: string;
  prefix: string;
  destinationBucket: string;
  deleteMarkerStatus: ReplicationRuleStatus;
};

export type GraphicalReplicationState = {
  role: string;
  rules: GraphicalReplicationRule[];
  hasAdvancedFields: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStatus(value: unknown, fallback: ReplicationRuleStatus): ReplicationRuleStatus {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "disabled" ? "Disabled" : "Enabled";
}

export function createEmptyGraphicalReplicationRule(): GraphicalReplicationRule {
  return {
    id: "",
    status: "Enabled",
    priority: "",
    prefix: "",
    destinationBucket: "",
    deleteMarkerStatus: "Disabled",
  };
}

export function containsUnsupportedReplicationZone(configuration: Record<string, unknown>): boolean {
  const rulesRaw = configuration["Rules"];
  if (!Array.isArray(rulesRaw)) return false;
  for (const ruleRaw of rulesRaw) {
    const rule = asRecord(ruleRaw);
    const destination = asRecord(rule?.["Destination"]);
    if (destination && Object.prototype.hasOwnProperty.call(destination, "Zone")) {
      return true;
    }
  }
  return false;
}

export function parseReplicationConfigurationForGraphical(
  configuration: Record<string, unknown>
): GraphicalReplicationState {
  const topLevelAllowed = new Set(["Role", "Rules"]);
  const hasUnsupportedTopLevel = Object.keys(configuration).some((key) => !topLevelAllowed.has(key));
  const role = typeof configuration["Role"] === "string" ? configuration["Role"] : "";
  const rulesRaw = Array.isArray(configuration["Rules"]) ? configuration["Rules"] : [];
  let hasAdvancedFields = hasUnsupportedTopLevel;
  const parsedRules: GraphicalReplicationRule[] = [];

  for (const rawRule of rulesRaw) {
    const rule = asRecord(rawRule);
    if (!rule) {
      hasAdvancedFields = true;
      continue;
    }

    const allowedRuleKeys = new Set([
      "ID",
      "Status",
      "Priority",
      "Prefix",
      "Filter",
      "Destination",
      "DeleteMarkerReplication",
    ]);
    if (Object.keys(rule).some((key) => !allowedRuleKeys.has(key))) {
      hasAdvancedFields = true;
    }

    let prefix = "";
    if (typeof rule["Prefix"] === "string") {
      prefix = rule["Prefix"] as string;
    }
    const filter = asRecord(rule["Filter"]);
    if (filter) {
      if (Object.keys(filter).some((key) => key !== "Prefix")) {
        hasAdvancedFields = true;
      }
      const filterPrefix = filter["Prefix"];
      if (typeof filterPrefix === "string") {
        if (prefix && prefix !== filterPrefix) {
          hasAdvancedFields = true;
        }
        prefix = filterPrefix;
      }
    }

    const destination = asRecord(rule["Destination"]);
    let destinationBucket = "";
    if (destination) {
      if (Object.keys(destination).some((key) => key !== "Bucket")) {
        hasAdvancedFields = true;
      }
      if (typeof destination["Bucket"] === "string") {
        destinationBucket = destination["Bucket"] as string;
      }
    }

    const deleteMarkerReplication = asRecord(rule["DeleteMarkerReplication"]);
    let deleteMarkerStatus: ReplicationRuleStatus = "Disabled";
    if (deleteMarkerReplication) {
      if (Object.keys(deleteMarkerReplication).some((key) => key !== "Status")) {
        hasAdvancedFields = true;
      }
      deleteMarkerStatus = normalizeStatus(deleteMarkerReplication["Status"], "Disabled");
    }

    let priority = "";
    const priorityRaw = rule["Priority"];
    if (typeof priorityRaw === "number" && Number.isFinite(priorityRaw)) {
      priority = String(Math.trunc(priorityRaw));
    } else if (typeof priorityRaw === "string" && priorityRaw.trim().length > 0) {
      priority = priorityRaw.trim();
    }

    parsedRules.push({
      id: typeof rule["ID"] === "string" ? (rule["ID"] as string) : "",
      status: normalizeStatus(rule["Status"], "Enabled"),
      priority,
      prefix,
      destinationBucket,
      deleteMarkerStatus,
    });
  }

  return {
    role,
    rules: parsedRules.length > 0 ? parsedRules : [createEmptyGraphicalReplicationRule()],
    hasAdvancedFields,
  };
}

export function buildReplicationConfigurationFromGraphical(
  role: string,
  rules: GraphicalReplicationRule[]
): Record<string, unknown> {
  const normalizedRules = rules.map((rule) => {
    const nextRule: Record<string, unknown> = {
      Status: rule.status === "Disabled" ? "Disabled" : "Enabled",
      Destination: {
        Bucket: rule.destinationBucket.trim(),
      },
      DeleteMarkerReplication: {
        Status: rule.deleteMarkerStatus === "Disabled" ? "Disabled" : "Enabled",
      },
    };
    const id = rule.id.trim();
    if (id) {
      nextRule["ID"] = id;
    }
    const priority = rule.priority.trim();
    if (priority) {
      const asNumber = Number(priority);
      if (Number.isFinite(asNumber)) {
        nextRule["Priority"] = Math.trunc(asNumber);
      }
    }
    const prefix = rule.prefix.trim();
    if (prefix) {
      nextRule["Filter"] = { Prefix: prefix };
    }
    return nextRule;
  });
  return {
    Role: role.trim(),
    Rules: normalizedRules,
  };
}

export function validateGraphicalReplication(role: string, rules: GraphicalReplicationRule[]): string | null {
  if (!role.trim()) {
    return "Role is required.";
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    return "At least one replication rule is required.";
  }
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule.destinationBucket.trim()) {
      return `Rule ${index + 1}: Destination bucket ARN is required.`;
    }
    const priority = rule.priority.trim();
    if (priority) {
      const value = Number(priority);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        return `Rule ${index + 1}: Priority must be a positive integer.`;
      }
    }
  }
  return null;
}

export function validateJsonReplicationConfiguration(configuration: unknown): string | null {
  const config = asRecord(configuration);
  if (!config) {
    return "Replication configuration must be a JSON object.";
  }
  const rules = config["Rules"];
  if (!Array.isArray(rules) || rules.length === 0) {
    return "Replication configuration must include a non-empty Rules array.";
  }
  if (containsUnsupportedReplicationZone(config)) {
    return "Destination.Zone is not supported in V1.";
  }
  return null;
}
