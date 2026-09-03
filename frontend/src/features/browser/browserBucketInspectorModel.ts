/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import { browserBucketDetails } from "../../api/bucketDetails";

type BucketInspectorTone = "active" | "inactive" | "unknown";
export type BucketInspectorFeature = {
  state: string;
  tone: BucketInspectorTone;
};
export type BucketInspectorData = {
  creation_date?: string | null;
  used_bytes?: number | null;
  object_count?: number | null;
  quota_max_size_bytes?: number | null;
  quota_max_objects?: number | null;
  features: Record<string, BucketInspectorFeature>;
};
export type BucketInspectorFeatureView = BucketInspectorFeature & {
  key: string;
  label: string;
};

const FEATURE_ORDER = [
  "versioning",
  "object_lock",
  "block_public_access",
  "lifecycle_rules",
  "static_website",
  "quota",
  "bucket_policy",
  "cors",
  "access_logging",
] as const;
const FEATURE_LABELS: Record<string, string> = {
  versioning: "Versioning",
  object_lock: "Object Lock",
  block_public_access: "Block public access",
  lifecycle_rules: "Lifecycle rules",
  static_website: "Static website",
  quota: "Quota",
  bucket_policy: "Bucket policy",
  cors: "CORS",
  access_logging: "Access logging",
};

export const BUCKET_INSPECTOR_FEATURE_CHIP_CLASSES: Record<
  BucketInspectorTone,
  string
