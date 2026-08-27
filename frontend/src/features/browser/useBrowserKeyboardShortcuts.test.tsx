import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserItem } from "./browserTypes";
import { useBrowserKeyboardShortcuts } from "./useBrowserKeyboardShortcuts";

const selectedItem: BrowserItem = {
  id: "report.txt",
  key: "report.txt",
  name: "report.txt",
  type: "file",
  size: "1 KB",
  modified: "2026-08-27",
  owner: "owner",
};

function renderShortcuts(
  overrides: Partial<Parameters<typeof useBrowserKeyboardShortcuts>[0]> = {},
) {
  const options: Parameters<typeof useBrowserKeyboardShortcuts>[0] = {
    blocked: false,
    canCopyAndCut: true,
    canPaste: true,
    enabled: true,
    hasSelectableItems: true,
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onEditPath: vi.fn(),
    onPaste: vi.fn(),
    onSelectAll: vi.fn(),
    selectedItems: [selectedItem],
    ...overrides,
  };
  renderHook(() => useBrowserKeyboardShortcuts(options));
  return options;
}

describe("useBrowserKeyboardShortcuts", () => {
  it("runs selection and path-editing shortcuts", () => {
    const options = renderShortcuts();

    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    fireEvent.keyDown(document, { key: "l", metaKey: true });

    expect(options.onSelectAll).toHaveBeenCalledOnce();
    expect(options.onEditPath).toHaveBeenCalledOnce();
  });

  it("runs clipboard shortcuts with the current selection", () => {
    const options = renderShortcuts();

    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    fireEvent.keyDown(document, { key: "x", metaKey: true });
    fireEvent.keyDown(document, { key: "v", ctrlKey: true });

    expect(options.onCopy).toHaveBeenCalledWith([selectedItem]);
    expect(options.onCut).toHaveBeenCalledWith([selectedItem]);
    expect(options.onPaste).toHaveBeenCalledOnce();
  });

  it("respects blocking and capability policy", () => {
    const blocked = renderShortcuts({ blocked: true });
    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    expect(blocked.onSelectAll).not.toHaveBeenCalled();

    const restricted = renderShortcuts({
      canCopyAndCut: false,
      canPaste: false,
    });
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    fireEvent.keyDown(document, { key: "v", ctrlKey: true });
    expect(restricted.onCopy).not.toHaveBeenCalled();
    expect(restricted.onPaste).not.toHaveBeenCalled();
  });

  it("ignores editable targets and unmodified key presses", () => {
    const options = renderShortcuts();
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "a", ctrlKey: true });
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "a", ctrlKey: true, altKey: true });

    expect(options.onSelectAll).not.toHaveBeenCalled();
    input.remove();
  });
});
