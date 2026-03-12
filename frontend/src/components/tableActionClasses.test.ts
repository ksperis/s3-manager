import { describe, expect, it } from "vitest";

import { tableActionButtonClasses, tableDeleteActionClasses } from "./tableActionClasses";

describe("tableActionClasses", () => {
  it("defines explicit disabled styles for regular action buttons", () => {
    expect(tableActionButtonClasses).toContain("disabled:cursor-not-allowed");
    expect(tableActionButtonClasses).toContain("disabled:border-slate-200");
    expect(tableActionButtonClasses).toContain("disabled:text-slate-400");
    expect(tableActionButtonClasses).toContain("disabled:hover:text-slate-400");
    expect(tableActionButtonClasses).toContain("dark:disabled:text-slate-500");
  });

  it("defines explicit disabled styles for delete action buttons", () => {
    expect(tableDeleteActionClasses).toContain("disabled:cursor-not-allowed");
    expect(tableDeleteActionClasses).toContain("disabled:border-slate-200");
    expect(tableDeleteActionClasses).toContain("disabled:text-slate-400");
    expect(tableDeleteActionClasses).toContain("disabled:hover:bg-transparent");
    expect(tableDeleteActionClasses).toContain("dark:disabled:text-slate-500");
  });
});
