import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdmin";
import {
  BucketOpsFeatureCell,
  BucketOpsOwnerCell,
  BucketOpsS3TagsCell,
  getBucketOpsS3TagsTooltipKey,
} from "./BucketOpsTableCells";

const bucket: CephAdminBucket = {
  name: "archive",
  tenant: "tenant-a",
  owner: "owner-a",
  tags: [
    { key: "env", value: "prod" },
    { key: "project", value: "archive" },
    { key: "region", value: "west" },
    { key: "tier", value: "cold" },
  ],
  features: {
    versioning: { state: "Enabled", tone: "active" },
  },
};

describe("BucketOpsTableCells", () => {
  it("renders compact S3 tags and delegates tooltip transitions", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(
      <BucketOpsS3TagsCell
        bucket={bucket}
        open
        onOpen={onOpen}
        onClose={onClose}
      />,
    );

    expect(getBucketOpsS3TagsTooltipKey(bucket)).toBe(
      "tenant-a:archive:tags",
    );
    expect(screen.getByText("env=prod")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("+1 more tag(s)")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "S3 tags details" });
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("owns the owner tooltip anchor while preserving its async states", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(
      <BucketOpsOwnerCell
        bucket={bucket}
        open
        tooltip={{ status: "ready", ownerName: "Archive owner" }}
        onOpen={onOpen}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("UID: owner-a")).toBeInTheDocument();
    expect(screen.getByText("Owner name: Archive owner")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Resolve owner name" });
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders feature state and details through the shared tooltip", () => {
    render(
      <BucketOpsFeatureCell
        bucket={bucket}
        cacheKey="versioning"
        featureKey="versioning"
        open
        tooltip={{ status: "ready", lines: ["State: Enabled"] }}
        onOpen={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("State: Enabled")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Versioning details" }),
    ).toBeInTheDocument();
  });
});
