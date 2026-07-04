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
  id: "a101:research",
  name: "Research",
  bucket_name: "research",
  account_id: 101,
  account_name: "project-paris",
  project_account_label: "Paris",
  storage_endpoint_id: 11,
  storage_endpoint_name: "s3-z1",
  storage_endpoint_zonegroup: "zg-lab",
  bucket_replication_allowed: true,
  global_replication_configured: true,
  can_manage: true,
};

const lyon = {
  ...paris,
  id: "a102:research",
  account_id: 102,
  account_name: "project-lyon",
  project_account_label: "Lyon",
  storage_endpoint_id: 12,
  storage_endpoint_name: "s3-z2",
};

describe("PortalReplicationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPortalReplications.mockResolvedValue({
      storage_spaces: [paris, lyon],
      replications: [
        {
          id: "global:a101:research<->a102:research",
          mode: "global",
          status: "configured",
          source: paris,
          target: lyon,
          target_bucket_name: "research",
          zonegroup: "zg-lab",
          message: "Global zonegroup replication applies to this storage pair.",
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
      target_bucket_name: "research",
      zonegroup: "zg-lab",
      rule_id: "portal-research",
      message: "Bucket-level replication configured.",
    });
  });

  it("lists global replications and creates a bucket-level replication", async () => {
    render(<PortalReplicationsPage />);

    expect(await screen.findByRole("heading", { name: "Replications" })).toBeInTheDocument();
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getAllByText("Research (Paris)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Research (Lyon)").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Source storage"), { target: { value: "a101:research" } });
    fireEvent.change(screen.getByLabelText("Destination storage"), { target: { value: "a102:research" } });
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));

    await waitFor(() => {
      expect(mocks.createPortalReplication).toHaveBeenCalledWith("proj-42", {
        source_storage_space_id: "a101:research",
        target_storage_space_id: "a102:research",
      });
    });
    expect(await screen.findByText("Replication configured from Research.")).toBeInTheDocument();
    expect(mocks.listPortalReplications).toHaveBeenCalledTimes(2);
  });
});
