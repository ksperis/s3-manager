import { beforeEach, describe, expect, it } from "vitest";

import {
  BUCKET_CORE_COLUMN_OPTIONS,
  BUCKET_QUOTA_COLUMN_GROUPS,
  FEATURE_DETAIL_COLUMN_OPTIONS,
  loadBucketListState,
  loadVisibleColumns,
  persistBucketListState,
  type BucketListState,
  type ColumnId,
} from "./bucketOpsListState";

const storageKey = "bucket-ops-list-state-test";
const defaultColumns: ColumnId[] = ["tenant", "owner"];
const validState = (): BucketListState => ({
  filter: "archive",
  quickFilterMode: "contains",
  advancedApplied: null,
  tagFilters: [17],
  tagFilterMode: "any",
  page: 2,
  pageSize: 25,
  sort: { field: "name", direction: "asc" },
});

beforeEach(() => localStorage.clear());

describe("bucket operations list state", () => {
  it("defines each configurable column once", () => {
    const ids = [
      ...BUCKET_CORE_COLUMN_OPTIONS.map(({ id }) => id),
      ...BUCKET_QUOTA_COLUMN_GROUPS.flatMap(({ options }) =>
        options.map(({ id }) => id),
      ),
      ...FEATURE_DETAIL_COLUMN_OPTIONS.map(({ id }) => id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      FEATURE_DETAIL_COLUMN_OPTIONS.every(
        ({ feature, include }) => Boolean(feature) && Boolean(include),
      ),
    ).toBe(true);
  });

  it("keeps only supported visible columns for the current surface", () => {
    localStorage.setItem(storageKey, JSON.stringify(["context_name", "tenant", "unknown"]));

    expect(loadVisibleColumns(storageKey, defaultColumns, false)).toEqual(["tenant"]);
    expect(loadVisibleColumns(storageKey, defaultColumns, true)).toEqual(["context_name", "tenant"]);
  });

  it("falls back to default columns when persisted data is malformed", () => {
    localStorage.setItem(storageKey, "{");

    expect(loadVisibleColumns(storageKey, defaultColumns, true)).toEqual(defaultColumns);
  });

  it("sanitizes persisted filters, pagination, tags, and sorting", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        7: {
          filter: 4,
          quickFilterMode: "exact",
          advancedApplied: { ownerSuspended: "false", minOwnerQuotaBytes: "1024" },
          tagFilters: [" Production ", "production", "", 9],
          tagFilterMode: "all",
          page: 3.8,
          pageSize: 999,
          sort: { field: "owner", direction: "desc" },
        },
      })
    );

    expect(loadBucketListState(storageKey, 7)).toMatchObject({
      filter: "",
      quickFilterMode: "exact",
      advancedApplied: { ownerSuspended: "false", minOwnerQuotaBytes: "1024" },
      tagFilters: [9],
      tagFilterMode: "all",
      page: 3,
      pageSize: 200,
      sort: { field: "owner", direction: "desc" },
    });
  });

  it("recovers from malformed storage when persisting a new state", () => {
    localStorage.setItem(storageKey, "{");
    const state = validState();

    persistBucketListState(storageKey, 7, state);

    expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).toEqual({ 7: state });
  });

  it("preserves other endpoint states when persisting", () => {
    const otherState = { ...validState(), filter: "other" };
    localStorage.setItem(storageKey, JSON.stringify({ 8: otherState }));

    persistBucketListState(storageKey, 7, validState());

    expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).toEqual({
      7: validState(),
      8: otherState,
    });
  });
});