> = {
  active:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100",
  inactive:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100",
  unknown: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

const formatFeatureLabel = (featureKey: string) =>
  FEATURE_LABELS[featureKey] ??
  featureKey
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const feature = (
  state: string,
  tone: BucketInspectorTone,
): BucketInspectorFeature => ({ state, tone });

export const fetchBucketInspectorData = async ({
  accountId,
  bucketName,
  includeUsage,
  includeStaticWebsite,
}: {
  accountId: S3AccountSelector;
  bucketName: string;
  includeUsage: boolean;
  includeStaticWebsite: boolean;
}): Promise<BucketInspectorData> => {
  const [statsResult, propertiesResult, policyResult, loggingResult, websiteResult] =
    await Promise.allSettled([
      browserBucketDetails.getBucketStats(accountId, bucketName, {
        with_stats: includeUsage,
      }),
      browserBucketDetails.getBucketProperties(accountId, bucketName),
      browserBucketDetails.getBucketPolicy(accountId, bucketName),
      browserBucketDetails.getBucketLogging(accountId, bucketName),
      includeStaticWebsite
        ? browserBucketDetails.getBucketWebsite(accountId, bucketName)
        : Promise.resolve(null),
    ] as const);

  const selectedBucket =
    statsResult.status === "fulfilled" ? statsResult.value : null;
  const features: Record<string, BucketInspectorFeature> = {};

  if (propertiesResult.status === "fulfilled") {
    const properties = propertiesResult.value;
    const versioningState = (properties.versioning_status ?? "Disabled").trim();
    if (versioningState.toLowerCase() === "enabled") {
      features.versioning = feature("Enabled", "active");
    } else if (versioningState.toLowerCase() === "suspended") {
      features.versioning = feature(versioningState || "Suspended", "unknown");
    } else {
      features.versioning = feature(versioningState || "Disabled", "inactive");
    }

    const objectLockEnabled = Boolean(
      properties.object_lock?.enabled ?? properties.object_lock_enabled,
    );
    features.object_lock = feature(
      objectLockEnabled ? "Enabled" : "Disabled",
      objectLockEnabled ? "active" : "inactive",
    );

    const publicBlock = properties.public_access_block;
    if (!publicBlock) {
      features.block_public_access = feature("Disabled", "inactive");
    } else {
      const flags = [
        publicBlock.block_public_acls,
        publicBlock.ignore_public_acls,
        publicBlock.block_public_policy,
        publicBlock.restrict_public_buckets,
      ];
      const fullyEnabled = flags.every((flag) => flag === true);
      const partiallyEnabled =
        !fullyEnabled && flags.some((flag) => flag === true);
      features.block_public_access = fullyEnabled
        ? feature("Enabled", "active")
        : partiallyEnabled
          ? feature("Partial", "active")
          : feature("Disabled", "inactive");
    }
    features.lifecycle_rules =
      (properties.lifecycle_rules ?? []).length > 0
        ? feature("Enabled", "active")
        : feature("Disabled", "inactive");
    features.cors =
      (properties.cors_rules ?? []).length > 0
        ? feature("Configured", "active")
        : feature("Not set", "inactive");
  } else {
    [
      "versioning",
      "object_lock",
      "block_public_access",
      "lifecycle_rules",
      "cors",
    ].forEach((key) => {
      features[key] = feature("Unavailable", "unknown");
    });
  }

  if (policyResult.status === "fulfilled") {
    const policy = policyResult.value.policy;
    const configured = Boolean(policy && Object.keys(policy).length > 0);
    features.bucket_policy = feature(
      configured ? "Configured" : "Not set",
      configured ? "active" : "inactive",
    );
  } else {
    features.bucket_policy = feature("Unavailable", "unknown");
  }

  if (loggingResult.status === "fulfilled") {
    const logging = loggingResult.value;
    const enabled = Boolean(
      logging.enabled && (logging.target_bucket ?? "").trim().length > 0,
    );
    features.access_logging = feature(
      enabled ? "Enabled" : "Disabled",
      enabled ? "active" : "inactive",
    );
  } else {
    features.access_logging = feature("Unavailable", "unknown");
  }

  if (!includeStaticWebsite || websiteResult.status === "rejected") {
    features.static_website = feature("Unavailable", "unknown");
  } else {
    const website = websiteResult.value;
    const routingRules = Array.isArray(website?.routing_rules)
      ? website.routing_rules
      : [];
    const configured = Boolean(
      (website?.redirect_all_requests_to?.host_name ?? "").trim() ||
        (website?.index_document ?? "").trim() ||
        routingRules.length > 0,
    );
    features.static_website = feature(
      configured ? "Enabled" : "Disabled",
      configured ? "active" : "inactive",
    );
  }

  if (selectedBucket) {
    const quotaConfigured = Boolean(
      (selectedBucket.quota_max_size_bytes ?? 0) > 0 ||
        (selectedBucket.quota_max_objects ?? 0) > 0,
    );
    features.quota = feature(
      quotaConfigured ? "Configured" : "Not set",
      quotaConfigured ? "active" : "inactive",
    );
  } else {
    features.quota = feature("Unavailable", "unknown");
  }

  return {
    creation_date: selectedBucket?.creation_date ?? null,
    used_bytes: selectedBucket?.used_bytes ?? null,
    object_count: selectedBucket?.object_count ?? null,
    quota_max_size_bytes: selectedBucket?.quota_max_size_bytes ?? null,
    quota_max_objects: selectedBucket?.quota_max_objects ?? null,
    features,
  };
};

export const buildBucketInspectorFeatures = (
  data: BucketInspectorData | null,
): BucketInspectorFeatureView[] => {
  const featureMap = data?.features;
  if (!featureMap) return [];
  const orderedKeys = [
    ...FEATURE_ORDER.filter((featureKey) => featureMap[featureKey]),
    ...Object.keys(featureMap).filter(
      (featureKey) => !FEATURE_ORDER.includes(featureKey as (typeof FEATURE_ORDER)[number]),
    ),
  ];
  return orderedKeys.map((featureKey) => ({
    key: featureKey,
    label: formatFeatureLabel(featureKey),
    state: featureMap[featureKey]?.state ?? "Unknown",
    tone: featureMap[featureKey]?.tone ?? "unknown",
  }));
};
