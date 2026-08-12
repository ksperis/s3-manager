import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { useState } from "react";
import Modal from "../Modal";

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      {open && (
        <Modal title="Harness modal" onClose={() => setOpen(false)}>
          <button type="button">Primary action</button>
          <button type="button">Secondary action</button>
        </Modal>
      )}
    </div>
  );
}

function NestedModalHarness() {
  const [parentOpen, setParentOpen] = useState(true);
  const [childOpen, setChildOpen] = useState(false);
  if (!parentOpen) return <p>Closed</p>;
  return (
    <Modal title="Parent modal" onClose={() => setParentOpen(false)}>
      <button type="button" onClick={() => setChildOpen(true)}>
        Open child
      </button>
      <button type="button">Parent action</button>
      {childOpen && (
        <Modal title="Child modal" onClose={() => setChildOpen(false)} zIndexClass="z-[60]">
          <button type="button">Child action</button>
        </Modal>
      )}
    </Modal>
  );
}

describe("Modal", () => {
  it("passes a11y checks", async () => {
    const { container } = render(
      <Modal title="A11y modal" onClose={() => undefined}>
        <p>Body content</p>
      </Modal>
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("supports a localized close action", () => {
    render(
      <Modal
        title="Fenêtre localisée"
        onClose={() => undefined}
        closeLabel="Fermer"
        closeAriaLabel="Fermer la fenêtre"
      >
        <p>Contenu</p>
      </Modal>
    );

    expect(screen.getByRole("button", { name: "Fermer la fenêtre" })).toHaveTextContent("Fermer");
  });

  it("traps focus and restores focus on close", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const openButton = screen.getByRole("button", { name: "Open modal" });
    await user.click(openButton);

    const dialog = screen.getByRole("dialog", { name: "Harness modal" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Primary action" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Secondary action" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Harness modal" })).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it("can disable backdrop close", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Backdrop modal" onClose={onClose} closeOnBackdropClick={false}>
        <p>Cannot close by backdrop</p>
      </Modal>
    );

    const backdrop = screen.getByRole("presentation");
    fireEvent.mouseDown(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lets only the top modal respond to Escape", async () => {
    const user = userEvent.setup();
    render(<NestedModalHarness />);

    await user.click(screen.getByRole("button", { name: "Open child" }));
    expect(screen.getByRole("dialog", { name: "Parent modal" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Child modal" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Child modal" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Parent modal" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Parent modal" })).not.toBeInTheDocument();
  });

  it("traps focus only inside the top modal", async () => {
    const user = userEvent.setup();
    render(<NestedModalHarness />);

    await user.click(screen.getByRole("button", { name: "Open child" }));
    expect(screen.getAllByRole("button", { name: "Close modal" })[1]).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Child action" })).toHaveFocus();
    await user.tab();
    expect(screen.getAllByRole("button", { name: "Close modal" })[1]).toHaveFocus();
    expect(screen.getByRole("button", { name: "Parent action" })).not.toHaveFocus();
  });
});
