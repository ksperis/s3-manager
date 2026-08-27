import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBrowserConfirmDialog } from "./useBrowserConfirmDialog";

const createDialog = (onConfirm: () => Promise<void> | void) => ({
  title: "Delete object",
  message: "Delete this object?",
  confirmLabel: "Delete",
  tone: "danger" as const,
  onConfirm,
});

describe("useBrowserConfirmDialog", () => {
  it("opens and closes an idle confirmation", () => {
    const { result } = renderHook(() => useBrowserConfirmDialog());

    act(() => result.current.open(createDialog(vi.fn())));

    expect(result.current.dialog?.title).toBe("Delete object");
    expect(result.current.loading).toBe(false);

    act(() => result.current.close());

    expect(result.current.dialog).toBeNull();
  });

  it("locks the dialog while submitting and closes it after success", async () => {
    let resolveConfirmation: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const { result } = renderHook(() => useBrowserConfirmDialog());

    act(() => result.current.open(createDialog(onConfirm)));
    let submission: Promise<void> | undefined;
    act(() => {
      submission = result.current.submit();
    });

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.current.loading).toBe(true);

    act(() => result.current.close());
    expect(result.current.dialog).not.toBeNull();

    await act(async () => {
      resolveConfirmation?.();
      await submission;
    });

    expect(result.current.dialog).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("keeps the dialog open and unlocks it after a rejected action", async () => {
    const failure = new Error("Delete failed");
    const { result } = renderHook(() => useBrowserConfirmDialog());

    act(() =>
      result.current.open(
        createDialog(() => Promise.reject(failure)),
      ),
    );
    let receivedError: unknown;
    await act(async () => {
      try {
        await result.current.submit();
      } catch (error) {
        receivedError = error;
      }
    });

    expect(receivedError).toBe(failure);
    expect(result.current.dialog).not.toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
