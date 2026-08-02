import { describe, expect, it } from "vitest";
import {
  getDeletedObjectEntryId,
  getMultipartUploadEntryId,
  mergeDeletedObjectsWithLimit,
  mergeUniqueStringsWithLimit,
} from "./browserListingState";

describe("browserListingState", () => {
  it("builds stable deleted-object and multipart-upload identities", () => {
    expect(getDeletedObjectEntryId({ key: "a", version_id: null })).toBe(
      "a::null",
    );
    expect(getDeletedObjectEntryId({ key: "a", version_id: "v1" })).toBe(
      "a::v1",
    );
    expect(getMultipartUploadEntryId({ key: "a", upload_id: "upload-1" })).toBe(
      "a::upload-1",
    );
  });

  it("deduplicates strings while enforcing the page budget", () => {
    expect(mergeUniqueStringsWithLimit(["a"], ["a", "b", "c"], 2)).toEqual({
      items: ["a", "b"],
      limitReached: true,
    });
    expect(mergeUniqueStringsWithLimit(["a", "b"], ["c"], 2)).toEqual({
      items: ["a", "b"],
      limitReached: true,
    });
  });

  it("updates duplicate deleted versions but never exceeds the budget", () => {
    const merged = mergeDeletedObjectsWithLimit(
      [{ key: "a", version_id: "v1", size: 1 }],
      [
        { key: "a", version_id: "v1", size: 2 },
        { key: "b", version_id: "v2", size: 3 },
        { key: "c", version_id: "v3", size: 4 },
      ],
      2,
    );

    expect(merged).toEqual({
      items: [
        { key: "a", version_id: "v1", size: 2 },
        { key: "b", version_id: "v2", size: 3 },
      ],
      limitReached: true,
    });
  });
});
