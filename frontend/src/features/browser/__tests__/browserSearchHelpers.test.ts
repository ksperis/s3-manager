import { describe, expect, it } from "vitest";
import type { BrowserBucket } from "../../../api/browser";
import {
  BROWSER_QUERY_DEBOUNCE_MS,
  isStaleRequest,
  mergeBucketSearchItems,
  prepareLatestRequest,
} from "../browserSearchHelpers";

describe("browserSearchHelpers", () => {
  it("resets bucket results when append is false", () => {
    const previous: BrowserBucket[] = [{ name: "alpha" }, { name: "beta" }];
    const incoming: BrowserBucket[] = [{ name: "archive" }];

    const next = mergeBucketSearchItems(previous, incoming, false);

    expect(next).toEqual([{ name: "archive" }]);
  });

  it("appends bucket results without duplicates on load more", () => {
    const previous: BrowserBucket[] = [{ name: "alpha" }, { name: "beta" }];
    const incoming: BrowserBucket[] = [{ name: "beta" }, { name: "gamma" }];

    const next = mergeBucketSearchItems(previous, incoming, true);

    expect(next).toEqual([{ name: "alpha" }, { name: "beta" }, { name: "gamma" }]);
  });

  it("aborts previous request and marks stale sequences", () => {
    const first = prepareLatestRequest(null, 0);
    const second = prepareLatestRequest(first.controller, first.requestSeq);

    expect(first.controller.signal.aborted).toBe(true);
    expect(second.requestSeq).toBe(2);
    expect(isStaleRequest(first.requestSeq, second.requestSeq)).toBe(true);
    expect(isStaleRequest(second.requestSeq, second.requestSeq)).toBe(false);
  });

  it("uses 250ms debounce for browser search", () => {
    expect(BROWSER_QUERY_DEBOUNCE_MS).toBe(250);
  });
});
