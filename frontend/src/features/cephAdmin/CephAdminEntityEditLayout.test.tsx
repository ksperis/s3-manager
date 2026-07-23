import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAccountEditModal from "./CephAdminAccountEditModal";
import CephAdminUserEditModal from "./CephAdminUserEditModal";

const getCephAdminAccountDetailMock = vi.fn();
const getCephAdminUserDetailMock = vi.fn();

vi.mock("../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdmin")>("../../api/cephAdmin");
  return {
    ...actual,
    getCephAdminAccountDetail: (...args: unknown[]) => getCephAdminAccountDetailMock(...args),
    getCephAdminUserDetail: (...args: unknown[]) => getCephAdminUserDetailMock(...args),
  };
});

describe("Ceph Admin entity editor layout", () => {
  beforeEach(() => {
    getCephAdminAccountDetailMock.mockReset();
    getCephAdminUserDetailMock.mockReset();
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
});
