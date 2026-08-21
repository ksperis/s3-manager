import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBrowserContextMenu } from "./useBrowserContextMenu";

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

describe("useBrowserContextMenu", () => {
  beforeEach(() => setViewport(1000, 800));

  afterEach(() => {
    setViewport(originalInnerWidth, originalInnerHeight);
    document
      .querySelectorAll("[data-context-menu-hook-test]")
      .forEach((node) => node.remove());
  });

  it("clamps point and end-aligned anchors within the viewport", () => {
    setViewport(300, 220);
    const { result } = renderHook(() => useBrowserContextMenu());

    act(() => {
      result.current.openContextMenu(
        { kind: "path" },
        { x: 280, y: 190 },
      );
    });
    expect(result.current.contextMenu).toMatchObject({
      kind: "path",
      x: 52,
      y: 8,
    });

    setViewport(1000, 800);
    act(() => {
      result.current.openContextMenu(
        { kind: "headerConfig" },
        { x: 500, y: 200, horizontalAlignment: "end" },
      );
    });
    expect(result.current.contextMenu).toMatchObject({
      kind: "headerConfig",
      x: 260,
      y: 200,
    });
  });

  it("repositions the rendered menu and closes it on outside interactions", async () => {
    const { result } = renderHook(() => useBrowserContextMenu());
    const menu = document.createElement("div");
    menu.dataset.contextMenuHookTest = "true";
    const menuChild = document.createElement("button");
    menu.append(menuChild);
    document.body.append(menu);
    Object.defineProperty(menu, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 580,
        height: 80,
        left: 700,
        right: 800,
        top: 500,
        width: 100,
        x: 700,
        y: 500,
        toJSON: () => ({}),
      }),
    });
    act(() => {
      result.current.contextMenuRef.current = menu;
      result.current.openContextMenu(
        { kind: "path" },
        { x: 700, y: 500 },
      );
    });

    setViewport(600, 400);
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() =>
      expect(result.current.contextMenu).toMatchObject({ x: 492, y: 312 }),
    );

    fireEvent.mouseDown(menuChild);
    expect(result.current.contextMenu).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(result.current.contextMenu).toBeNull();

    act(() => {
      result.current.openContextMenu(
        { kind: "headerConfig" },
        { x: 40, y: 40 },
      );
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(result.current.contextMenu).toBeNull();
  });
});
