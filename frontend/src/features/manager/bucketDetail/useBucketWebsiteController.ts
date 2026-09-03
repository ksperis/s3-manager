/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3AccountSelector } from "../../../api/accountParams";
import {
  deleteBucketWebsite,
  getBucketWebsite,
  putBucketWebsite,
} from "../../../api/bucketDetails";
import type { BucketWebsiteConfiguration } from "../../../api/bucketContracts";
import {
  deleteCephAdminBucketWebsite,
  getCephAdminBucketWebsite,
  putCephAdminBucketWebsite,
} from "../../../api/cephAdminBucketDetails";
import { extractApiError } from "../../../utils/apiError";
import { jsonTextSignature, stableBucketJsonSignature } from "./bucketFeatureState";

type WebsiteMode = "hosting" | "redirect";

type WebsiteDraft = {
  errorDocument: string;
  indexDocument: string;
  mode: WebsiteMode;
  redirectHost: string;
  redirectProtocol: string;
  routingRules: string;
};

type UseBucketWebsiteControllerOptions = {
  accountId: S3AccountSelector;
  bucketName?: string;
  cephAdmin: boolean;
  enabled: boolean;
  endpointId?: number | null;
};

const emptyDraft: WebsiteDraft = {
  errorDocument: "",
  indexDocument: "",
  mode: "hosting",
  redirectHost: "",
  redirectProtocol: "",
  routingRules: "[]",
};

function configurationToDraft(config?: BucketWebsiteConfiguration | null): WebsiteDraft {
  if (!config) return emptyDraft;
  const redirect = config.redirect_all_requests_to ?? null;
  const routingRules = Array.isArray(config.routing_rules) ? config.routing_rules : [];
  return {
    errorDocument: config.error_document ?? "",
    indexDocument: config.index_document ?? "",
    mode: (redirect?.host_name ?? "").trim() ? "redirect" : "hosting",
    redirectHost: redirect?.host_name ?? "",
    redirectProtocol: redirect?.protocol ?? "",
    routingRules: routingRules.length > 0 ? JSON.stringify(routingRules, null, 2) : "[]",
  };
}

function draftSignature(draft: WebsiteDraft): string {
  const routingRules = jsonTextSignature(draft.routingRules, []).signature;
  return stableBucketJsonSignature({
    error_document: draft.errorDocument.trim(),
    index_document: draft.indexDocument.trim(),
    mode: draft.mode,
    redirect_host: draft.redirectHost.trim(),
    redirect_protocol: draft.redirectProtocol.trim(),
    routing_rules:
      draft.mode === "hosting"
        ? routingRules
        : stableBucketJsonSignature([] as Record<string, unknown>[]),
  });
}

export function useBucketWebsiteController({
  accountId,
  bucketName,
  cephAdmin,
  enabled,
  endpointId,
}: UseBucketWebsiteControllerOptions) {
  const [draft, setDraft] = useState<WebsiteDraft>(emptyDraft);
  const [snapshot, setSnapshot] = useState<WebsiteDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const apply = useCallback((config?: BucketWebsiteConfiguration | null) => {
    const next = configurationToDraft(config);
    setDraft(next);
    setSnapshot(next);
  }, []);

  const load = useCallback(async () => {
    if (!bucketName || !enabled) {
      apply();
      setError(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const config = cephAdmin
        ? endpointId
          ? await getCephAdminBucketWebsite(endpointId, bucketName)
          : null
        : await getBucketWebsite(accountId, bucketName);
      apply(config);
    } catch (loadError) {
      apply();
      setError(
        extractApiError(
          loadError,
          "Unable to load bucket website configuration.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, apply, bucketName, cephAdmin, enabled, endpointId]);

  const update = <Key extends keyof WebsiteDraft>(
    key: Key,
    value: WebsiteDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setStatus(null);
  };

  const save = async () => {
    if (!bucketName || !enabled) return;
    setError(null);
    setStatus(null);

    const indexDocument = draft.indexDocument.trim();
    const errorDocument = draft.errorDocument.trim();
    const redirectHost = draft.redirectHost.trim();
    const redirectProtocol = draft.redirectProtocol.trim();
    if (draft.mode === "redirect" && !redirectHost) {
      setError("Redirect hostname is required.");
      return;
    }
    if (draft.mode === "hosting" && !indexDocument) {
      setError("Index document is required.");
      return;
    }

    let routingRules: Record<string, unknown>[] = [];
    if (draft.mode === "hosting" && draft.routingRules.trim()) {
      try {
        const parsed: unknown = JSON.parse(draft.routingRules);
        if (!Array.isArray(parsed)) {
          setError("Routing rules must be a JSON array.");
          return;
        }
        routingRules = parsed as Record<string, unknown>[];
      } catch {
        setError("Routing rules must be valid JSON.");
        return;
      }
    }

    setSaving(true);
    try {
      const payload: BucketWebsiteConfiguration = {
        error_document:
          draft.mode === "hosting" ? errorDocument || null : null,
        index_document: draft.mode === "hosting" ? indexDocument : null,
        redirect_all_requests_to:
          draft.mode === "redirect"
            ? {
                host_name: redirectHost,
                protocol: redirectProtocol || undefined,
              }
            : null,
        routing_rules: draft.mode === "hosting" ? routingRules : [],
      };
      const saved = cephAdmin
        ? endpointId
          ? await putCephAdminBucketWebsite(endpointId, bucketName, payload)
          : payload
        : await putBucketWebsite(accountId, bucketName, payload);
      apply(saved);
      setStatus("Website configuration updated.");
    } catch (saveError) {
      setError(
        extractApiError(
          saveError,
          "Unable to update website configuration.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!bucketName || !enabled) return;
    setClearing(true);
    setError(null);
    setStatus(null);
    try {
      if (cephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketWebsite(endpointId, bucketName);
      } else {
        await deleteBucketWebsite(accountId, bucketName);
      }
      apply();
      setStatus("Website configuration cleared.");
    } catch (clearError) {
      setError(
        extractApiError(
          clearError,
          "Unable to delete website configuration.",
        ),
      );
    } finally {
      setClearing(false);
    }
  };

  const configured = Boolean(
    snapshot.redirectHost.trim() ||
      snapshot.indexDocument.trim() ||
      jsonTextSignature(snapshot.routingRules, []).signature !==
        stableBucketJsonSignature([]),
  );
  return {
    clear,
    clearing,
    configured,
    dirty: draftSignature(draft) !== draftSignature(snapshot),
    error,
    errorDocument: draft.errorDocument,
    indexDocument: draft.indexDocument,
    load,
    loading,
    mode: draft.mode,
    redirectHost: draft.redirectHost,
    redirectProtocol: draft.redirectProtocol,
    routingRules: draft.routingRules,
    save,
    saving,
    status,
    updateErrorDocument: (value: string) => update("errorDocument", value),
    updateIndexDocument: (value: string) => update("indexDocument", value),
    updateMode: (value: WebsiteMode) => update("mode", value),
    updateRedirectHost: (value: string) => update("redirectHost", value),
    updateRedirectProtocol: (value: string) =>
      update("redirectProtocol", value),
    updateRoutingRules: (value: string) => update("routingRules", value),
  };
}
