import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BucketConfigBackupModal, { type BucketConfigBackupFeatureOption } from "./BucketConfigBackupModal";

const baseFeatureOptions: BucketConfigBackupFeatureOption[] = [
  { key: "quota", label: "Quota", available: true },
  { key: "versioning", label: "Versioning", available: true },
  { key: "policy", label: "Bucket policy", available: true },
];

describe("BucketConfigBackupModal", () => {
  it("checks available features by default and submits them", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <BucketConfigBackupModal
        bucketCount={2}
        featureOptions={baseFeatureOptions}
        onClose={onClose}
        onCreate={onCreate}
      />
    );

    expect(screen.getByRole("checkbox", { name: "Quota" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Versioning" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bucket policy" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(["quota", "versioning", "policy"]));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("grays unavailable features and omits them from the request", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <BucketConfigBackupModal
        bucketCount={1}
        featureOptions={[
          { key: "quota", label: "Quota", available: false, unavailableReason: "Bucket stats unavailable" },
          { key: "tags", label: "Tags", available: true },
        ]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />
    );

    expect(screen.getByRole("checkbox", { name: /Quota/ })).toBeDisabled();
    expect(screen.getByText("Bucket stats unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(["tags"]));
  });

  it("shows a readable error when backup creation fails", async () => {
    render(
      <BucketConfigBackupModal
        bucketCount={1}
        featureOptions={baseFeatureOptions}
        onClose={vi.fn()}
        onCreate={vi.fn().mockRejectedValue(new Error("endpoint denied"))}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    expect(await screen.findByText("endpoint denied")).toBeInTheDocument();
  });
});
