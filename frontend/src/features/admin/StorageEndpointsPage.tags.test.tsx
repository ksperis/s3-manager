import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StorageEndpointsPage from "./StorageEndpointsPage";

const listStorageEndpointsMock = vi.fn();
const fetchStorageEndpointsMetaMock = vi.fn();
const updateStorageEndpointTagsMock = vi.fn();
const listAdminTagDefinitionsMock = vi.fn();

const makeTag = (id: number, label: string, color_key = "neutral", scope = "standard") => ({
  id,
  label,
  color_key,
  scope,
});

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      ceph_admin_enabled: true,
    },
  }),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
  fetchStorageEndpointsMeta: () => fetchStorageEndpointsMetaMock(),
  updateStorageEndpointTags: (id: number, payload: unknown) => updateStorageEndpointTagsMock(id, payload),
  detectStorageEndpointFeatures: vi.fn(),
  createStorageEndpoint: vi.fn(),
  deleteStorageEndpoint: vi.fn(),
  getStorageEndpoint: vi.fn(),
  setDefaultStorageEndpoint: vi.fn(),
  updateStorageEndpoint: vi.fn(),
}));

vi.mock("../../api/tags", () => ({
  listAdminTagDefinitions: (domain: unknown) => listAdminTagDefinitionsMock(domain),
  listPrivateConnectionTagDefinitions: vi.fn(),
}));

function makeEndpoint(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 7,
    name: "Ceph Endpoint",
    endpoint_url: "https://ceph.example.test",
    provider: "ceph",
    is_default: true,
    is_editable: true,
    verify_tls: true,
    tags: [makeTag(801, "prod")],
    capabilities: {
      admin: true,
      account: true,
      usage: true,
      metrics: true,
      iam: true,
      sts: false,
      static_website: false,
      sns: false,
      sse: false,
    },
    has_admin_secret: false,
    has_supervision_secret: false,
    has_ceph_admin_secret: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StorageEndpointsPage tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchStorageEndpointsMetaMock.mockResolvedValue({ managed_by_env: false });
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint()]);
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(801, "prod"), makeTag(802, "rgw-a")]);
    updateStorageEndpointTagsMock.mockResolvedValue(makeEndpoint({ tags: [makeTag(801, "prod"), makeTag(802, "rgw-a")] }));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("lets superadmin edit endpoint tags even when endpoints are env-managed", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 1, role: "ui_superadmin" }));
    fetchStorageEndpointsMetaMock.mockResolvedValue({ managed_by_env: true });

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add rgw-a" }));
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));

    await waitFor(() => {
      expect(updateStorageEndpointTagsMock).toHaveBeenCalledWith(7, {
        tags: [
          expect.objectContaining({ label: "prod", color_key: "neutral" }),
          expect.objectContaining({ label: "rgw-a", color_key: "neutral" }),
        ],
      });
    });
  });

  it("keeps endpoint tags visible but hides editing from ui_admin", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 2, role: "ui_admin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("prod").parentElement?.className).toContain("text-[10px]");
    expect(screen.queryByRole("button", { name: "Edit tags" })).not.toBeInTheDocument();
  });
});
