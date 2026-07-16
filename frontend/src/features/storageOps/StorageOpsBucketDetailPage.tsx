/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { STORAGE_OPS_SCOPE_ID, listStorageOpsBuckets, type StorageOpsBucket } from "../../api/storageOps";
import { listExecutionContexts } from "../../api/executionContexts";
import PageEmptyState from "../../components/PageEmptyState";
import WorkflowPage from "../../components/WorkflowPage";
import { extractApiError } from "../../utils/apiError";
import BucketDetailPage from "../manager/BucketDetailPage";
import { useBucketListBackNavigation } from "../shared/bucketListReturnContext";

type BucketDetailLocationState = {
  bucketQuotaAvailable?: boolean;
};

export default function StorageOpsBucketDetailPage() {
  const { bucketName = "" } = useParams<{ bucketName: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const contextId = searchParams.get("ctx")?.trim() ?? "";
  const initialQuotaAvailable = (location.state as BucketDetailLocationState | null)?.bucketQuotaAvailable;
  const [bucket, setBucket] = useState<StorageOpsBucket | null>(null);
  const [contextAvailable, setContextAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(Boolean(bucketName && contextId));
  const [error, setError] = useState<string | null>(null);
  const { listUrl, onBack } = useBucketListBackNavigation("storage-ops", "/storage-ops/buckets");

  const exactFilter = useMemo(
    () =>
      JSON.stringify({
        match: "all",
        rules: [
          { field: "context_id", op: "eq", value: contextId },
          { field: "name", op: "eq", value: bucketName },
        ],
      }),
    [bucketName, contextId]
  );

  useEffect(() => {
    if (!bucketName || !contextId) {
      setBucket(null);
      setContextAvailable(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setContextAvailable(null);
    Promise.all([
      listExecutionContexts("manager", { signal: controller.signal }),
      listStorageOpsBuckets(
        STORAGE_OPS_SCOPE_ID,
        {
          page: 1,
          page_size: 1,
          advanced_filter: exactFilter,
          with_stats: false,
        },
        { signal: controller.signal }
      ),
    ])
      .then(([contexts, response]) => {
        const hasContext = contexts.some((context) => context.id === contextId);
        setContextAvailable(hasContext);
        if (!hasContext) {
          setBucket(null);
          return;
        }
        const match = response.items.find(
          (item) => item.context_id === contextId && (item.bucket_name ?? item.name) === bucketName
        );
        setBucket(match ?? null);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setBucket(null);
        setContextAvailable(null);
        setError(extractApiError(requestError, "Unable to load this Storage Ops bucket."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [bucketName, contextId, exactFilter]);

  const breadcrumbs = [
    { label: "Storage Ops", to: "/storage-ops" },
    { label: "Buckets", to: listUrl },
    { label: bucketName || "Bucket" },
  ];

  return (
    <WorkflowPage
      title={bucketName ? `Configure bucket · ${bucketName}` : "Bucket configuration"}
      description="Review and update the complete S3 API configuration for its selected execution context."
      breadcrumbs={breadcrumbs}
      backLabel="Back to buckets"
      onBack={onBack}
      contentVariant="plain"
    >
      {!contextId ? (
        <PageEmptyState
          title="Execution context required"
          description="This Storage Ops bucket URL must include an explicit ctx query parameter. Return to the bucket list and open the bucket again."
          tone="warning"
          primaryAction={{ label: "Back to buckets", onClick: onBack }}
        />
      ) : !bucketName ? (
        <PageEmptyState
          title="Bucket name required"
          description="This Storage Ops bucket URL does not identify a bucket."
          tone="warning"
          primaryAction={{ label: "Back to buckets", onClick: onBack }}
        />
      ) : loading ? (
        <PageEmptyState
          eyebrow="Loading"
          title="Loading bucket configuration"
          description={`Validating ${bucketName} in execution context ${contextId}.`}
        />
      ) : error ? (
        <PageEmptyState
          title="Bucket configuration unavailable"
          description={error}
          tone="danger"
          primaryAction={{ label: "Back to buckets", onClick: onBack }}
        />
      ) : contextAvailable === false ? (
        <PageEmptyState
          title="Execution context unavailable"
          description={`Execution context ${contextId} does not exist or is no longer available to Storage Ops.`}
          tone="warning"
          primaryAction={{ label: "Back to buckets", onClick: onBack }}
        />
      ) : !bucket ? (
        <PageEmptyState
          title="Bucket not found"
          description={`No bucket named ${bucketName} is available in execution context ${contextId}.`}
          tone="warning"
          primaryAction={{ label: "Back to buckets", onClick: onBack }}
        />
      ) : (
        <BucketDetailPage
          mode="manager"
          bucketNameOverride={bucketName}
          accountIdOverride={contextId}
          quotaAvailableOverride={bucket.bucket_quota_available ?? initialQuotaAvailable ?? false}
          embedded
          hideObjectsTab
        />
      )}
    </WorkflowPage>
  );
}
