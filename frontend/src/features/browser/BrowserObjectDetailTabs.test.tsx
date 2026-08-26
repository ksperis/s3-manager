import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browser";
import BrowserObjectArchiveTab from "./BrowserObjectArchiveTab";
import BrowserObjectProtectionTab from "./BrowserObjectProtectionTab";
import BrowserObjectVersionsTab from "./BrowserObjectVersionsTab";
import { OBJECT_LOCK_DISABLED_MESSAGE } from "./browserObjectDetailsModel";
import type { ObjectRetentionMode } from "./useBrowserObjectProtection";

const version: BrowserObjectVersion = {
  key: "reports/summary.csv",
  version_id: "version-a",
  is_latest: true,
  is_delete_marker: false,
};

describe("Browser object detail tabs", () => {
  it("forwards version refresh, pagination, restore, and delete actions", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onLoadMore = vi.fn();
    const onRestoreVersion = vi.fn();
    const onDeleteVersion = vi.fn();
    render(
      <BrowserObjectVersionsTab
        versions={[version]}
        loading={false}
        savingAction={false}
        error={null}
        canLoadMore
        onRefresh={onRefresh}
        onLoadMore={onLoadMore}
        onRestoreVersion={onRestoreVersion}
        onDeleteVersion={onDeleteVersion}
        readOnly={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(
      screen.getByRole("button", { name: "Load more versions" }),
    );
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(
      screen.getByRole("button", { name: "Delete version" }),
    );

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(onRestoreVersion).toHaveBeenCalledWith(version);
    expect(onDeleteVersion).toHaveBeenCalledWith(version);
  });

  it("forwards archive inputs and displays the current restore state", async () => {
    const user = userEvent.setup();
    const onDaysChange = vi.fn();
    const onTierChange = vi.fn();
    const onRestore = vi.fn();
    render(
      <BrowserObjectArchiveTab
        days="7"
        onDaysChange={onDaysChange}
        tier="Standard"
        onTierChange={onTierChange}
        saving={false}
        onRestore={onRestore}
        currentStorageClass="GLACIER"
        restoreStatusLabel="Restore in progress."
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Days" }), {
      target: { value: "14" },
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Tier" }),
      "Bulk",
    );
    await user.click(screen.getByRole("button", { name: "Request restore" }));

    expect(onDaysChange).toHaveBeenCalledWith("14");
    expect(onTierChange).toHaveBeenCalledWith("Bulk");
    expect(onRestore).toHaveBeenCalledOnce();
    expect(screen.getByText("GLACIER")).toBeInTheDocument();
    expect(screen.getByText("Restore in progress.")).toBeInTheDocument();
  });

  it("forwards access controls and disables unavailable Object Lock actions", async () => {
    const user = userEvent.setup();
    const onAclChange = vi.fn();
    const onSaveAcl = vi.fn();
    const onGeneratePresign = vi.fn();
    const onCopyPresign = vi.fn();
    const baseProps = {
      aclValue: "private",
      legalHoldError: null,
      legalHoldStatus: "OFF" as const,
      objectLockUnavailable: true,
      onAclChange,
      onCopyPresign,
      onGeneratePresign,
      onLegalHoldStatusChange: vi.fn(),
      onPresignExpiresChange: vi.fn(),
      onRetentionBypassChange: vi.fn(),
      onRetentionDateChange: vi.fn(),
      onRetentionModeChange: vi.fn(),
      onSaveAcl,
      onSaveLegalHold: vi.fn(),
      onSaveRetention: vi.fn(),
      presignError: null,
      presignExpires: "2026-08-26T12:00",
      presignHeaders: { "x-amz-server-side-encryption-customer-key": "key" },
      presignMethod: "GET",
      presignUrl: "https://objects.example.test/report.txt",
      protectionLoading: false,
      retentionBypass: false,
      retentionDate: "",
      retentionError: null,
      retentionMode: "" as ObjectRetentionMode,
      savingAcl: false,
      savingLegalHold: false,
      savingPresign: false,
      savingRetention: false,
      sseCustomerKeyActive: true,
    };
    render(<BrowserObjectProtectionTab {...baseProps} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Canned ACL" }),
      "public-read",
    );
    await user.click(screen.getByRole("button", { name: "Save ACL" }));
    await user.click(screen.getByRole("button", { name: "Generate URL" }));
    await user.click(screen.getByRole("button", { name: "Copy URL" }));

    expect(onAclChange).toHaveBeenCalledWith("public-read");
    expect(onSaveAcl).toHaveBeenCalledOnce();
    expect(onGeneratePresign).toHaveBeenCalledOnce();
    expect(onCopyPresign).toHaveBeenCalledOnce();
    expect(screen.getAllByText(OBJECT_LOCK_DISABLED_MESSAGE)).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Update legal hold" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Update retention" }),
    ).toBeDisabled();
    expect(screen.getByText(/SSE-C is active/)).toBeInTheDocument();
    expect(
      within(screen.getByText("Headers").parentElement as HTMLElement).getByText(
        /customer-key/,
      ),
    ).toBeInTheDocument();
  });
});
