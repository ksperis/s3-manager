import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StorageEndpointsPage from "./StorageEndpointsPage";

const listStorageEndpointsMock = vi.fn();
const fetchStorageEndpointsMetaMock = vi.fn();
const createStorageEndpointMock = vi.fn();
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
  createStorageEndpoint: (payload: unknown) => createStorageEndpointMock(payload),
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
    createStorageEndpointMock.mockResolvedValue(makeEndpoint({ id: 8, name: "AWS Global", provider: "aws", endpoint_url: "https://s3.amazonaws.com" }));
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
    fireEvent.focus(await screen.findByRole("textbox", { name: "Add a tag for this endpoint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add tag rgw-a" }));
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

  it("preconfigures AWS endpoint defaults and submits AWS features", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 3, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Storage name"), { target: { value: "AWS Global" } });
    fireEvent.click(screen.getByLabelText("AWS"));

    expect(screen.getByLabelText("Endpoint S3")).toHaveValue("https://s3.amazonaws.com");
    expect(screen.getByLabelText("Region (optional)")).toHaveValue("us-east-1");
    expect(screen.queryByText("Management")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AWS Global",
          endpoint_url: "https://s3.amazonaws.com",
          region: "us-east-1",
          provider: "aws",
          verify_tls: true,
        })
      );
    });
    const payload = createStorageEndpointMock.mock.calls[0][0] as { features_config?: string };
    expect(payload.features_config).toContain("sts:\n    enabled: true\n    endpoint: https://sts.amazonaws.com");
    expect(payload.features_config).toContain("iam:\n    enabled: true\n    endpoint: https://iam.amazonaws.com");
    expect(payload.features_config).toContain("static_website:\n    enabled: true");
    expect(payload.features_config).toContain("sse:\n    enabled: true");
    expect(payload.features_config).toContain("sns:\n    enabled: false");
  });
});
