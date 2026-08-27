/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdmin";
import {
  buildBucketExportColumns,
  buildBucketSelectionJsonPayload,
  serializeBucketSelectionCsv,
} from "./bucketOpsExportModel";

const bucket = (value: CephAdminBucket) => value;

describe("bucketOpsExportModel", () => {
  it("builds canonical Ceph Admin export columns", () => {
    const columns = buildBucketExportColumns({
      columnIds: [
        "context_kind",
        "owner_suspended",
        "owner_quota_usage_size_percent",
        "tags",
        "ui_tags",
        "policy_has_conditions",
        "versioning",
        "quota_status",
      ],
      featureColumns: [{ id: "versioning", key: "versioning", label: "Versioning" }],
      isStorageOps: false,
      useExplicitBucketName: false,
    });
    const value = bucket({
      name: "archive",
      context_kind: "account",
      owner_suspended: true,
      owner_used_bytes: 25,
      owner_quota_max_size_bytes: 100,
      quota_max_objects: 10,
      tags: [{ key: "env", value: "prod" }],
      ui_tags: [
        { id: 1, label: "Critical", color_key: "red", scope: "standard", visibility: "shared" },
      ],
      column_details: { policy_has_conditions: true },
      features: { versioning: { state: "enabled", tone: "active" } },
    });

    expect(columns.map((column) => column.label)).toEqual([
      "Name",
      "Kind",
      "Owner suspended",
      "Owner quota %",
      "Tags",
      "UI tags",
      "Policy has conditions",
      "Versioning",
      "Quota status",
    ]);
    expect(columns.map((column) => column.getValue(value))).toEqual([
      "archive",
      "Account",
      "Yes",
      "25.0%",
      "env=prod",
      "Critical (Shared)",
      "Yes",
      "enabled",
      "Configured",
    ]);
  });

  it("uses explicit Storage Ops names and omits tag visibility", () => {
    const columns = buildBucketExportColumns({
      columnIds: ["ui_tags"],
      featureColumns: [],
      isStorageOps: true,
      useExplicitBucketName: true,
    });
    const value = bucket({
      name: "account-1::encoded",
      bucket_name: "archive",
      ui_tags: [
        { id: 1, label: "Private", color_key: "blue", scope: "standard", visibility: "private" },
      ],
    });

    expect(columns.map((column) => column.getValue(value))).toEqual(["archive", "Private"]);
  });

  it("serializes ordered CSV and JSON rows with placeholders for missing buckets", () => {
    const columns = buildBucketExportColumns({
      columnIds: ["tenant"],
      featureColumns: [],
      isStorageOps: false,
      useExplicitBucketName: false,
    });
    const bucketsByName = new Map([
      ["alpha", bucket({ name: "alpha", tenant: "a,\"b" })],
    ]);
    const input = {
      bucketNames: ["alpha", "missing"],
      bucketsByName,
      columns,
    };

    expect(serializeBucketSelectionCsv(input)).toBe(
      '"Name","Tenant"\n"alpha","a,""b"\n"-","-"',
    );
    expect(
      buildBucketSelectionJsonPayload({
        ...input,
        generatedAt: "2026-08-28T00:00:00.000Z",
        scope: { id: 7, name: "Archive" },
        scopeKey: "endpoint",
      }),
    ).toEqual({
      generated_at: "2026-08-28T00:00:00.000Z",
      endpoint: { id: 7, name: "Archive" },
      items: [
        { name: "alpha", tenant: "a,\"b" },
        { name: "-", tenant: "-" },
      ],
    });
  });
});
