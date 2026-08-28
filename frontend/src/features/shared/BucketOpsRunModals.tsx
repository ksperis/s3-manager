/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketIntegrityCheckModal from "./BucketIntegrityCheckModal";
import type { BucketOperationUiTarget } from "./bucketOpsSelectionModel";
import BucketPurgeRunModal from "./BucketPurgeRunModal";
import BucketUsageStatsRunModal from "./BucketUsageStatsRunModal";

type BucketOpsRunModalsProps = {
  endpointId: number | null;
  endpointName?: string | null;
  isStorageOps: boolean;
  onCloseIntegrity: () => void;
  onClosePurge: () => void;
  onCloseUsageStats: () => void;
  showIntegrity: boolean;
  showPurge: boolean;
  showUsageStats: boolean;
  targets: BucketOperationUiTarget[];
};

export default function BucketOpsRunModals({
  endpointId,
  endpointName,
  isStorageOps,
  onCloseIntegrity,
  onClosePurge,
  onCloseUsageStats,
  showIntegrity,
  showPurge,
  showUsageStats,
  targets,
}: BucketOpsRunModalsProps) {
  if (targets.length === 0) return null;

  if (isStorageOps) {
    return (
      <>
        {showIntegrity && (
          <BucketIntegrityCheckModal
            mode="storage-ops"
            targets={targets}
            onClose={onCloseIntegrity}
          />
        )}
        {showPurge && (
          <BucketPurgeRunModal
            mode="storage-ops"
            targets={targets}
            onClose={onClosePurge}
          />
        )}
        {showUsageStats && (
          <BucketUsageStatsRunModal
            mode="storage-ops"
            targets={targets}
            onClose={onCloseUsageStats}
          />
        )}
      </>
    );
  }

  if (!endpointId) return null;
  return (
    <>
      {showIntegrity && (
        <BucketIntegrityCheckModal
          mode="ceph-admin"
          endpointId={endpointId}
          endpointName={endpointName}
          targets={targets}
          onClose={onCloseIntegrity}
        />
      )}
      {showPurge && (
        <BucketPurgeRunModal
          mode="ceph-admin"
          endpointId={endpointId}
          endpointName={endpointName}
          targets={targets}
          onClose={onClosePurge}
        />
      )}
      {showUsageStats && (
        <BucketUsageStatsRunModal
          mode="ceph-admin"
          endpointId={endpointId}
          endpointName={endpointName}
          targets={targets}
          onClose={onCloseUsageStats}
        />
      )}
    </>
  );
}
