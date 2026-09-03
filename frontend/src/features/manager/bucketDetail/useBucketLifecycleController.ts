/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketLifecycle,
  getBucketLifecycle,
  putBucketLifecycle,
} from "../../../api/buckets";
import {
  deleteCephAdminBucketLifecycle,
  getCephAdminBucketLifecycle,
  putCephAdminBucketLifecycle,
} from "../../../api/cephAdminBuckets";
import { extractApiError } from "../../../utils/apiError";
import {
  lifecycleRuleId,
  lifecycleRuleStatus,
  type LifecycleRuleRecord,
} from "../bucketLifecycle";
import { jsonTextSignature, stableBucketJsonSignature } from "./bucketFeatureState";

type LifecycleMode = "simple" | "json";

type TransitionDraft = {
  currentDays: string;
  noncurrentDays: string;
  prefix: string;
  storageClass: string;
};

type ExpirationDraft = {
  currentDays: string;
  noncurrentDays: string;
  prefix: string;
};

type UseBucketLifecycleControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

const existingRulesWarning =
  "Rules already exist. Use JSON mode to edit them. The form below only adds a new rule.";

function createRuleId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return `rule-${crypto.randomUUID()}`;
    } catch {
      // Fall back to a local random identifier when randomUUID is unavailable.
    }
  }
  return `rule-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRules(value: unknown): LifecycleRuleRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rule): rule is LifecycleRuleRecord =>
      rule !== null && typeof rule === "object" && !Array.isArray(rule),
  );
}

export function useBucketLifecycleController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketLifecycleControllerOptions) {
  const [rules, setRules] = useState<LifecycleRuleRecord[]>([]);
  const [text, setText] = useState("[]");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<LifecycleMode>("json");
  const [warning, setWarning] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [transitionDraft, setTransitionDraft] = useState<TransitionDraft>({
    currentDays: "30",
    noncurrentDays: "60",
    prefix: "",
    storageClass: "GLACIER",
  });
  const [expirationDraft, setExpirationDraft] = useState<ExpirationDraft>({
    currentDays: "",
    noncurrentDays: "90",
    prefix: "",
  });

  const applyRules = useCallback((next: unknown) => {
    const normalized = normalizeRules(next);
    setRules(normalized);
    setText(normalized.length > 0 ? JSON.stringify(normalized, null, 2) : "[]");
    setWarning(normalized.length > 0 ? existingRulesWarning : null);
  }, []);

  const clearFeedback = () => {
    setError(null);
    setStatus(null);
  };

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      applyRules([]);
      clearFeedback();
      return;
    }
    setLoading(true);
    clearFeedback();
    try {
      let data;
      if (cephAdmin) {
        if (!endpointId) {
          applyRules([]);
          return;
        }
        data = await getCephAdminBucketLifecycle(endpointId, bucketName);
      } else {
        data = await getBucketLifecycle(accountId, bucketName);
      }
      applyRules(data.rules);
    } catch (loadFailure) {
      applyRules([]);
      setError(extractApiError(loadFailure, "Unable to load lifecycle rules."));
    } finally {
      setLoading(false);
    }
  }, [accountId, applyRules, bucketName, cephAdmin, enabled, endpointId]);

  const persist = async (nextRules: LifecycleRuleRecord[]) => {
    if (!bucketName || !enabled || saving) return false;
    setSaving(true);
    clearFeedback();
    try {
      if (nextRules.length === 0) {
        if (cephAdmin) {
          if (!endpointId) return false;
          await deleteCephAdminBucketLifecycle(endpointId, bucketName);
        } else {
          await deleteBucketLifecycle(accountId, bucketName);
        }
        applyRules([]);
        setStatus("Lifecycle deleted");
        return true;
      }

      let saved;
      if (cephAdmin) {
        if (!endpointId) return false;
        saved = await putCephAdminBucketLifecycle(
          endpointId,
          bucketName,
          nextRules,
        );
      } else {
        saved = await putBucketLifecycle(accountId, bucketName, nextRules);
      }
      applyRules(saved.rules ?? nextRules);
      setStatus("Lifecycle updated");
      return true;
    } catch (saveFailure) {
      setError(extractApiError(saveFailure, "Invalid or unsaved lifecycle."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (mode !== "json") return;
    let parsed: unknown;
    try {
      parsed = text.trim() ? JSON.parse(text) : [];
    } catch {
      setError("Lifecycle rules JSON is invalid.");
      return;
    }
    if (!Array.isArray(parsed)) {
      setError("JSON must be an array of rules.");
      return;
    }
    if (
      parsed.some(
        (rule) =>
          rule === null || typeof rule !== "object" || Array.isArray(rule),
      )
    ) {
      setError("Each lifecycle rule must be a JSON object.");
      return;
    }
    await persist(parsed as LifecycleRuleRecord[]);
  };

  const updateRules = async (
    updater: (current: LifecycleRuleRecord[]) => LifecycleRuleRecord[],
  ) => {
    await persist(updater(rules));
  };

  const deleteRule = async (index: number) => {
    await updateRules((current) => current.filter((_, item) => item !== index));
  };

  const toggleRuleStatus = async (index: number) => {
    await updateRules((current) =>
      current.map((rule, item) =>
        item === index
          ? {
              ...rule,
              Status:
                lifecycleRuleStatus(rule) === "Enabled"
                  ? "Disabled"
                  : "Enabled",
            }
          : rule,
      ),
    );
  };

  const addRule = async (rule: LifecycleRuleRecord) => {
    const nextRule = {
      ...rule,
      ID: lifecycleRuleId(rule) ?? createRuleId(),
    };
    const nextRules = [...rules, nextRule];
    setMode("json");
    setText(JSON.stringify(nextRules, null, 2));
    if (await persist(nextRules)) {
      setEditorVisible(true);
    }
  };

  const addCleanupExample = async () => {
    await addRule({
      Status: "Enabled",
      Filter: { Prefix: "" },
      NoncurrentVersionExpiration: { NoncurrentDays: 90 },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 30 },
      Expiration: { ExpiredObjectDeleteMarker: true },
    });
  };

  const addTransitionExample = async () => {
    await addRule({
      Status: "Enabled",
      Filter: { Prefix: transitionDraft.prefix },
      Transitions: [
        {
          Days: Number(transitionDraft.currentDays) || 0,
          StorageClass: transitionDraft.storageClass || "GLACIER",
        },
      ],
      NoncurrentVersionTransitions: [
        {
          NoncurrentDays: Number(transitionDraft.noncurrentDays) || 0,
          StorageClass: transitionDraft.storageClass || "GLACIER",
        },
      ],
    });
  };

  const addExpirationExample = async () => {
    const currentDays = expirationDraft.currentDays.trim();
    const noncurrentDays = expirationDraft.noncurrentDays.trim();
    if (!currentDays && !noncurrentDays) {
      setError("Provide current or noncurrent expiration days.");
      return;
    }
    const rule: LifecycleRuleRecord = {
      Status: "Enabled",
      Filter: { Prefix: expirationDraft.prefix },
    };
    if (currentDays) {
      rule.Expiration = { Days: Number(currentDays) };
    }
    if (noncurrentDays) {
      rule.NoncurrentVersionExpiration = {
        NoncurrentDays: Number(noncurrentDays),
      };
    }
    await addRule(rule);
  };

  const updateMode = (value: LifecycleMode) => {
    setMode(value);
    clearFeedback();
  };

  const updateText = (value: string) => {
    setText(value);
    clearFeedback();
  };

  return {
    addCleanupExample,
    addExpirationExample,
    addTransitionExample,
    deleteRule,
    dirty:
      mode === "json" &&
      jsonTextSignature(text, rules).signature !== stableBucketJsonSignature(rules),
    editorVisible,
    error,
    expirationDraft,
    hasRules: rules.length > 0,
    load,
    loading,
    mode,
    ruleCount: rules.length,
    rules,
    save,
    saving,
    status,
    text,
    toggleEditor: () => setEditorVisible((current) => !current),
    toggleRuleStatus,
    transitionDraft,
    updateExpirationDraft: (patch: Partial<ExpirationDraft>) => {
      setExpirationDraft((current) => ({ ...current, ...patch }));
      clearFeedback();
    },
    updateMode,
    updateText,
    updateTransitionDraft: (patch: Partial<TransitionDraft>) => {
      setTransitionDraft((current) => ({ ...current, ...patch }));
      clearFeedback();
    },
    warning,
  };
}
