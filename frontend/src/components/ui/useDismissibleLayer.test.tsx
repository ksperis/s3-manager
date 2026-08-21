import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDismissibleLayer } from "./useDismissibleLayer";

describe("useDismissibleLayer", () => {
  it("ignores inside interactions and reports outside dismissal", () => {
    const anchor = document.createElement("button");
    const surface = document.createElement("div");
    const surfaceChild = document.createElement("button");
    surface.append(surfaceChild);
    document.body.append(anchor, surface);
    const onDismiss = vi.fn();

    const { unmount } = renderHook(() =>
      useDismissibleLayer({
        open: true,
        insideRefs: [{ current: anchor }, { current: surface }],
        onDismiss,
      }),
    );

    fireEvent.mouseDown(anchor);
    fireEvent.mouseDown(surfaceChild);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith("outside");

    unmount();
    anchor.remove();
    surface.remove();
  });

  it("uses the latest callback and can prevent the Escape default", () => {
    const initialDismiss = vi.fn();
    const latestDismiss = vi.fn();
    const { rerender } = renderHook(
      ({ onDismiss }) =>
        useDismissibleLayer({
          open: true,
          insideRefs: [],
          onDismiss,
          preventEscapeDefault: true,
        }),
      { initialProps: { onDismiss: initialDismiss } },
    );
    rerender({ onDismiss: latestDismiss });

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    document.dispatchEvent(event);

    expect(initialDismiss).not.toHaveBeenCalled();
    expect(latestDismiss).toHaveBeenCalledWith("escape");
    expect(event.defaultPrevented).toBe(true);
  });
});
