import { describe, expect, it } from "vitest";
import { buildPortalWorkspaceModel } from "./portalWorkspaceModel";

describe("buildPortalWorkspaceModel", () => {
  it("uses canonical storage spaces instead of PortalState buckets", () => {
    const workspace = buildPortalWorkspaceModel({
      account: { id: "101", name: "Account 101", tags: [] },
      state: {
        account_id: 101,
        iam_user: {},
        access_keys: [],
        buckets: [{ name: "legacy-bucket" }],
        can_manage_buckets: true,
      },
      storageSpaces: [
        {
          id: "research-data",
          name: "Research Data",
          role: "Owner",
          status: "Active",
          region: "eu-west-3",
          created_at: "2026-03-01T00:00:00Z",
          used_bytes: 2048,
          object_count: 12,
          internal_bucket_name: "research-data",
        },
      ],
      usage: null,
      userEmail: "manager@example.com",
    });

    expect(workspace.spaces).toHaveLength(1);
    expect(workspace.spaces[0]).toMatchObject({
      id: "research-data",
      name: "Research Data",
      internalName: "research-data",
      role: "Owner",
      status: "Active",
      usedBytes: 2048,
      objectCount: 12,
    });
  });

  it("keeps an empty canonical storage space list empty", () => {
    const workspace = buildPortalWorkspaceModel({
      account: { id: "101", name: "Account 101", tags: [] },
      state: {
        account_id: 101,
        iam_user: {},
        access_keys: [],
        buckets: [{ name: "legacy-bucket" }],
      },
      storageSpaces: [],
      usage: null,
      userEmail: null,
    });

    expect(workspace.spaces).toEqual([]);
    expect(workspace.activity).toEqual([]);
    expect(workspace.transfers).toEqual([]);
    expect(workspace.alerts).toEqual([]);
    expect(workspace.usageTrend).toEqual([]);
    expect(workspace.requestCount).toBeNull();
    expect(workspace.dataInBytes).toBeNull();
    expect(workspace.dataOutBytes).toBeNull();
  });

  it("prefers PortalUsage quotas and per-space usage when API data is available", () => {
    const workspace = buildPortalWorkspaceModel({
      account: { id: "101", name: "Account 101", tags: [] },
      state: {
        account_id: 101,
        iam_user: {},
        access_keys: [],
        buckets: [],
        quota_max_size_bytes: 10_000,
        quota_max_objects: 1_000,
      },
      storageSpaces: [
        {
          id: "research-data",
          name: "Research Data",
          role: "Owner",
          status: "Active",
          used_bytes: null,
          object_count: null,
        },
      ],
      usage: {
        used_bytes: 900,
        used_objects: 90,
        quota_max_size_bytes: 1_000,
        quota_max_objects: 100,
        storage_spaces: [
          {
            id: "research-data",
            name: "Research Data",
            used_bytes: 700,
            object_count: 70,
            quota_max_size_bytes: 800,
          },
        ],
      },
      userEmail: "manager@example.com",
    });

    expect(workspace.usedBytes).toBe(900);
    expect(workspace.usedObjects).toBe(90);
    expect(workspace.quotaBytes).toBe(1_000);
    expect(workspace.quotaObjects).toBe(100);
    expect(workspace.spaces[0]).toMatchObject({
      usedBytes: 700,
      objectCount: 70,
      quotaBytes: 800,
    });
  });
});
