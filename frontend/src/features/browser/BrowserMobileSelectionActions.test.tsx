import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BrowserActionState } from "./browserActions";
import BrowserMobileSelectionActions from "./BrowserMobileSelectionActions";

const action = (
  value: Pick<BrowserActionState, "id" | "label"> &
    Partial<BrowserActionState>,
): BrowserActionState => ({
  section: "selection",
  visible: true,
  enabled: true,
  ...value,
});

const actions: BrowserActionState[] = [
  action({ id: "open", label: "Open" }),
  action({ id: "download", label: "Download" }),
  action({ id: "delete", label: "Delete" }),
  action({
    id: "copy",
    label: "Copy",
    enabled: false,
    disabledReason: "Copy is unavailable.",
  }),
];

describe("BrowserMobileSelectionActions", () => {
  it("forwards primary and sheet actions without duplicating primary entries", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onDownload = vi.fn();
    const onRunAction = vi.fn();
    render(
      <BrowserMobileSelectionActions
        actions={actions}
        canDownload
        canOpen
        onDownload={onDownload}
        onOpen={onOpen}
        onRunAction={onRunAction}
        summary="2 selected"
      />,
    );

    const toolbar = screen.getByRole("toolbar", {
      name: "Selected object actions",
    });
    await user.click(within(toolbar).getByRole("button", { name: "Open" }));
    await user.click(
      within(toolbar).getByRole("button", { name: "Download" }),
    );
    await user.click(within(toolbar).getByRole("button", { name: "More" }));

    const sheet = await screen.findByRole("dialog", { name: "2 selected" });
    expect(
      within(sheet).queryByRole("button", { name: "Open" }),
    ).not.toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: "Download" }),
    ).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(within(sheet).getByText("Copy is unavailable.")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Delete" }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onRunAction).toHaveBeenCalledWith("delete");
    expect(
      screen.queryByRole("dialog", { name: "2 selected" }),
    ).not.toBeInTheDocument();
  });

  it("traps focus, closes on Escape, and restores focus to More", async () => {
    const user = userEvent.setup();
    render(
      <BrowserMobileSelectionActions
        actions={actions}
        canDownload={false}
        canOpen={false}
        onDownload={vi.fn()}
        onOpen={vi.fn()}
        onRunAction={vi.fn()}
        summary="1 selected"
      />,
    );

    const toolbar = screen.getByRole("toolbar", {
      name: "Selected object actions",
    });
    expect(within(toolbar).getByRole("button", { name: "Open" })).toBeDisabled();
    expect(
      within(toolbar).getByRole("button", { name: "Download" }),
    ).toBeDisabled();
    const moreButton = within(toolbar).getByRole("button", { name: "More" });
    await user.click(moreButton);
    const sheet = await screen.findByRole("dialog", { name: "1 selected" });
    await waitFor(() =>
      expect(
        within(sheet).getByRole("button", { name: "Close actions" }),
      ).toHaveFocus(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "1 selected" }),
      ).not.toBeInTheDocument();
      expect(moreButton).toHaveFocus();
    });
  });
});
