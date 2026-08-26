import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BrowserObjectDetailsHeader from "./BrowserObjectDetailsHeader";
import { buildObjectDetailsTabs } from "./browserObjectDetailsModel";
import type { BrowserItem } from "./browserTypes";

const item: BrowserItem = {
  id: "reports/summary.csv",
  key: "reports/summary.csv",
  name: "summary.csv",
  type: "file",
  size: "12 B",
  modified: "2026-08-26 10:00",
  owner: "owner",
  storageClass: "STANDARD",
};

const tabs = buildObjectDetailsTabs({
  hasArchiveTab: true,
  isDeleted: false,
  readOnly: false,
  versioningEnabled: true,
});

describe("BrowserObjectDetailsHeader", () => {
  it("renders object state and forwards actions and tab changes", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const onCopyUrl = vi.fn();
    const onTabChange = vi.fn();
    render(
      <BrowserObjectDetailsHeader
        activeTab="preview"
        bucketName="bucket-a"
        copyUrlDisabled={false}
        currentStorageClass="GLACIER"
        isDeleted={false}
        item={item}
        onCopyUrl={onCopyUrl}
        onDownload={onDownload}
        onTabChange={onTabChange}
        restoreStatusLabel="Restore in progress."
        status={{ message: "Metadata updated.", tone: "success" }}
        tabs={tabs}
      />,
    );

    expect(screen.getByText("summary.csv")).toBeInTheDocument();
    expect(
      screen.getByText("bucket-a / reports/summary.csv"),
    ).toBeInTheDocument();
    expect(screen.getByText("Storage class: GLACIER")).toBeInTheDocument();
    expect(screen.getByText("Restore in progress.")).toBeInTheDocument();
    expect(screen.getByText("Metadata updated.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Download" }));
    await user.click(screen.getByRole("button", { name: "Copy URL" }));
    await user.click(screen.getByRole("tab", { name: "Properties" }));

    expect(onDownload).toHaveBeenCalledOnce();
    expect(onCopyUrl).toHaveBeenCalledOnce();
    expect(onTabChange).toHaveBeenCalledWith("properties");
  });

  it("keeps the Copy URL action visible with its disabled reason", () => {
    render(
      <BrowserObjectDetailsHeader
        activeTab="preview"
        bucketName="bucket-a"
        copyUrlDisabled
        copyUrlDisabledReason="SSE-C requires the signed URL workflow."
        isDeleted={false}
        item={item}
        onCopyUrl={vi.fn()}
        onDownload={vi.fn()}
        onTabChange={vi.fn()}
        status={null}
        tabs={tabs}
      />,
    );

    expect(screen.getByRole("button", { name: "Copy URL" }))
      .toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy URL" })).toHaveAttribute(
      "title",
      "SSE-C requires the signed URL workflow.",
    );
  });

  it("hides object actions for a deleted latest state", () => {
    render(
      <BrowserObjectDetailsHeader
        activeTab="versions"
        bucketName="bucket-a"
        copyUrlDisabled={false}
        isDeleted
        item={item}
        onCopyUrl={vi.fn()}
        onDownload={vi.fn()}
        onTabChange={vi.fn()}
        status={null}
        tabs={[{ id: "versions", label: "Versions" }]}
      />,
    );

    expect(screen.getByText("Deleted")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy URL" }),
    ).not.toBeInTheDocument();
  });
});
