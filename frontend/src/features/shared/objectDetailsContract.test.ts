import { describe, expect, it } from "vitest";

import { resolveStorageSpaceObjectDetailsView } from "./objectDetailsContract";

describe("resolveStorageSpaceObjectDetailsView", () => {
  it("maps Browser intents to the shared Storage Space views", () => {
    expect(
      resolveStorageSpaceObjectDetailsView({ initialTab: "versions" }),
    ).toBe("history");
    expect(
      resolveStorageSpaceObjectDetailsView({
        initialTab: "properties",
        intent: "create-public-link",
      }),
    ).toBe("sharing");
    expect(
      resolveStorageSpaceObjectDetailsView({ initialTab: "properties" }),
    ).toBe("details");
    expect(resolveStorageSpaceObjectDetailsView({ initialTab: "preview" })).toBe(
      "preview",
    );
  });
});
