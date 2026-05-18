import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import Modal from "../Modal";
import { useUnsavedChangesGuard } from "../useUnsavedChangesGuard";

function GuardHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [value, setValue] = useState("");
  const guard = useUnsavedChangesGuard({
    hasUnsavedChanges: value.trim().length > 0,
    onClose,
  });

  return (
    <Modal title="Guarded editor" onClose={guard.requestClose}>
      <label>
        Name
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="button" onClick={guard.requestClose}>
        Cancel
      </button>
      {guard.confirmationDialog}
    </Modal>
  );
}

describe("useUnsavedChangesGuard", () => {
  it("closes without prompting when there are no changes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GuardHarness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
  });

  it("keeps editing or discards from the confirmation dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GuardHarness onClose={onClose} />);

    await user.type(screen.getByLabelText("Name"), "draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("guards Escape, backdrop, and header close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GuardHarness onClose={onClose} />);

    await user.type(screen.getByLabelText("Name"), "draft");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));

    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));

    await user.click(screen.getByRole("button", { name: "Close modal" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
