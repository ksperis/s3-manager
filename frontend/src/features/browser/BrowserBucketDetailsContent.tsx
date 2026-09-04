/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import { browserBucketDetails } from "../../api/bucketDetails";
import type {
  Bucket,
  BucketLoggingConfiguration,
  BucketPolicy,
  BucketProperties,
  BucketWebsiteConfiguration,
} from "../../api/bucketContracts";
import PageBanner from "../../components/PageBanner";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import DetailsList from "../shared/DetailsList";
import { formatDateTime } from "./browserUtils";

type BrowserBucketDetailsContentProps = {
  accountId: S3AccountSelector;
  bucketName: string;
  includeStaticWebsite: boolean;
  includeUsage: boolean;
};

type BucketDetailsData = {
  bucket: Bucket | null;
  properties: BucketProperties | null;
  policy: BucketPolicy | null;
  logging: BucketLoggingConfiguration | null;
  website: BucketWebsiteConfiguration | null;
  unavailableSections: number;
};

type FeatureRow = {
  id: string;
  label: string;
  state: string;
  tone: "success" | "neutral" | "warning";
};

function featureRow(
  id: string,
  label: string,
  state: string,
  active: boolean | null,
): FeatureRow {
  return {
    id,
    label,
    state,
    tone: active === null ? "warning" : active ? "success" : "neutral",
  };
}

function unavailableFeature(id: string, label: string): FeatureRow {
  return featureRow(id, label, "Unavailable", null);
}

function buildFeatureRows(
  data: BucketDetailsData | null,
  includeStaticWebsite: boolean,
): FeatureRow[] {
  const properties = data?.properties;
  const rows: FeatureRow[] = [];

  if (properties) {
    const versioning = (properties.versioning_status ?? "Disabled").trim() || "Disabled";
    rows.push(
      featureRow(
        "versioning",
        "Versioning",
        versioning,
        versioning.toLowerCase() === "enabled"
          ? true
          : versioning.toLowerCase() === "disabled"
            ? false
            : null,
      ),
    );
    const objectLockEnabled = Boolean(
      properties.object_lock?.enabled ?? properties.object_lock_enabled,
    );
    rows.push(
      featureRow(
        "object-lock",
        "Object Lock",
        objectLockEnabled ? "Enabled" : "Disabled",
        objectLockEnabled,
      ),
    );
    const publicAccessFlags = properties.public_access_block
      ? [
          properties.public_access_block.block_public_acls,
          properties.public_access_block.ignore_public_acls,
          properties.public_access_block.block_public_policy,
          properties.public_access_block.restrict_public_buckets,
        ]
      : [];
    const publicAccessEnabled =
      publicAccessFlags.length > 0 && publicAccessFlags.every((flag) => flag === true);
    const publicAccessPartial =
      !publicAccessEnabled && publicAccessFlags.some((flag) => flag === true);
    rows.push(
      featureRow(
        "public-access",
        "Block public access",
        publicAccessEnabled ? "Enabled" : publicAccessPartial ? "Partial" : "Disabled",
        publicAccessEnabled || publicAccessPartial,
      ),
      featureRow(
        "lifecycle",
        "Lifecycle rules",
        properties.lifecycle_rules.length > 0 ? "Configured" : "Not set",
        properties.lifecycle_rules.length > 0,
      ),
      featureRow(
        "cors",
        "CORS",
        (properties.cors_rules ?? []).length > 0 ? "Configured" : "Not set",
        (properties.cors_rules ?? []).length > 0,
      ),
    );
  } else {
    rows.push(
      unavailableFeature("versioning", "Versioning"),
      unavailableFeature("object-lock", "Object Lock"),
      unavailableFeature("public-access", "Block public access"),
      unavailableFeature("lifecycle", "Lifecycle rules"),
      unavailableFeature("cors", "CORS"),
    );
  }

  if (data?.policy) {
    const configured = Boolean(
      data.policy.policy && Object.keys(data.policy.policy).length > 0,
    );
    rows.push(
      featureRow(
        "policy",
        "Bucket policy",
        configured ? "Configured" : "Not set",
        configured,
      ),
    );
  } else {
    rows.push(unavailableFeature("policy", "Bucket policy"));
  }

  if (data?.logging) {
    const enabled = Boolean(
      data.logging.enabled && (data.logging.target_bucket ?? "").trim(),
    );
    rows.push(
      featureRow(
        "logging",
        "Access logging",
        enabled ? "Enabled" : "Disabled",
        enabled,
      ),
    );
  } else {
    rows.push(unavailableFeature("logging", "Access logging"));
  }

  if (includeStaticWebsite) {
    if (data?.website) {
      const enabled = Boolean(
        (data.website.index_document ?? "").trim() ||
          (data.website.redirect_all_requests_to?.host_name ?? "").trim() ||
          (data.website.routing_rules ?? []).length > 0,
      );
      rows.push(
        featureRow(
          "website",
          "Static website",
          enabled ? "Enabled" : "Disabled",
          enabled,
        ),
      );
    } else {
      rows.push(unavailableFeature("website", "Static website"));
    }
  }

  const quotaConfigured = Boolean(
    (data?.bucket?.quota_max_size_bytes ?? 0) > 0 ||
      (data?.bucket?.quota_max_objects ?? 0) > 0,
  );
  rows.push(
    data?.bucket
      ? featureRow(
          "quota",
          "Quota",
          quotaConfigured ? "Configured" : "Not set",
          quotaConfigured,
        )
      : unavailableFeature("quota", "Quota"),
  );
  return rows;
}

