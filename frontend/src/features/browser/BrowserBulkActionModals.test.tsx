import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BrowserBulkAttributesModal from "./BrowserBulkAttributesModal";
import BrowserBulkRestoreModal from "./BrowserBulkRestoreModal";
import BrowserCleanupModal from "./BrowserCleanupModal";
import type { BulkMetadataDraft } from "./browserTypes";

const metadataDraft: BulkMetadataDraft = {
  contentType: "",
  cacheControl: "",
  contentDisposition: "",
  contentEncoding: "",
  contentLanguage: "",
  expires: "",
};

describe("Browser bulk action modals", () => {
  it("renders cleanup feedback with shared inline messages", () => {
    render(
      <BrowserCleanupModal
        currentPath="reports/"
        cleanupKeepLast="3"
        setCleanupKeepLast={vi.fn()}
        cleanupOlderThanDays="30"
        setCleanupOlderThanDays={vi.fn()}
        cleanupDeleteOrphanMarkers={false}
        setCleanupDeleteOrphanMarkers={vi.fn()}
        cleanupError="Cleanup failed"
        cleanupSummary="Cleanup preview ready"
        cleanupLoading={false}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Cleanup failed")).toHaveClass("border-rose-200");
    expect(screen.getByText("Cleanup preview ready")).toHaveClass("border-emerald-200");
  });

  it("renders bulk restore feedback with shared inline messages", () => {
    render(
      <BrowserBulkRestoreModal
        bulkActionFileCount={2}
        bulkActionFolderCount={1}
        bulkRestoreError="Restore failed"
        bulkRestoreSummary="Restore preview ready"
        bulkRestoreTargetPath="reports/"
        bulkRestoreDryRun
        setBulkRestoreDryRun={vi.fn()}
        bulkRestorePreview={null}
        bulkRestoreDate="2026-03-10T09:10"
        setBulkRestoreDate={vi.fn()}
        bulkRestoreDeleteMissing={false}
        setBulkRestoreDeleteMissing={vi.fn()}
        bulkRestoreRestoreDeleted={false}
        setBulkRestoreRestoreDeleted={vi.fn()}
        bulkRestoreLoading={false}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Restore failed")).toHaveClass("border-rose-200");
    expect(screen.getByText("Restore preview ready")).toHaveClass("border-emerald-200");
  });

  it("renders bulk attributes feedback with shared inline messages", () => {
    render(
      <BrowserBulkAttributesModal
        bulkActionFileCount={2}
        bulkActionFolderCount={1}
        bulkAttributesError="Attributes failed"
        bulkAttributesSummary="Attributes updated"
        bulkApplyMetadata={false}
        setBulkApplyMetadata={vi.fn()}
        bulkMetadataDraft={metadataDraft}
        setBulkMetadataDraft={vi.fn()}
        bulkMetadataEntries=""
        setBulkMetadataEntries={vi.fn()}
        bulkApplyTags={false}
        setBulkApplyTags={vi.fn()}
        bulkTagsDraft=""
        setBulkTagsDraft={vi.fn()}
        bulkApplyStorageClass={false}
        setBulkApplyStorageClass={vi.fn()}
        bulkStorageClass="STANDARD"
        setBulkStorageClass={vi.fn()}
        bulkApplyAcl={false}
        setBulkApplyAcl={vi.fn()}
        bulkAclValue="private"
        setBulkAclValue={vi.fn()}
        bulkApplyLegalHold={false}
        setBulkApplyLegalHold={vi.fn()}
        bulkLegalHoldStatus="OFF"
        setBulkLegalHoldStatus={vi.fn()}
        bulkApplyRetention={false}
        setBulkApplyRetention={vi.fn()}
        bulkRetentionMode=""
        setBulkRetentionMode={vi.fn()}
        bulkRetentionDate=""
        setBulkRetentionDate={vi.fn()}
        bulkRetentionBypass={false}
        setBulkRetentionBypass={vi.fn()}
        bulkAttributesLoading={false}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Attributes failed")).toHaveClass("border-rose-200");
    expect(screen.getByText("Attributes updated")).toHaveClass("border-emerald-200");
  });
});
