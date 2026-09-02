import { describe, expect, it } from "vitest";
import {
  buildPortalWorkspaceModel,
  decodePortalObjectPath,
  decodePortalRouteValue,
} from "./portalWorkspaceModel";

describe("portal route decoding", () => {
  it("decodes route values and preserves malformed input", () => {
    expect(decodePortalRouteValue("Research%20Data")).toBe("Research Data");
    expect(decodePortalRouteValue("invalid%2")).toBe("invalid%2");
    expect(decodePortalRouteValue()).toBe("");
  });

  it("decodes object paths segment by segment", () => {
    expect(decodePortalObjectPath("reports/2026%20Q3/summary%25.csv")).toBe(
      "reports/2026 Q3/summary%.csv",
    );
  });
});

describe("buildPortalWorkspaceModel", () => {
  it("uses canonical storage spaces as the workspace source", () => {
    const workspace = buildPortalWorkspaceModel({
      account: { id: "101", name: "Account 101", tags: [] },
      storageSpaces: [
        {
          id: "research-data",
          name: "Research Data",
          role: "Manager",
          can_delete: true,
          status: "Active",
          owner_user_id: 7,
          visibility: "shared",
          region: "eu-west-3",
          created_at: "2026-03-01T00:00:00Z",
          used_bytes: 2048,
          object_count: 12,
          internal_bucket_name: "research-data",
          origin: "portal_generic",
          name_editable: true,
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
      origin: "portal_generic",
      nameEditable: true,
      role: "Manager",
      canDelete: true,
      status: "Active",
      ownerUserId: 7,
      visibility: "shared",
      access: "Shared",
      usedBytes: 2048,
      objectCount: 12,
    });
    expect(workspace.maxBuckets).toBeNull();
  });

  it("keeps an empty canonical storage space list empty", () => {
    const workspace = buildPortalWorkspaceModel({
      account: { id: "101", name: "Account 101", tags: [] },
      storageSpaces: [],
      usage: null,
      userEmail: null,
    });

    expect(workspace.spaces).toEqual([]);
    expect(workspace.activity).toEqual([]);
    expect(workspace.alerts).toEqual([]);
    expect(workspace.usageTrend).toEqual([]);
    expect(workspace.requestCount).toBeNull();
    expect(workspace.dataInBytes).toBeNull();
    expect(workspace.dataOutBytes).toBeNull();
  });

  it("prefers PortalUsage quotas and per-space usage when API data is available", () => {
    const workspace = buildPortalWorkspaceModel({
      account: { id: "101", name: "Account 101", tags: [] },
      storageSpaces: [
        {
          id: "research-data",
          name: "Research Data",
          role: "Owner",
          status: "Active",
          visibility: "private",
          used_bytes: null,
          object_count: null,
        },
      ],
      usage: {
        used_bytes: 900,
        used_objects: 90,
        quota_max_size_bytes: 1_000,
        quota_max_objects: 100,
        max_buckets: 8,
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
    expect(workspace.maxBuckets).toBe(8);
    expect(workspace.spaces[0]).toMatchObject({
      usedBytes: 700,
      objectCount: 70,
      quotaBytes: 800,
    });
  });

  it("uses the explicit visibility field independently from operational status", () => {
    const workspace = buildPortalWorkspaceModel({
      account: { id: "101", name: "Account 101", tags: [] },
      storageSpaces: [
        {
          id: "shared-space",
          name: "Shared Space",
          role: "Viewer",
          status: "Active",
          visibility: "shared",
        },
        {
          id: "private-space",
          name: "Private Space",
          role: "Manager",
          status: "Active",
          visibility: "private",
        },
      ],
      usage: null,
      userEmail: "manager@example.com",
    });

    expect(workspace.spaces.map((space) => ({ access: space.access, status: space.status, visibility: space.visibility }))).toEqual([
      { access: "Shared", status: "Active", visibility: "shared" },
      { access: "Private", status: "Active", visibility: "private" },
    ]);
  });
});
