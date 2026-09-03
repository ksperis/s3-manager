/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketReplication,
  getBucketReplication,
  putBucketReplication,
} from "../../../api/buckets";
import {
  deleteCephAdminBucketReplication,
  getCephAdminBucketReplication,
  putCephAdminBucketReplication,
} from "../../../api/cephAdminBuckets";
import { extractApiError } from "../../../utils/apiError";
import { createUiDraftId } from "../../../utils/uiDraftId";
import {
  buildReplicationConfigurationFromGraphical,
  containsUnsupportedReplicationZone,
  createEmptyGraphicalReplicationRule,
  isReplicationConfigurationConfigured,
  normalizeReplicationConfiguration,
  parseReplicationConfigurationForGraphical,
  validateGraphicalReplication,
  validateJsonReplicationConfiguration,
  type GraphicalReplicationRule,
} from "../bucketReplication";
import {
  jsonTextSignature,
  stableBucketJsonSignature,
} from "./bucketFeatureState";

type ReplicationMode = "graphical" | "json";
type ReplicationRuleDraft = GraphicalReplicationRule & { uiId: string };

type UseBucketReplicationControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

const advancedFieldsWarning =
  "This configuration has fields not covered by graphical mode. Use JSON mode to avoid losing data.";

function createRuleDraft(
  rule: GraphicalReplicationRule = createEmptyGraphicalReplicationRule(),
): ReplicationRuleDraft {
  return { ...rule, uiId: createUiDraftId("replication-rule") };
}

function normalizeGraphicalDraft(
  role: string,
  rules: GraphicalReplicationRule[],
): Record<string, unknown> {
  return {
    role: role.trim(),
    rules: rules.map((rule) => ({
      delete_marker_status: rule.deleteMarkerStatus,
      destination_bucket: rule.destinationBucket.trim(),
      id: rule.id.trim(),
      prefix: rule.prefix.trim(),
      priority: rule.priority.trim(),
      status: rule.status,
    })),
  };
}

function normalizedConfiguration(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? normalizeReplicationConfiguration(value as Record<string, unknown>)
    : {};
}

export function useBucketReplicationController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketReplicationControllerOptions) {
  const [configuration, setConfiguration] = useState<Record<string, unknown>>(
    {},
  );
  const [mode, setMode] = useState<ReplicationMode>("graphical");
  const [text, setText] = useState("{}");
  const [role, setRole] = useState("");
  const [rules, setRules] = useState<ReplicationRuleDraft[]>([createRuleDraft()]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const apply = useCallback((next: unknown) => {
    const normalized = normalizedConfiguration(next);
    const parsed = parseReplicationConfigurationForGraphical(normalized);
    setConfiguration(normalized);
    setText(
      Object.keys(normalized).length > 0
        ? JSON.stringify(normalized, null, 2)
        : "{}",
    );
    setRole(parsed.role);
    setRules(parsed.rules.map(createRuleDraft));
    setWarning(parsed.hasAdvancedFields ? advancedFieldsWarning : null);
  }, []);

  const clearFeedback = () => {
    setError(null);
    setStatus(null);
  };

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      apply({});
      setError(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const data = cephAdmin
        ? endpointId
          ? await getCephAdminBucketReplication(endpointId, bucketName)
          : { configuration: {} }
        : await getBucketReplication(accountId, bucketName);
      apply(data.configuration);
    } catch (loadFailure) {
      apply({});
      setError(
        extractApiError(
          loadFailure,
          "Unable to load bucket replication configuration.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, apply, bucketName, cephAdmin, enabled, endpointId]);

  const updateMode = (value: ReplicationMode) => {
    setMode(value);
    clearFeedback();
  };

  const updateText = (value: string) => {
    setText(value);
    clearFeedback();
  };

  const updateRole = (value: string) => {
    setRole(value);
    clearFeedback();
  };

  const updateRule = (
    uiId: string,
    patch: Partial<GraphicalReplicationRule>,
  ) => {
    setRules((current) =>
      current.map((rule) => (rule.uiId === uiId ? { ...rule, ...patch } : rule)),
    );
    clearFeedback();
  };

  const addRule = () => {
    setRules((current) => [...current, createRuleDraft()]);
    clearFeedback();
  };

  const removeRule = (uiId: string) => {
    setRules((current) => {
      const next = current.filter((rule) => rule.uiId !== uiId);
      return next.length > 0 ? next : [createRuleDraft()];
    });
    clearFeedback();
  };

  const save = async () => {
    if (!bucketName || !enabled || saving) return;
    clearFeedback();

    let nextConfiguration: Record<string, unknown>;
    if (mode === "graphical") {
      const validationError = validateGraphicalReplication(role, rules);
      if (validationError) {
        setError(validationError);
        return;
      }
      nextConfiguration = buildReplicationConfigurationFromGraphical(role, rules);
    } else {
      let parsed: unknown;
      try {
        parsed = text.trim() ? JSON.parse(text) : {};
      } catch {
        setError("Replication configuration JSON is invalid.");
        return;
      }
      const validationError = validateJsonReplicationConfiguration(parsed);
      if (validationError) {
        setError(validationError);
        return;
      }
      nextConfiguration = parsed as Record<string, unknown>;
    }

    setSaving(true);
    try {
      let saved;
      if (cephAdmin) {
        if (!endpointId) return;
        saved = await putCephAdminBucketReplication(
          endpointId,
          bucketName,
          nextConfiguration,
        );
      } else {
        saved = await putBucketReplication(
          accountId,
          bucketName,
          nextConfiguration,
        );
      }
      apply(saved.configuration);
      setStatus("Replication configuration updated.");
    } catch (saveFailure) {
      setError(
        extractApiError(
          saveFailure,
          "Unable to update bucket replication configuration.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!bucketName || !enabled || clearing) return;
    setClearing(true);
    clearFeedback();
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketReplication(endpointId, bucketName);
      } else {
        await deleteBucketReplication(accountId, bucketName);
      }
      apply({});
      setStatus("Replication configuration cleared.");
    } catch (clearFailure) {
      setError(
        extractApiError(
          clearFailure,
          "Unable to clear bucket replication configuration.",
        ),
      );
    } finally {
      setClearing(false);
    }
  };

  const graphicalSnapshot =
    parseReplicationConfigurationForGraphical(configuration);
  const jsonDraftSignature = jsonTextSignature(text, configuration);
  const dirty =
    mode === "json"
      ? jsonDraftSignature.signature !==
        stableBucketJsonSignature(configuration)
      : stableBucketJsonSignature(normalizeGraphicalDraft(role, rules)) !==
        stableBucketJsonSignature(
          normalizeGraphicalDraft(
            graphicalSnapshot.role,
            graphicalSnapshot.rules,
          ),
        );

  return {
    addRule,
    busy: loading || saving || clearing,
    clear,
    clearing,
    configured: isReplicationConfigurationConfigured(configuration),
    dirty,
    error,
    hasUnsupportedZone: containsUnsupportedReplicationZone(configuration),
    load,
    loading,
    mode,
    removeRule,
    role,
    rules,
    save,
    saving,
    status,
    text,
    updateMode,
    updateRole,
    updateRule,
    updateText,
    warning,
  };
}
