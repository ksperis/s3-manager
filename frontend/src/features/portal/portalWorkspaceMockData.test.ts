import { describe, expect, it } from "vitest";
import { buildPortalWorkspaceModel } from "./portalWorkspaceMockData";

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
  });
});
