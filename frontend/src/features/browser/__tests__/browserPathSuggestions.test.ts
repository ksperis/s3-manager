import { beforeEach, describe, expect, it } from "vitest";

import {
  buildPathSuggestionEntries,
  mergePathSuggestions,
  normalizePathDraftValue,
  pushBucketPathHistory,
  readBucketPathHistory,
  resolvePathDraftContext,
} from "../browserPathSuggestions";

describe("browserPathSuggestions", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("normalizes drafts and resolves parent context", () => {
    expect(normalizePathDraftValue("///logs/2026")).toBe("logs/2026");
    expect(resolvePathDraftContext("logs/2026/ju")).toEqual({
      parentPrefix: "logs/2026/",
      fragment: "ju",
    });
  });

  it("builds deduplicated scoped suggestions", () => {
    expect(
      buildPathSuggestionEntries(["logs/2026/june/", "/logs/2026/july/", "tmp/"], "logs/2026/", "ju", "local")
    ).toEqual([
      { value: "logs/2026/june/", label: "june", source: "local" },
      { value: "logs/2026/july/", label: "july", source: "local" },
    ]);
  });

  it("prefers history over duplicate local and remote suggestions", () => {
    const result = mergePathSuggestions(
      "ju",
      [{ value: "logs/2026/july/", label: "july", source: "remote" }],
      [{ value: "logs/2026/july/", label: "july", source: "history" }]
    );

    expect(result).toEqual([{ value: "logs/2026/july/", label: "july", source: "history" }]);
  });

  it("stores bounded normalized path history per bucket", () => {
    expect(pushBucketPathHistory("docs", "/reports/2026")).toEqual(["reports/2026/"]);
    expect(pushBucketPathHistory("docs", "reports/2025")).toEqual(["reports/2025/", "reports/2026/"]);

    expect(readBucketPathHistory("docs")).toEqual(["reports/2025/", "reports/2026/"]);
  });
});
