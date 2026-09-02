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
import BucketIntegrityCheckModal from "../shared/BucketIntegrityCheckModal";
import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerBucketSelection } from "./useManagerBucketSelection";

export default function ManagerBucketIntegrityPage() {
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
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);

  return (
    <div className={workflowPageHostClass(showIntegrityModal)}>
      <PageHeader
        title="Bucket integrity"
        description="Read selected bucket objects and report retrieval failures."
        breadcrumbs={managerPageBreadcrumbs("integrity")}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!requiresS3AccountSelection ? (
        <PageEmptyState
          title="Bucket integrity is unavailable in session mode"
          description="This tool needs a persistent execution context so the selected buckets can be checked with the same manager identity."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title="Select a context before checking buckets"
          description="Choose a manager execution context to load its buckets and launch an integrity check."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ManagerBucketSelectionPanel
          description={`${sourceContext ? sourceContext.display_name : "Source context"} - Select buckets to check.`}
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
              onClick={() => setShowIntegrityModal(true)}
              disabled={selectedBuckets.size === 0 || loading}
              size="sm"
            >
              Check selected ({selectedBuckets.size})
            </UiButton>
          }
        />
      )}

      {showIntegrityModal && sourceContextId && selectedTargets.length > 0 && (
        <BucketIntegrityCheckModal
          mode="manager"
          contextId={sourceContextId}
          contextName={sourceContext?.display_name ?? sourceContextId}
          targets={selectedTargets}
          onClose={() => setShowIntegrityModal(false)}
        />
      )}
    </div>
  );
}