export default function BrowserBucketDetailsContent({
  accountId,
  bucketName,
  includeStaticWebsite,
  includeUsage,
}: BrowserBucketDetailsContentProps) {
  const [data, setData] = useState<BucketDetailsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
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
    if (requestId !== requestIdRef.current) return;
    const unavailableSections = results.filter((result) => result.status === "rejected").length;
    if (unavailableSections === results.length) {
      const failure = results.find((result) => result.status === "rejected");
      setError(
        extractApiError(
          failure?.status === "rejected" ? failure.reason : null,
          "Unable to load bucket details.",
        ),
      );
    }
    setData({
      bucket: results[0].status === "fulfilled" ? results[0].value : null,
      properties: results[1].status === "fulfilled" ? results[1].value : null,
      policy: results[2].status === "fulfilled" ? results[2].value : null,
      logging: results[3].status === "fulfilled" ? results[3].value : null,
      website: results[4].status === "fulfilled" ? results[4].value : null,
      unavailableSections,
    });
    setLoading(false);
  }, [accountId, bucketName, includeStaticWebsite, includeUsage]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const features = useMemo(
    () => buildFeatureRows(data, includeStaticWebsite),
    [data, includeStaticWebsite],
  );
  const bucket = data?.bucket;
  const owner = bucket?.owner_name ?? bucket?.owner ?? "-";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={cx("text-xs", uiMutedTextClass)}>
          Read-only S3 information for the current Browser connection.
        </p>
        <UiButton size="xs" variant="secondary" loading={loading} onClick={() => void load()}>
          Refresh
        </UiButton>
      </div>

      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {data && data.unavailableSections > 0 && !error ? (
        <PageBanner tone="warning">
          Some bucket information is unavailable for this connection.
        </PageBanner>
      ) : null}

      <UiCard title="Overview">
        {loading && !data ? (
          <p className={cx("text-xs font-semibold", uiMutedTextClass)}>
            Loading bucket details...
          </p>
        ) : (
          <DetailsList
            columns={2}
            items={[
              { label: "Owner", value: owner },
              {
                label: "Created",
                value: bucket?.creation_date
                  ? formatDateTime(bucket.creation_date)
                  : "-",
              },
              {
                label: "Storage used",
                value: formatBytes(bucket?.used_bytes ?? null),
              },
              {
                label: "Object count",
                value:
                  bucket?.object_count != null
                    ? bucket.object_count.toLocaleString()
                    : "-",
              },
              {
                label: "Storage quota",
                value:
                  (bucket?.quota_max_size_bytes ?? 0) > 0
                    ? formatBytes(bucket?.quota_max_size_bytes ?? null)
                    : "Not set",
              },
              {
                label: "Object quota",
                value:
                  (bucket?.quota_max_objects ?? 0) > 0
                    ? (bucket?.quota_max_objects ?? 0).toLocaleString()
                    : "Not set",
              },
            ]}
          />
        )}
      </UiCard>

      <UiCard
        title="Features"
        description="Effective bucket configuration visible to this connection."
      >
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.id}
              className="flex min-w-0 items-center justify-between gap-3 border-b border-[color:var(--ui-border-soft)] py-2 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
            >
              <span className={cx("min-w-0 text-xs font-semibold", uiMutedTextClass)}>
                {feature.label}
              </span>
              <UiBadge tone={feature.tone} className="shrink-0">
                {feature.state}
              </UiBadge>
            </div>
          ))}
        </div>
      </UiCard>
    </div>
  );
}
