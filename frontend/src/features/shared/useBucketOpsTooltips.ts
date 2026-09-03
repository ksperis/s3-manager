/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { BucketProperties, CephAdminBucket } from "../../api/cephAdminBuckets";
import {
  PUBLIC_ACCESS_BLOCK_OPTIONS,
  formatPublicAccessBlockFlag,
  formatPublicAccessBlockState,
  normalizePublicAccessBlockState,
} from "./bucketBulkOperationsModel";
import {
  buildBucketPolicySummaryLines,
  buildCorsRuleSummaryLines,
  buildEncryptionSummaryLines,
  buildLifecycleRuleSummaryLines,
  buildLoggingSummaryLines,
  buildNotificationSummaryLines,
  buildObjectLockSummaryLines,
  buildVersioningSummaryLines,
  buildWebsiteSummaryLines,
} from "./bucketFeatureSummaries";
import type { BucketOpsApi } from "./bucketOpsApi";
import type { FeatureKey } from "./bucketOpsAdvancedFilterModel";
import type { BucketFeatureTooltipState } from "./BucketFeatureSummaryTooltip";

type OwnerTooltipState =
  | { status: "loading" }
  | { status: "ready"; ownerName: string | null }
  | { status: "error"; message: string };

type BucketOpsTooltipApi = Pick<
  BucketOpsApi,
  | "getBucketEncryption"
  | "getBucketLogging"
  | "getBucketNotifications"
  | "getBucketPolicy"
  | "getBucketProperties"
  | "getBucketWebsite"
  | "listBuckets"
>;

type UseBucketOpsTooltipsInput = BucketOpsTooltipApi & {
  extractError: (error: unknown) => string;
  missingScopeError: string;
  selectedScopeId: number | null | undefined;
};

