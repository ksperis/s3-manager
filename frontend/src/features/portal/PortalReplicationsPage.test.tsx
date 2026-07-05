/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalReplicationsPage from "./PortalReplicationsPage";

const mocks = vi.hoisted(() => ({
  listPortalReplications: vi.fn(),
  createPortalReplication: vi.fn(),
}));

vi.mock("../../api/portal", () => ({
  listPortalReplications: (...args: unknown[]) => mocks.listPortalReplications(...args),
  createPortalReplication: (...args: unknown[]) => mocks.createPortalReplication(...args),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => ({
    accountIdForApi: "proj-42",
    hasAccountContext: true,
    loading: false,
    error: null,
  }),
}));

const paris = {
  id: "a101:raw-research-paris",
  name: "Research",
  bucket_name: "raw-research-paris",
  account_id: 101,
  account_name: "project-paris",
  project_account_label: "Paris",
  storage_endpoint_id: 11,
  storage_endpoint_name: "s3-z1",
  storage_endpoint_zonegroup: "zg-lab",
  storage_endpoint_zone_name: "z1",
  bucket_replication_allowed: true,
  bucket_replication_target_zones: ["z2"],
  bucket_replication_owner_mode: "rgw_account_supported" as const,
  bucket_replication_unavailable_reason: null,
  global_replication_configured: false,
  can_manage: true,
};

const lyon = {
  ...paris,
  id: "a102:raw-research-lyon",
  account_id: 102,
  bucket_name: "raw-research-lyon",
  account_name: "project-lyon",
  project_account_label: "Lyon",
  storage_endpoint_id: 12,
  storage_endpoint_name: "s3-z2",
  storage_endpoint_zone_name: "z2",
  bucket_replication_target_zones: [],
};

describe("PortalReplicationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPortalReplications.mockResolvedValue({
      storage_spaces: [paris, lyon],
      replications: [
        {
          id: "bucket:a101:raw-research-paris:portal-research",
          mode: "bucket_level",
          status: "configured",
          source: paris,
          target: lyon,
          target_bucket_name: "raw-research-lyon",
          zonegroup: "zg-lab",
          rule_id: "portal-research",
          message: "Bucket-level replication configured.",
        },
      ],
      can_create: true,
      unavailable_reason: null,
    });
    mocks.createPortalReplication.mockResolvedValue({
      id: "bucket:a101:research:portal-research",
      mode: "bucket_level",
      status: "configured",
      source: paris,
      target: lyon,
      target_bucket_name: "raw-research-lyon",
      zonegroup: "zg-lab",
      rule_id: "portal-research",
      message: "Bucket-level replication configured.",
    });
  });

  it("lists replications with user-facing labels and creates a workspace replication", async () => {
    render(<PortalReplicationsPage />);

    expect(await screen.findByRole("heading", { name: "Replications" })).toBeInTheDocument();
    expect(screen.getByText("Workspace replication")).toBeInTheDocument();
    expect(screen.getAllByText("Research (Paris)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Research (Lyon)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Storage location: Paris (z1)").length).toBeGreaterThan(0);
    expect(screen.getByText("Bucket-level replication configured.")).toBeInTheDocument();
    expect(screen.queryByText("raw-research-paris")).not.toBeInTheDocument();
    expect(screen.queryByText("raw-research-lyon")).not.toBeInTheDocument();
    expect(screen.queryByText("zg-lab")).not.toBeInTheDocument();
    expect(screen.queryByText("portal-research")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Source storage"), { target: { value: "a101:raw-research-paris" } });
    fireEvent.change(screen.getByLabelText("Destination storage"), { target: { value: "a102:raw-research-lyon" } });
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));

    await waitFor(() => {
      expect(mocks.createPortalReplication).toHaveBeenCalledWith("proj-42", {
        source_storage_space_id: "a101:raw-research-paris",
        target_storage_space_id: "a102:raw-research-lyon",
      });
    });
    expect(await screen.findByText("Replication configured from Research.")).toBeInTheDocument();
    expect(mocks.listPortalReplications).toHaveBeenCalledTimes(2);
  });

  it("shows platform replication as already covering matching storage locations", async () => {
    const globalParis = {
      ...paris,
      id: "a101:research",
      bucket_name: "research",
      global_replication_configured: true,
    };
    const globalLyon = {
      ...lyon,
      id: "a102:research",
      bucket_name: "research",
      global_replication_configured: true,
    };
    mocks.listPortalReplications.mockResolvedValueOnce({
      storage_spaces: [globalParis, globalLyon],
      replications: [
        {
          id: "global:a101:research<->a102:research",
          mode: "global",
          status: "configured",
          source: globalParis,
          target: globalLyon,
          target_bucket_name: "research",
          zonegroup: "zg-lab",
          message: "Global zonegroup replication applies to this storage pair.",
        },
      ],
      can_create: false,
      unavailable_reason: "Platform replication already covers the compatible storage locations in this workspace.",
    });

    render(<PortalReplicationsPage />);

    expect(await screen.findByText("Platform replication")).toBeInTheDocument();
    expect(screen.getByText("Managed by the storage platform.")).toBeInTheDocument();
    expect(screen.getByText("Platform replication already covers the compatible storage locations in this workspace.")).toBeInTheDocument();
    expect(screen.getByText("Storage pairs already protected by platform replication do not need an extra workspace replication.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure" })).toBeDisabled();
  });

  it("does not offer a destination on the same storage location", async () => {
    mocks.listPortalReplications.mockResolvedValueOnce({
      storage_spaces: [
        paris,
        {
          ...lyon,
          id: "a102:raw-same-location",
          bucket_name: "raw-same-location",
          project_account_label: "Paris copy",
          storage_endpoint_id: paris.storage_endpoint_id,
        },
      ],
      replications: [],
      can_create: false,
      unavailable_reason: "Replication requires a Portal manager role and two compatible storage locations.",
    });

    render(<PortalReplicationsPage />);

    expect(await screen.findByText("Replication needs manager access and two compatible storage locations in this workspace.")).toBeInTheDocument();
    expect(screen.getByText("No compatible destination is available for the selected source.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure" })).toBeDisabled();
  });

  it("shows a clear unavailable reason for RGW Account-owned buckets", async () => {
    mocks.listPortalReplications.mockResolvedValueOnce({
      storage_spaces: [
        {
          ...paris,
          bucket_replication_allowed: false,
          bucket_replication_target_zones: ["z2"],
          bucket_replication_owner_mode: "rgw_user_only",
          bucket_replication_unavailable_reason:
            "Ceph bucket replication is not supported for RGW Account-owned buckets on this endpoint.",
        },
        {
          ...lyon,
          bucket_replication_allowed: false,
          bucket_replication_owner_mode: "rgw_user_only",
          bucket_replication_unavailable_reason:
            "Ceph bucket replication is not supported for RGW Account-owned buckets on this endpoint.",
        },
      ],
      replications: [],
      can_create: false,
      unavailable_reason: "Ceph bucket replication is not supported for RGW Account-owned buckets on this endpoint.",
    });

    render(<PortalReplicationsPage />);

    expect(
      await screen.findByText("Ceph bucket replication is not available for RGW Account-owned buckets on this storage location.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure" })).toBeDisabled();
  });
});
