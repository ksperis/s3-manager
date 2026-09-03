import { describe, expect, it } from "vitest";

import { diffToneClasses } from "./diffPresentation";

describe("diffToneClasses", () => {
  it.each([
    [undefined, "border-slate-200"],
    ["added", "border-emerald-200"],
    ["removed", "border-rose-200"],
  ] as const)("maps %s to the expected palette", (tone, expectedClass) => {
    expect(diffToneClasses(tone)).toContain(expectedClass);
  });
});
