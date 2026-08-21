import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAccountEditModal from "./CephAdminAccountEditModal";
import CephAdminUserEditModal from "./CephAdminUserEditModal";

const getCephAdminAccountDetailMock = vi.fn();
const getCephAdminUserDetailMock = vi.fn();
const createCephAdminUserKeyMock = vi.fn();
const deleteCephAdminUserKeyMock = vi.fn();
const listCephAdminUserKeysMock = vi.fn();

vi.mock("../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdmin")>("../../api/cephAdmin");
  return {
    ...actual,
    getCephAdminAccountDetail: (...args: unknown[]) => getCephAdminAccountDetailMock(...args),
    getCephAdminUserDetail: (...args: unknown[]) => getCephAdminUserDetailMock(...args),
    createCephAdminUserKey: (...args: unknown[]) => createCephAdminUserKeyMock(...args),
    deleteCephAdminUserKey: (...args: unknown[]) => deleteCephAdminUserKeyMock(...args),
    listCephAdminUserKeys: (...args: unknown[]) => listCephAdminUserKeysMock(...args),
  };
});

describe("Ceph Admin entity editor layout", () => {
  beforeEach(() => {
    getCephAdminAccountDetailMock.mockReset();
    getCephAdminUserDetailMock.mockReset();
    createCephAdminUserKeyMock.mockReset();
    deleteCephAdminUserKeyMock.mockReset();
    listCephAdminUserKeysMock.mockReset();
    localStorage.clear();
    listCephAdminUserKeysMock.mockResolvedValue([]);
    createCephAdminUserKeyMock.mockResolvedValue({
      access_key: "AKIA-EDIT",
      secret_key: "SECRET-EDIT",
    });
    deleteCephAdminUserKeyMock.mockResolvedValue(undefined);
    getCephAdminAccountDetailMock.mockResolvedValue({
      account_id: "RGW12345678901234567",
      account_name: "Analytics",
      email: "analytics@example.com",
      bucket_count: 2,
      user_count: 3,
      max_buckets: 10,
      max_users: 20,
      max_roles: 5,
      max_groups: 5,
      max_access_keys: 4,
      quota: { enabled: true, max_size_bytes: 1024 ** 3, max_objects: 1000 },
      bucket_quota: { enabled: false, max_size_bytes: null, max_objects: null },
    });
    getCephAdminUserDetailMock.mockResolvedValue({
      uid: "analytics-user",
      display_name: "Analytics user",
      email: "analytics-user@example.com",
      account_id: "RGW12345678901234567",
      account_name: "Analytics",
      suspended: false,
      admin: false,
      system: false,
      account_root: false,
      max_buckets: 10,
      op_mask: "read,write",
      default_placement: "default-placement",
      default_storage_class: "STANDARD",
      quota: { enabled: true, max_size_bytes: 1024 ** 3, max_objects: 1000 },
      caps: ["users=read"],
      keys: [],
    });
  });

  it("uses one unframed account page with bar tabs and no repeated entity title", async () => {
    const { container } = render(
      <MemoryRouter>
        <CephAdminAccountEditModal
          endpointId={7}
          accountId="RGW12345678901234567"
          canViewMetrics={false}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Analytics")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Account RGW12345678901234567" })).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Account configuration sections" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Analytics");
    expect(container.querySelector(".workflow-page > .rounded-lg.border")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Account name");
  });

  it("uses the same page hierarchy for RGW user configuration", async () => {
    const { container } = render(
      <MemoryRouter>
        <CephAdminUserEditModal
          endpointId={7}
          uid="analytics-user"
          canViewMetrics={false}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("analytics-user@example.com")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "User analytics-user" })).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "User configuration sections" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Analytics");
    expect(container.querySelector(".workflow-page > .rounded-lg.border")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Ceph Admin" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Display name");
    expect(screen.queryByRole("heading", { name: "Admin Ops configuration" })).not.toBeInTheDocument();
  });

  it("hides Add as S3 Connection in RGW user key management without manual permission", async () => {
    localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_superadmin",
        effective_access: { can_create_manual_private_connections: false },
      })
    );
    render(
      <MemoryRouter>
        <CephAdminUserEditModal
          endpointId={7}
          uid="analytics-user"
          canViewMetrics={false}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("analytics-user@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Key Management" }));
    fireEvent.click(screen.getByRole("button", { name: "New key" }));

    expect(await screen.findByText("Key created")).toBeInTheDocument();
    expect(screen.getByText("SECRET-EDIT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add as S3 Connection" })).not.toBeInTheDocument();
  });

  it("confirms before deleting an RGW user access key", async () => {
    const accessKey = {
      access_key: "AKIA-DELETE",
      status: "enabled",
      created_at: "2026-08-21T12:00:00Z",
      is_private_access_managed: false,
    };
    getCephAdminUserDetailMock.mockResolvedValueOnce({
      uid: "analytics-user",
      display_name: "Analytics user",
      email: "analytics-user@example.com",
      account_id: "RGW12345678901234567",
      account_name: "Analytics",
      suspended: false,
      admin: false,
      system: false,
      account_root: false,
      max_buckets: 10,
      op_mask: "read,write",
      default_placement: "default-placement",
      default_storage_class: "STANDARD",
      quota: { enabled: true, max_size_bytes: 1024 ** 3, max_objects: 1000 },
      caps: ["users=read"],
      keys: [accessKey],
    });
    listCephAdminUserKeysMock.mockResolvedValueOnce([accessKey]).mockResolvedValueOnce([]);

    render(
      <MemoryRouter>
        <CephAdminUserEditModal
          endpointId={7}
          uid="analytics-user"
          canViewMetrics={false}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("analytics-user@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Key Management" }));
    expect(await screen.findByText("AKIA-DELETE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(deleteCephAdminUserKeyMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete access key?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete key" }));

    await waitFor(() => {
      expect(deleteCephAdminUserKeyMock).toHaveBeenCalledWith(7, "analytics-user", "AKIA-DELETE", undefined);
    });
  });
});
