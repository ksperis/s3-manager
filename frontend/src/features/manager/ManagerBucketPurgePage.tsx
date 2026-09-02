/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";

import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import { workflowPageHostClass } from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import BucketPurgeRunModal from "../shared/BucketPurgeRunModal";
import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerBucketSelection } from "./useManagerBucketSelection";

export default function ManagerBucketPurgePage() {
  const {
    clearSelection,
    error,
    filter,
    filteredBuckets,
    loading,
    requiresS3AccountSelection,
    selectedBuckets,
    selectedTargets,
    selectAllFiltered,
    setFilter,
    sourceContext,
    sourceContextId,
    tableStatus,
    toggleBucket,
  } = useManagerBucketSelection();
  const [showPurgeModal, setShowPurgeModal] = useState(false);

  return (
    <div className={workflowPageHostClass(showPurgeModal)}>
      <PageHeader
        title="Bucket purge"
        description="Empty selected buckets without deleting bucket configuration."
        breadcrumbs={managerPageBreadcrumbs("purge")}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!requiresS3AccountSelection ? (
        <PageEmptyState
          title="Bucket purge is unavailable in session mode"
          description="This tool needs a persistent execution context so the selected buckets can be purged with the same manager identity."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title="Select a context before purging buckets"
          description="Choose a manager execution context to load its buckets and launch a purge."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ManagerBucketSelectionPanel
          description={`${sourceContext ? sourceContext.display_name : "Source context"} - Select buckets to purge.`}
          filter={filter}
          filterPlaceholder="Filter buckets"
          onFilterChange={setFilter}
          buckets={filteredBuckets}
          selectedBuckets={selectedBuckets}
          onToggleBucket={toggleBucket}
          onSelectFiltered={selectAllFiltered}
          onClearSelection={clearSelection}
          tableStatus={tableStatus}
          loadingMessage="Loading buckets..."
          errorMessage="Unable to load buckets."
          emptyMessage="No buckets."
          action={
            <UiButton
              type="button"
              onClick={() => setShowPurgeModal(true)}
              disabled={selectedBuckets.size === 0 || loading}
              variant="danger"
              size="sm"
            >
              Purge selected ({selectedBuckets.size})
            </UiButton>
          }
        />
      )}

      {showPurgeModal && sourceContextId && selectedTargets.length > 0 && (
        <BucketPurgeRunModal
          mode="manager"
          contextId={sourceContextId}
          contextName={sourceContext?.display_name ?? sourceContextId}
          targets={selectedTargets}
          onClose={() => setShowPurgeModal(false)}
        />
      )}
    </div>
  );
}
