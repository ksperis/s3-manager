/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import { type Bucket, listBuckets } from "../../api/buckets";
import { listExecutionContexts, type ExecutionContext } from "../../api/executionContexts";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import UiButton from "../../components/ui/UiButton";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { extractApiError } from "../../utils/apiError";
import ManagerBucketCompareModal from "./ManagerBucketCompareModal";
import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";
import { useS3AccountContext } from "./S3AccountContext";

function extractError(error: unknown): string {
  return extractApiError(error, "Request failed");
}

export default function ManagerBucketComparePage() {
  const { selectedS3AccountId, requiresS3AccountSelection, managerBrowserEnabled } = useS3AccountContext();
  const { generalSettings } = useGeneralSettings();
  const sourceContextId = selectedS3AccountId ?? "";
  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(true);
  const [contextsError, setContextsError] = useState<string | null>(null);
  const [sourceBuckets, setSourceBuckets] = useState<Bucket[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [bucketsError, setBucketsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());
  const [showCompareModal, setShowCompareModal] = useState(false);

  const sourceContext = useMemo(
    () => contexts.find((context) => context.id === sourceContextId) ?? null,
    [contexts, sourceContextId]
  );

  useEffect(() => {
    let canceled = false;
    setContextsLoading(true);
    setContextsError(null);
    listExecutionContexts("manager")
      .then((items) => {
        if (canceled) return;
        setContexts(items);
      })
      .catch((error) => {
        if (canceled) return;
        setContextsError(extractError(error));
      })
      .finally(() => {
        if (!canceled) setContextsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!sourceContextId) {
      setSourceBuckets([]);
      setSelectedBuckets(new Set());
      return;
    }
    let canceled = false;
    setBucketsLoading(true);
    setBucketsError(null);
    listBuckets(sourceContextId, { with_stats: false })
      .then((items) => {
        if (canceled) return;
        const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
        setSourceBuckets(sorted);
        setSelectedBuckets((current) => {
          const next = new Set<string>();
          current.forEach((bucketName) => {
            if (sorted.some((bucket) => bucket.name === bucketName)) {
              next.add(bucketName);
            }
          });
          return next;
        });
      })
      .catch((error) => {
        if (canceled) return;
        setBucketsError(extractError(error));
        setSourceBuckets([]);
      })
      .finally(() => {
        if (!canceled) setBucketsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [sourceContextId]);

  const filteredBuckets = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sourceBuckets;
    return sourceBuckets.filter((bucket) => bucket.name.toLowerCase().includes(needle));
  }, [filter, sourceBuckets]);

  const selectedBucketList = useMemo(() => {
    return [...selectedBuckets].sort((a, b) => a.localeCompare(b));
  }, [selectedBuckets]);
  const managerBrowserAvailable =
    generalSettings.browser_enabled && generalSettings.browser_manager_enabled && managerBrowserEnabled !== false;

  const toggleBucket = (bucketName: string) => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      if (next.has(bucketName)) {
        next.delete(bucketName);
      } else {
        next.add(bucketName);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      filteredBuckets.forEach((bucket) => next.add(bucket.name));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedBuckets(new Set());
  };

  const openCompareModal = () => {
    if (selectedBuckets.size === 0) return;
    setShowCompareModal(true);
  };

  const tableStatus = resolveListTableStatus({
    loading: bucketsLoading,
    error: bucketsError,
    rowCount: filteredBuckets.length,
  });

  return (
    <div className={workflowPageHostClass(showCompareModal)}>
      <PageHeader
        title="Bucket compare"
        description="Compare selected buckets across manager contexts."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Compare" }]}
      />

      {contextsError && <PageBanner tone="error">{contextsError}</PageBanner>}
      {bucketsError && <PageBanner tone="error">{bucketsError}</PageBanner>}

      {!requiresS3AccountSelection ? (
        <PageEmptyState
          title="Bucket compare is unavailable in session mode"
          description="This tool needs a persistent execution context so it can load a source inventory and compare it against other manager contexts."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title="Select a source context before comparing buckets"
          description="Choose a manager execution context to load its buckets, filter the source inventory, and compare selected buckets against other targets."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ManagerBucketSelectionPanel
          description={`${sourceContext ? sourceContext.display_name : "Source context"} · Select source buckets to compare across manager contexts.`}
          filter={filter}
          filterPlaceholder="Filter source buckets"
          onFilterChange={setFilter}
          buckets={filteredBuckets}
          selectedBuckets={selectedBuckets}
          onToggleBucket={toggleBucket}
          onSelectFiltered={selectAllFiltered}
          onClearSelection={clearSelection}
          tableStatus={tableStatus}
          loadingMessage="Loading source buckets..."
          errorMessage="Unable to load buckets."
          emptyMessage="No buckets."
          action={
            <UiButton
              type="button"
              onClick={openCompareModal}
              disabled={selectedBuckets.size === 0 || bucketsLoading || contextsLoading}
              size="sm"
            >
              Compare selected ({selectedBuckets.size})
            </UiButton>
          }
        />
      )}

      {showCompareModal && sourceContextId && selectedBucketList.length > 0 && (
        <ManagerBucketCompareModal
          sourceContextId={sourceContextId}
          sourceContextName={sourceContext?.display_name ?? sourceContextId}
          sourceBuckets={selectedBucketList}
          contexts={contexts}
          managerBrowserEnabled={managerBrowserAvailable}
          onClose={() => setShowCompareModal(false)}
        />
      )}
    </div>
  );
}
