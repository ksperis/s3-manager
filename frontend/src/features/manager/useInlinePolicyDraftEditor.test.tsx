import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInlinePolicyDraftEditor } from "./useInlinePolicyDraftEditor";

describe("useInlinePolicyDraftEditor", () => {
  it("creates, selects, and removes normalized inline policy drafts", () => {
    const setError = vi.fn();
    const { result } = renderHook(() => useInlinePolicyDraftEditor(setError));

    act(() => {
      result.current.setInlineDraftName("  audit-inline  ");
      result.current.setInlinePolicyText('{"Version":"2012-10-17"}');
    });
    act(() => result.current.handleAddInlineDraft());

    expect(result.current.inlineDrafts).toEqual([
      { name: "audit-inline", document: { Version: "2012-10-17" } },
    ]);
    expect(result.current.selectedInlineDraftName).toBe("audit-inline");
    expect(result.current.inlineDraftMode).toBe("edit");
    expect(result.current.inlinePolicyText).toBe(
      '{\n  "Version": "2012-10-17"\n}'
    );
    expect(setError).toHaveBeenLastCalledWith(null);

    act(() => result.current.handleCreateInlineDraft());
    expect(result.current.inlineDraftMode).toBe("create");
    expect(result.current.inlineDraftName).toBe("");

    act(() => result.current.handleSelectInlineDraft("audit-inline"));
    expect(result.current.inlineDraftMode).toBe("edit");
    expect(result.current.inlineDraftName).toBe("audit-inline");

    act(() => result.current.handleRemoveInlineDraft("audit-inline"));
    expect(result.current.inlineDrafts).toEqual([]);
    expect(result.current.inlineDraftMode).toBe("create");
  });

  it("reports missing names and invalid JSON without saving a draft", () => {
    const setError = vi.fn();
    const { result } = renderHook(() => useInlinePolicyDraftEditor(setError));

    act(() => result.current.handleAddInlineDraft());
    expect(setError).toHaveBeenLastCalledWith("Inline policy name is required.");

    act(() => {
      result.current.setInlineDraftName("invalid-json");
      result.current.setInlinePolicyText("{");
    });
    act(() => result.current.handleAddInlineDraft());
    expect(setError).toHaveBeenLastCalledWith("Inline policy must be valid JSON.");
    expect(result.current.inlineDrafts).toEqual([]);
  });

  it("keeps expansion on clear and closes it on lifecycle reset", () => {
    const setError = vi.fn();
    const { result } = renderHook(() => useInlinePolicyDraftEditor(setError));

    act(() => {
      result.current.setShowInlinePolicyOptions(true);
      result.current.setInlineDraftName("temporary");
      result.current.handleClearInlineDrafts();
    });
    expect(result.current.showInlinePolicyOptions).toBe(true);

    act(() => result.current.resetInlinePolicyDraftEditor());
    expect(result.current.showInlinePolicyOptions).toBe(false);
    expect(result.current.inlineDraftName).toBe("");
    expect(result.current.inlineDrafts).toEqual([]);
  });
});
