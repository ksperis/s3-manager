/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";
import type {
  CephAdminBucket,
  ListCephAdminBucketsParams,
} from "../../api/cephAdminBuckets";
import { prepareBucketOpsSelectionExport } from "./bucketOpsSelectionExport";

type ExportInput = Parameters<typeof prepareBucketOpsSelectionExport>[0];

const fixedNow = () => new Date("2026-08-28T12:34:56.789Z");

function buildInput(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    bucketNames: ["alpha", "beta"],
    exportPrefix: "ceph-admin",
    exportScopeKey: "endpoint",
    exportWithStats: true,
    featureColumns: [],
    filteredQuery: {
      filter: "prod",
      sort_by: "name",
      sort_dir: "asc",
      ui_tag_ids: [7],
      ui_tag_match: "all",
    },
    format: "csv",
    fullyResolvedFilteredSelection: false,
    include: ["tags"],
    isStorageOps: false,
    listBuckets: vi.fn(async () => ({ items: [], has_next: false })),
    now: fixedNow,
    scopeDisplayName: "Endpoint",
    scopeId: 7,
    scopeName: "Archive / Primary",
    total: 2,
    useExplicitBucketName: false,
    visibleBuckets: [],
    visibleColumns: ["tenant"],
    ...overrides,
  };
}

describe("prepareBucketOpsSelectionExport", () => {
  it("builds a text artifact without loading bucket details", async () => {
    const listBuckets = vi.fn();

    const artifact = await prepareBucketOpsSelectionExport(
      buildInput({ format: "text", listBuckets }),
    );

    expect(artifact).toEqual({
      content: "alpha\nbeta",
      filename:
        "ceph-admin-buckets-Archive_Primary-2026-08-28T12-34-56-789Z.txt",
      mimeType: "text/plain;charset=utf-8",
    });
    expect(listBuckets).not.toHaveBeenCalled();
  });

  it("reuses the complete filtered query for a fully resolved CSV selection", async () => {
    const listBuckets = vi.fn(
      async (_scopeId: number, _params: ListCephAdminBucketsParams) => ({
        items: [
          { name: "alpha", tenant: "tenant-a" },
          { name: "beta", tenant: "tenant-b" },
        ] satisfies CephAdminBucket[],
        has_next: false,
        total: 2,
      }),
    );
    const onProgress = vi.fn();

    const artifact = await prepareBucketOpsSelectionExport(
      buildInput({
        fullyResolvedFilteredSelection: true,
        listBuckets,
        onProgress,
        visibleBuckets: [{ name: "alpha", tenant: "stale" }],
      }),
    );

    expect(listBuckets).toHaveBeenCalledWith(7, {
      filter: "prod",
      sort_by: "name",
      sort_dir: "asc",
      ui_tag_ids: [7],
      ui_tag_match: "all",
      include: ["tags"],
      with_stats: true,
      page: 1,
      page_size: 200,
    });
    expect(onProgress).toHaveBeenCalledWith(2, 2);
    expect(artifact.content).toBe(
      '"Name","Tenant"\n"alpha","tenant-a"\n"beta","tenant-b"',
    );
    expect(artifact.mimeType).toBe("text/csv;charset=utf-8");
  });

  it("loads exact names for partial selections and preserves visible fallbacks", async () => {
    const listBuckets = vi.fn(
      async (_scopeId: number, params: ListCephAdminBucketsParams) => {
        const filter = JSON.parse(params.advanced_filter ?? "{}") as {
          rules?: Array<{ value?: string[] }>;
        };
        expect(filter.rules?.[0]?.value).toEqual(["alpha", "beta"]);
        return {
          items: [{ name: "alpha", tenant: "fresh" }],
          has_next: false,
        };
      },
    );
    const onProgress = vi.fn();

    const artifact = await prepareBucketOpsSelectionExport(
      buildInput({
        exportWithStats: false,
        listBuckets,
        onProgress,
        visibleBuckets: [
          { name: "alpha", tenant: "stale" },
          { name: "beta", tenant: "cached" },
          { name: "other", tenant: "ignored" },
        ],
      }),
    );

    expect(listBuckets).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        include: ["tags"],
        page: 1,
        page_size: 200,
        with_stats: false,
      }),
    );
    expect(onProgress).toHaveBeenCalledWith(2, 2);
    expect(artifact.content).toBe(
      '"Name","Tenant"\n"alpha","fresh"\n"beta","cached"',
    );
  });

  it("builds JSON with the configured scope key and explicit bucket names", async () => {
    const listBuckets = vi.fn(async () => ({
      items: [
        {
          name: "account-1::encoded",
          bucket_name: "archive",
        },
      ] satisfies CephAdminBucket[],
      has_next: false,
    }));

    const artifact = await prepareBucketOpsSelectionExport(
      buildInput({
        bucketNames: ["account-1::encoded"],
        exportPrefix: "storage-ops",
        exportScopeKey: "scope",
        format: "json",
        isStorageOps: true,
        listBuckets,
        scopeDisplayName: "Scope",
        scopeId: 1,
        scopeName: null,
        total: 1,
        useExplicitBucketName: true,
        visibleColumns: [],
      }),
    );

    expect(artifact.filename).toBe(
      "storage-ops-buckets-scope-1-2026-08-28T12-34-56-789Z.json",
    );
    expect(artifact.mimeType).toBe("application/json");
    expect(JSON.parse(artifact.content)).toEqual({
      generated_at: "2026-08-28T12:34:56.789Z",
      scope: { id: 1, name: null },
      items: [{ name: "archive" }],
    });
  });

  it("propagates listing failures without producing a partial artifact", async () => {
    const failure = new Error("listing failed");
    const listBuckets = vi.fn(async () => {
      throw failure;
    });

    await expect(
      prepareBucketOpsSelectionExport(buildInput({ listBuckets })),
    ).rejects.toBe(failure);
  });
});