export function useBucketOpsTooltips({
  extractError,
  getBucketEncryption,
  getBucketLogging,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketWebsite,
  listBuckets,
  missingScopeError,
  selectedScopeId,
}: UseBucketOpsTooltipsInput) {
  const [activeOwnerTooltipKey, setActiveOwnerTooltipKey] = useState<string | null>(null);
  const [ownerTooltipState, setOwnerTooltipState] = useState<Record<string, OwnerTooltipState>>({});
  const ownerTooltipInflightRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const ownerNameCacheRef = useRef<Record<string, string | null>>({});
  const [activeFeatureTooltipKey, setActiveFeatureTooltipKey] = useState<string | null>(null);
  const [featureTooltipState, setFeatureTooltipState] = useState<Record<string, BucketFeatureTooltipState>>({});
  const featureTooltipInflightRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const bucketPropertiesCacheRef = useRef<Record<string, BucketProperties>>({});
  const bucketPropertiesInflightRef = useRef<Record<string, Promise<BucketProperties>>>({});
  const generationRef = useRef(0);

  const bucketTooltipCacheKey = useCallback(
    (bucket: CephAdminBucket) =>
      `${selectedScopeId ?? "missing"}:${bucket.tenant ?? ""}:${bucket.name}`,
    [selectedScopeId],
  );
  const ownerTooltipCacheKey = useCallback(
    (bucket: CephAdminBucket) =>
      `${bucketTooltipCacheKey(bucket)}:${bucket.owner ?? ""}:owner`,
    [bucketTooltipCacheKey],
  );
  const featureTooltipCacheKey = useCallback(
    (bucket: CephAdminBucket, featureKey: FeatureKey) =>
      `${bucketTooltipCacheKey(bucket)}:${featureKey}`,
    [bucketTooltipCacheKey],
  );

  const resetBucketTooltipState = useCallback(() => {
    generationRef.current += 1;
    setActiveOwnerTooltipKey(null);
    setOwnerTooltipState({});
    ownerTooltipInflightRef.current = {};
    ownerNameCacheRef.current = {};
    setActiveFeatureTooltipKey(null);
    setFeatureTooltipState({});
    featureTooltipInflightRef.current = {};
    bucketPropertiesCacheRef.current = {};
    bucketPropertiesInflightRef.current = {};
  }, []);

  useEffect(() => {
    resetBucketTooltipState();
    return () => {
      generationRef.current += 1;
    };
  }, [resetBucketTooltipState, selectedScopeId]);

  const resolveOwnerNameForBucket = useCallback(
    async (bucket: CephAdminBucket): Promise<string | null> => {
      const inlineOwnerName = (bucket.owner_name || "").trim();
      if (inlineOwnerName) return inlineOwnerName;
      if (!selectedScopeId) return null;

      const bucketKey = bucketTooltipCacheKey(bucket);
      if (Object.prototype.hasOwnProperty.call(ownerNameCacheRef.current, bucketKey)) {
        return ownerNameCacheRef.current[bucketKey];
      }
      const generation = generationRef.current;

      const rules: Array<Record<string, unknown>> = [
        { field: "name", op: "eq", value: bucket.name },
      ];
      if (bucket.tenant?.trim()) {
        rules.push({ field: "tenant", op: "eq", value: bucket.tenant });
      }
      if (bucket.owner?.trim()) {
        rules.push({ field: "owner", op: "eq", value: bucket.owner });
      }
      const response = await listBuckets(selectedScopeId, {
        page: 1,
        page_size: 5,
        advanced_filter: JSON.stringify({ match: "all", rules }),
        include: ["owner_name"],
        with_stats: false,
      });
      const candidate = (response.items ?? []).find(
        (item) =>
          item.name === bucket.name &&
          (item.tenant ?? "") === (bucket.tenant ?? "") &&
          (item.owner ?? "") === (bucket.owner ?? ""),
      );
      const resolvedOwnerName = (candidate?.owner_name || "").trim() || null;
      if (generation === generationRef.current) {
        ownerNameCacheRef.current[bucketKey] = resolvedOwnerName;
      }
      return resolvedOwnerName;
    },
    [bucketTooltipCacheKey, listBuckets, selectedScopeId],
  );

  const loadOwnerTooltip = useCallback(
    (bucket: CephAdminBucket) => {
      if (!selectedScopeId || !bucket.owner) return;
      const key = ownerTooltipCacheKey(bucket);
      const current = ownerTooltipState[key];
      if (current?.status === "ready" || current?.status === "loading") return;
      if (ownerTooltipInflightRef.current[key]) return;

      const generation = generationRef.current;
      const work = (async () => {
        setOwnerTooltipState((previous) => ({
          ...previous,
          [key]: { status: "loading" },
        }));
        try {
          const ownerName = await resolveOwnerNameForBucket(bucket);
          if (generation !== generationRef.current) return;
          setOwnerTooltipState((previous) => ({
            ...previous,
            [key]: { status: "ready", ownerName },
          }));
        } catch (error) {
          if (generation !== generationRef.current) return;
          setOwnerTooltipState((previous) => ({
            ...previous,
            [key]: { status: "error", message: extractError(error) },
          }));
        } finally {
          if (generation === generationRef.current) {
            delete ownerTooltipInflightRef.current[key];
          }
        }
      })();
      ownerTooltipInflightRef.current[key] = work;
    },
    [extractError, ownerTooltipCacheKey, ownerTooltipState, resolveOwnerNameForBucket, selectedScopeId],
  );

  const getBucketPropertiesCached = useCallback(
    async (bucket: CephAdminBucket): Promise<BucketProperties> => {
      if (!selectedScopeId) throw new Error(missingScopeError);
      const bucketKey = bucketTooltipCacheKey(bucket);
      const cached = bucketPropertiesCacheRef.current[bucketKey];
      if (cached) return cached;
      const inflight = bucketPropertiesInflightRef.current[bucketKey];
      if (inflight) return inflight;

      const generation = generationRef.current;
      const promise = getBucketProperties(selectedScopeId, bucket.name)
        .then((properties) => {
          if (generation === generationRef.current) {
            bucketPropertiesCacheRef.current[bucketKey] = properties;
          }
          return properties;
        })
        .finally(() => {
          if (bucketPropertiesInflightRef.current[bucketKey] === promise) {
            delete bucketPropertiesInflightRef.current[bucketKey];
          }
        });
      bucketPropertiesInflightRef.current[bucketKey] = promise;
      return promise;
    },
    [bucketTooltipCacheKey, getBucketProperties, missingScopeError, selectedScopeId],
  );

  const buildFeatureTooltipLines = useCallback(
    async (bucket: CephAdminBucket, featureKey: FeatureKey): Promise<string[]> => {
      if (!selectedScopeId) return [missingScopeError];

      if (featureKey === "versioning") {
        const properties = await getBucketPropertiesCached(bucket);
        return buildVersioningSummaryLines(properties.versioning_status);
      }
      if (featureKey === "object_lock") {
        const properties = await getBucketPropertiesCached(bucket);
        return buildObjectLockSummaryLines(properties.object_lock_enabled, properties.object_lock);
      }
      if (featureKey === "block_public_access") {
        const properties = await getBucketPropertiesCached(bucket);
        const configuration = normalizePublicAccessBlockState(properties.public_access_block);
        return [
          `State: ${formatPublicAccessBlockState(configuration)}`,
          ...PUBLIC_ACCESS_BLOCK_OPTIONS.map(
            (option) => `${option.label}: ${formatPublicAccessBlockFlag(configuration[option.key])}`,
          ),
        ];
      }
      if (featureKey === "lifecycle_rules") {
        const properties = await getBucketPropertiesCached(bucket);
        return buildLifecycleRuleSummaryLines(properties.lifecycle_rules as unknown[]);
      }
      if (featureKey === "cors") {
        const properties = await getBucketPropertiesCached(bucket);
        return buildCorsRuleSummaryLines(
          Array.isArray(properties.cors_rules) ? properties.cors_rules : [],
        );
      }
      if (featureKey === "static_website") {
        const website = await getBucketWebsite(selectedScopeId, bucket.name);
        return buildWebsiteSummaryLines(website as Record<string, unknown>);
      }
      if (featureKey === "bucket_policy") {
        const payload = await getBucketPolicy(selectedScopeId, bucket.name);
        return buildBucketPolicySummaryLines(payload.policy);
      }
      if (featureKey === "access_logging") {
        const logging = await getBucketLogging(selectedScopeId, bucket.name);
        return buildLoggingSummaryLines(logging as Record<string, unknown>);
      }
      if (featureKey === "notifications") {
        const notifications = await getBucketNotifications(selectedScopeId, bucket.name);
        return buildNotificationSummaryLines(notifications.configuration);
      }
      if (featureKey === "server_side_encryption") {
        const encryption = await getBucketEncryption(selectedScopeId, bucket.name);
        return buildEncryptionSummaryLines(encryption.rules);
      }
      return ["No additional details available."];
    },
    [
      getBucketEncryption,
      getBucketLogging,
      getBucketNotifications,
      getBucketPolicy,
      getBucketPropertiesCached,
      getBucketWebsite,
      missingScopeError,
      selectedScopeId,
    ],
  );

  const loadFeatureTooltip = useCallback(
    (bucket: CephAdminBucket, featureKey: FeatureKey) => {
      if (!selectedScopeId) return;
      const key = featureTooltipCacheKey(bucket, featureKey);
      const current = featureTooltipState[key];
      if (current?.status === "ready" || current?.status === "loading") return;
      if (featureTooltipInflightRef.current[key]) return;

      const generation = generationRef.current;
      const work = (async () => {
        setFeatureTooltipState((previous) => ({
          ...previous,
          [key]: { status: "loading" },
        }));
        try {
          const lines = await buildFeatureTooltipLines(bucket, featureKey);
          if (generation !== generationRef.current) return;
          setFeatureTooltipState((previous) => ({
            ...previous,
            [key]: { status: "ready", lines },
          }));
        } catch (error) {
          if (generation !== generationRef.current) return;
          setFeatureTooltipState((previous) => ({
            ...previous,
            [key]: { status: "error", message: extractError(error) },
          }));
        } finally {
          if (generation === generationRef.current) {
            delete featureTooltipInflightRef.current[key];
          }
        }
      })();
      featureTooltipInflightRef.current[key] = work;
    },
    [buildFeatureTooltipLines, extractError, featureTooltipCacheKey, featureTooltipState, selectedScopeId],
  );

  return {
    activeFeatureTooltipKey,
    activeOwnerTooltipKey,
    featureTooltipCacheKey,
    featureTooltipState,
    loadFeatureTooltip,
    loadOwnerTooltip,
    ownerTooltipCacheKey,
    ownerTooltipState,
    resetBucketTooltipState,
    setActiveFeatureTooltipKey,
    setActiveOwnerTooltipKey,
  };
}
