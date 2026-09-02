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
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import ManagerBucketCompareModal from "./ManagerBucketCompareModal";
import ManagerBucketSelectionPanel from "./ManagerBucketSelectionPanel";
import { useS3AccountContext } from "./S3AccountContext";
import { useManagerContexts } from "./useManagerContexts";
import { useManagerBucketSelection } from "./useManagerBucketSelection";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";

export default function ManagerBucketComparePage() {
  const { managerBrowserEnabled } = useS3AccountContext();
  const { generalSettings } = useGeneralSettings();
  const { contexts, contextsLoading, contextsError } = useManagerContexts();
  const {
    clearSelection,
    error: bucketsError,
    filter,
    filteredBuckets,
    loading: bucketsLoading,
    requiresS3AccountSelection,
    selectedBucketList,
    selectedBuckets,
    selectAllFiltered,
    setFilter,
    sourceContext,
    sourceContextId,
    tableStatus,
    toggleBucket,
  } = useManagerBucketSelection();
  const [showCompareModal, setShowCompareModal] = useState(false);
  const managerBrowserAvailable =
    generalSettings.browser_enabled && generalSettings.browser_manager_enabled && managerBrowserEnabled === true;

  const openCompareModal = () => {
    if (selectedBuckets.size === 0) return;
    setShowCompareModal(true);
  };

  return (
    <div className={workflowPageHostClass(showCompareModal)}>
      <PageHeader
        title="Bucket compare"
        description="Compare selected buckets across manager contexts."
        breadcrumbs={managerPageBreadcrumbs("compare")}
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
