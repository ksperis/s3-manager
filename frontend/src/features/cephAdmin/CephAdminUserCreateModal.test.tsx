import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminUserCreateModal from "./CephAdminUserCreateModal";

const createCephAdminUserMock = vi.fn();
const listCephAdminAccountsMock = vi.fn();

vi.mock("../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdmin")>("../../api/cephAdmin");
  return {
    ...actual,
    createCephAdminUser: (...args: unknown[]) => createCephAdminUserMock(...args),
    listCephAdminAccounts: (...args: unknown[]) => listCephAdminAccountsMock(...args),
  };
});

describe("CephAdminUserCreateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_superadmin",
        effective_access: { can_create_manual_private_connections: true },
      })
    );
    listCephAdminAccountsMock.mockResolvedValue({
      items: [
        {
          account_id: "RGW000000000000001",
          account_name: "Analytics",
        },
      ],
    });
    createCephAdminUserMock.mockResolvedValue({
      detail: {
        uid: "alice",
        display_name: "Alice Ops",
        caps: [],
        keys: [],
      },
      generated_key: null,
    });
  });

  it("uses shared form controls and submits normalized quota and caps fields", async () => {
    const onCreated = vi.fn();
    render(<CephAdminUserCreateModal endpointId={7} onClose={vi.fn()} onCreated={onCreated} />);

    const dialog = screen.getByRole("heading", { name: "Create user" }).closest(".workflow-page");
    if (!dialog) {
      throw new Error("Create user workflow page not found");
    }
    const accountSelect = within(dialog).getByLabelText("Account (optional)");
    expect(accountSelect).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("UID *")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Caps (one per line)")).toHaveClass("ui-control");

    await screen.findByRole("option", { name: "Analytics (RGW000000000000001)" });

    const userQuotaSection = within(dialog).getByText("User quota").closest("section");
    if (!userQuotaSection) {
      throw new Error("User quota section not found");
    }
    expect(within(userQuotaSection).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(userQuotaSection).getByLabelText("Unit")).toHaveClass("ui-control");
    expect(within(userQuotaSection).getByLabelText("Object quota")).toHaveClass("ui-control");

    fireEvent.change(accountSelect, { target: { value: "RGW000000000000001" } });
    fireEvent.change(within(dialog).getByLabelText("UID *"), { target: { value: "alice" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Alice Ops" } });
    fireEvent.change(within(dialog).getByLabelText("Max buckets"), { target: { value: "8" } });
    fireEvent.click(within(userQuotaSection).getByRole("checkbox", { name: "Configure user quota" }));
    fireEvent.change(within(userQuotaSection).getByLabelText("Storage quota"), { target: { value: "3" } });
    fireEvent.change(within(userQuotaSection).getByLabelText("Object quota"), { target: { value: "1200" } });
    fireEvent.change(within(dialog).getByLabelText("Caps mode"), { target: { value: "add" } });
    fireEvent.change(within(dialog).getByLabelText("Caps (one per line)"), {
      target: { value: "users=read\nusage=read\nusers=read" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(createCephAdminUserMock).toHaveBeenCalled();
    });

    expect(createCephAdminUserMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        uid: "alice",
        account_id: "RGW000000000000001",
        display_name: "Alice Ops",
        account_root: true,
        generate_key: true,
        max_buckets: 8,
        quota_enabled: true,
        quota_max_size_bytes: 3 * 1024 ** 3,
        quota_max_objects: 1200,
        caps: {
          mode: "add",
          values: ["users=read", "usage=read"],
        },
      })
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ uid: "alice" }));
  });

  it("shows generated keys in the shared one-time secret panel", async () => {
    createCephAdminUserMock.mockResolvedValue({
      detail: {
        uid: "bob",
        display_name: "Bob Ops",
        caps: [],
        keys: [],
      },
      generated_key: {
        access_key: "AKIA-CEPH-BOB",
        secret_key: "SECRET-CEPH-BOB",
      },
    });

    render(<CephAdminUserCreateModal endpointId={7} onClose={vi.fn()} />);

    const dialog = screen.getByRole("heading", { name: "Create user" }).closest(".workflow-page");
    if (!dialog) {
      throw new Error("Create user workflow page not found");
    }
    fireEvent.change(within(dialog).getByLabelText("UID *"), { target: { value: "bob" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Bob Ops" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(await within(dialog).findByText("Access key created")).toBeInTheDocument();
    expect(within(dialog).getByText("Secret is shown only once.")).toBeInTheDocument();
    expect(within(dialog).getByText("AKIA-CEPH-BOB")).toHaveClass("font-mono");
    expect(within(dialog).getByText("SECRET-CEPH-BOB")).toHaveClass("font-mono");
    expect(within(dialog).getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "Add as S3 Connection" })).toHaveClass("h-7");
  });

  it("hides Add as S3 Connection without manual creation permission", async () => {
    localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_superadmin",
        effective_access: { can_create_manual_private_connections: false },
      })
    );
    createCephAdminUserMock.mockResolvedValue({
      detail: { uid: "carol", display_name: "Carol Ops", caps: [], keys: [] },
      generated_key: { access_key: "AKIA-CEPH-CAROL", secret_key: "SECRET-CEPH-CAROL" },
    });

    render(<CephAdminUserCreateModal endpointId={7} onClose={vi.fn()} />);
    const dialog = screen.getByRole("heading", { name: "Create user" }).closest(".workflow-page");
    if (!dialog) throw new Error("Create user workflow page not found");
    fireEvent.change(within(dialog).getByLabelText("UID *"), { target: { value: "carol" } });
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Carol Ops" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(await within(dialog).findByText("Access key created")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add as S3 Connection" })).not.toBeInTheDocument();
  });
});
