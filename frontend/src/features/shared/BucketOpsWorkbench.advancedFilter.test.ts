import { describe, expect, it } from "vitest";

import {
  buildAdvancedFilterPayload,
  hasAdvancedFilters,
  sanitizeAdvancedFilter,
  type AdvancedFilterState,
} from "./BucketOpsWorkbench";

const baseAdvancedFilter = (): AdvancedFilterState => sanitizeAdvancedFilter({});

describe("BucketOpsWorkbench advanced filter storage-ops fields", () => {
  it("emits context/kind/endpoint rules in storage-ops mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      context: "Account A",
      contextMatchMode: "contains",
      kind: "account",
      endpoint: "Primary Endpoint",
      endpointMatchMode: "exact",
    };

    const rawPayload = buildAdvancedFilterPayload("", "contains", advanced, null, true);
    expect(rawPayload).toBeTruthy();
    const payload = JSON.parse(rawPayload ?? "{}") as { rules?: Array<Record<string, unknown>> };

    expect(payload.rules).toEqual(
      expect.arrayContaining([
        { field: "context_name", op: "contains", value: "Account A" },
        { field: "context_kind", op: "eq", value: "account" },
        { field: "endpoint_name", op: "eq", value: "Primary Endpoint" },
      ])
    );
  });

  it("does not emit storage-ops identity rules in ceph-admin mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      context: "Account A",
      kind: "connection",
      endpoint: "Archive Endpoint",
    };

    const payload = buildAdvancedFilterPayload("", "contains", advanced, null, false);
    expect(payload).toBeUndefined();
  });

  it("counts storage-ops identity rules as active only in storage-ops mode", () => {
    const advanced: AdvancedFilterState = {
      ...baseAdvancedFilter(),
      context: "Account A",
      kind: "account",
    };

    expect(hasAdvancedFilters(advanced, true)).toBe(true);
    expect(hasAdvancedFilters(advanced, false)).toBe(false);
  });
});
