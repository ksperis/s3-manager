import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StorageEndpointsPage from "./StorageEndpointsPage";

const listStorageEndpointsMock = vi.fn();
const fetchStorageEndpointsMetaMock = vi.fn();
const createStorageEndpointMock = vi.fn();
const updateStorageEndpointMock = vi.fn();
const updateStorageEndpointTagsMock = vi.fn();
const listAdminTagDefinitionsMock = vi.fn();

const makeTag = (id: number, label: string, color_key = "neutral", scope = "standard") => ({
  id,
  label,
  color_key,
  scope,
});

function expectBefore(first: Element, second: Element) {
  expect(Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
}

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
  updateStorageEndpoint: (id: number, payload: unknown) => updateStorageEndpointMock(id, payload),
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
    force_path_style: false,
    verify_tls: true,
    latitude: null,
    longitude: null,
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
      replication: false,
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
    createStorageEndpointMock.mockResolvedValue(makeEndpoint({ id: 8, name: "AWS Regional", provider: "aws", endpoint_url: "https://s3.us-east-1.amazonaws.com" }));
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(801, "prod"), makeTag(802, "rgw-a")]);
    updateStorageEndpointTagsMock.mockResolvedValue(makeEndpoint({ tags: [makeTag(801, "prod"), makeTag(802, "rgw-a")] }));
    updateStorageEndpointMock.mockResolvedValue(makeEndpoint());
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders storage endpoints as a compact table listing", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 1, role: "ui_superadmin" }));
    listStorageEndpointsMock.mockResolvedValue([
      makeEndpoint({
        force_path_style: true,
        latitude: 43.6047,
        longitude: 1.4442,
        admin_access_key: "admin-key",
        has_admin_secret: true,
        supervision_access_key: "supervision-key",
        has_supervision_secret: true,
        ceph_admin_access_key: "ceph-admin-key",
        has_ceph_admin_secret: true,
        features: {
          admin: { enabled: true, endpoint: "https://admin.ceph.example.test" },
          account: { enabled: true },
          usage: { enabled: true },
          metrics: { enabled: true },
          sns: { enabled: false },
          sts: { enabled: false },
          static_website: { enabled: false },
          iam: { enabled: true },
          sse: { enabled: false },
          replication: { enabled: false },
          healthcheck: { enabled: true, mode: "s3", url: "https://health.ceph.example.test" },
        },
      }),
    ]);

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    ["Endpoint", "Provider", "Connectivity", "Features", "Credentials", "Actions"].forEach((name) => {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    });

    const row = screen.getByText("Ceph Endpoint").closest("tr");
    expect(row).not.toBeNull();
    const endpointRow = within(row as HTMLElement);

    expect(endpointRow.getByText("Ceph Endpoint").closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(endpointRow.getByText("https://ceph.example.test")).toBeInTheDocument();
    expect(endpointRow.getByText("https://admin.ceph.example.test")).toBeInTheDocument();
    expect(endpointRow.getAllByText("Default")).toHaveLength(2);
    expect(endpointRow.getByText("prod")).toBeInTheDocument();
    expect(endpointRow.getByText("Ceph")).toBeInTheDocument();
    expect(endpointRow.getByText("Ceph").closest("td")).toHaveAttribute("data-label", "Provider");
    expect(endpointRow.getByText("Forced")).toBeInTheDocument();
    expect(endpointRow.getByText("Forced").closest("td")).toHaveAttribute("data-label", "Connectivity");
    expect(endpointRow.getByText("43.6047, 1.4442")).toBeInTheDocument();
    expect(endpointRow.getByText("S3")).toBeInTheDocument();
    expect(endpointRow.getByText("https://health.ceph.example.test")).toBeInTheDocument();
    expect(endpointRow.getByText("Admin on")).toBeInTheDocument();
    expect(endpointRow.getByText("SNS off")).toBeInTheDocument();
    expect(endpointRow.getByText("SNS off").closest("td")).toHaveAttribute("data-label", "Features");
    expect(endpointRow.getByText("admin-key")).toBeInTheDocument();
    expect(endpointRow.getByText("admin-key").closest("td")).toHaveAttribute("data-label", "Credentials");
    expect(endpointRow.getByText("supervision-key")).toBeInTheDocument();
    expect(endpointRow.getByText("ceph-admin-key")).toBeInTheDocument();
    expect(endpointRow.getAllByText("(secret stored)")).toHaveLength(3);
    expect(endpointRow.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(endpointRow.getByRole("button", { name: "Edit" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
    expect(endpointRow.getByRole("button", { name: "Delete" })).toBeInTheDocument();
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

  it("keeps endpoint tag editing visible on the identity row", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 3, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());

    const dialog = screen.getByRole("heading", { name: "New storage endpoint" }).closest(".workflow-page");
    if (!dialog) {
      throw new Error("New storage endpoint workflow page not found");
    }
    const storageName = within(dialog).getByLabelText("Storage name");
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this endpoint" });
    expect(tagInput).toBeInTheDocument();
    expect(tagInput.parentElement?.parentElement?.className).toContain("min-h-10");
    expect(within(dialog).queryByText("Endpoint tags")).not.toBeInTheDocument();
    expectBefore(storageName, tagInput);
    expectBefore(tagInput, within(dialog).getByText("Type"));
    expectBefore(within(dialog).getByText("Type"), within(dialog).getByText("Endpoint S3"));
  });

  it("submits Ceph bucket replication feature when enabled", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 4, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Storage name"), { target: { value: "Ceph Replication" } });
    fireEvent.change(screen.getByLabelText("Endpoint S3"), { target: { value: "https://ceph-repl.example.test" } });
    fireEvent.click(screen.getByLabelText("Bucket replication enabled"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Ceph Replication",
          endpoint_url: "https://ceph-repl.example.test",
          provider: "ceph",
        })
      );
    });
    const payload = createStorageEndpointMock.mock.calls[0][0] as { features_config?: string };
    expect(payload.features_config).toContain("replication:\n    enabled: true");
  });

  it("preconfigures AWS endpoint defaults and submits AWS features", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 5, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Storage name"), { target: { value: "AWS Regional" } });
    fireEvent.click(screen.getByLabelText("AWS"));

    expect(screen.getByLabelText("Endpoint S3")).toHaveValue("https://s3.us-east-1.amazonaws.com");
    expect(screen.getByLabelText("Region (optional)")).toHaveValue("us-east-1");
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(39.0438);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(-77.4874);
    expect(screen.queryByText("Management")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AWS Regional",
          endpoint_url: "https://s3.us-east-1.amazonaws.com",
          region: "us-east-1",
          provider: "aws",
          force_path_style: false,
          verify_tls: true,
          latitude: 39.0438,
          longitude: -77.4874,
        })
      );
    });
    const payload = createStorageEndpointMock.mock.calls[0][0] as { features_config?: string };
    expect(payload.features_config).toContain("sts:\n    enabled: true\n    endpoint: https://sts.us-east-1.amazonaws.com");
    expect(payload.features_config).toContain("iam:\n    enabled: true\n    endpoint: https://iam.amazonaws.com");
    expect(payload.features_config).toContain("static_website:\n    enabled: true");
    expect(payload.features_config).toContain("sse:\n    enabled: true");
    expect(payload.features_config).toContain("sns:\n    enabled: false");
    expect(payload.features_config).toContain("replication:\n    enabled: false");
  });

  it("syncs AWS generated endpoints when the region changes", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 5, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("AWS"));
    fireEvent.change(screen.getByLabelText("Region (optional)"), { target: { value: "eu-west-3" } });

    expect(screen.getByLabelText("Endpoint S3")).toHaveValue("https://s3.eu-west-3.amazonaws.com");
    expect(screen.getByLabelText("STS endpoint")).toHaveValue("https://sts.eu-west-3.amazonaws.com");
    expect(screen.getByLabelText("IAM endpoint")).toHaveValue("https://iam.amazonaws.com");
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(48.8566);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(2.3522);
  });

  it("keeps AWS endpoint fields read-only and submits computed values", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 6, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Storage name"), { target: { value: "AWS Locked" } });
    fireEvent.click(screen.getByLabelText("AWS"));
    expect(screen.getByLabelText("Endpoint S3")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("STS endpoint")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("IAM endpoint")).toHaveAttribute("readonly");

    fireEvent.change(screen.getByLabelText("Endpoint S3"), { target: { value: "https://s3.proxy.example.test" } });
    fireEvent.change(screen.getByLabelText("STS endpoint"), {
      target: { value: "https://sts.proxy.example.test" },
    });
    fireEvent.change(screen.getByLabelText("IAM endpoint"), {
      target: { value: "https://iam.proxy.example.test" },
    });
    fireEvent.change(screen.getByLabelText("Region (optional)"), { target: { value: "eu-west-3" } });

    expect(screen.getByLabelText("Endpoint S3")).toHaveValue("https://s3.eu-west-3.amazonaws.com");
    expect(screen.getByLabelText("STS endpoint")).toHaveValue("https://sts.eu-west-3.amazonaws.com");
    expect(screen.getByLabelText("IAM endpoint")).toHaveValue("https://iam.amazonaws.com");
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(48.8566);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(2.3522);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AWS Locked",
          endpoint_url: "https://s3.eu-west-3.amazonaws.com",
          region: "eu-west-3",
          provider: "aws",
          force_path_style: false,
          latitude: 48.8566,
          longitude: 2.3522,
        })
      );
    });
    const payload = createStorageEndpointMock.mock.calls[0][0] as { features_config?: string };
    expect(payload.features_config).toContain("endpoint: https://sts.eu-west-3.amazonaws.com");
    expect(payload.features_config).toContain("endpoint: https://iam.amazonaws.com");
  });

  it("clears AWS coordinates when the region is unknown", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 6, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Storage name"), { target: { value: "AWS Unknown" } });
    fireEvent.click(screen.getByLabelText("AWS"));
    fireEvent.change(screen.getByLabelText("Region (optional)"), { target: { value: "moon-west-1" } });

    expect(screen.getByLabelText("Endpoint S3")).toHaveValue("https://s3.moon-west-1.amazonaws.com");
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(null);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(null);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AWS Unknown",
          region: "moon-west-1",
          latitude: null,
          longitude: null,
        })
      );
    });
  });

  it("does not auto-fill coordinates for non-AWS providers", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 6, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    await waitFor(() => expect(listAdminTagDefinitionsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Latitude (optional)"), { target: { value: "12.34" } });
    fireEvent.change(screen.getByLabelText("Longitude (optional)"), { target: { value: "56.78" } });
    fireEvent.click(screen.getByLabelText("Other"));

    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(12.34);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(56.78);
  });

  it("submits force path style when creating an endpoint", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 6, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Storage name"), { target: { value: "Path Style" } });
    fireEvent.change(screen.getByLabelText("Endpoint S3"), { target: { value: "https://path-style.example.test" } });
    fireEvent.click(screen.getByLabelText("Force path style"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Path Style",
          endpoint_url: "https://path-style.example.test",
          force_path_style: true,
        })
      );
    });
  });

  it("submits GPS coordinates when creating an endpoint", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 6, role: "ui_superadmin" }));

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");

    fireEvent.click(screen.getByRole("button", { name: "New endpoint" }));
    fireEvent.change(screen.getByLabelText("Storage name"), { target: { value: "Geo Endpoint" } });
    fireEvent.change(screen.getByLabelText("Endpoint S3"), { target: { value: "https://geo.example.test" } });
    fireEvent.change(screen.getByLabelText("Latitude (optional)"), { target: { value: "48.8566" } });
    fireEvent.change(screen.getByLabelText("Longitude (optional)"), { target: { value: "2.3522" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createStorageEndpointMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Geo Endpoint",
          endpoint_url: "https://geo.example.test",
          latitude: 48.8566,
          longitude: 2.3522,
        })
      );
    });
  });

  it("preloads and updates force path style when editing an endpoint", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 7, role: "ui_superadmin" }));
    listStorageEndpointsMock.mockResolvedValue([makeEndpoint({ force_path_style: true })]);

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");
    expect(screen.getByText("Forced")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Force path style")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Force path style"));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(updateStorageEndpointMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          force_path_style: false,
        })
      );
    });
  });

  it("preloads and clears GPS coordinates when editing an endpoint", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 8, role: "ui_superadmin" }));
    listStorageEndpointsMock.mockResolvedValue([
      makeEndpoint({ latitude: 43.6047, longitude: 1.4442 }),
    ]);

    render(<StorageEndpointsPage />);
    await screen.findByText("Ceph Endpoint");
    expect(screen.getByText("43.6047, 1.4442")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Latitude (optional)")).toHaveValue(43.6047);
    expect(screen.getByLabelText("Longitude (optional)")).toHaveValue(1.4442);
    fireEvent.change(screen.getByLabelText("Latitude (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Longitude (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(updateStorageEndpointMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          latitude: null,
          longitude: null,
        })
      );
    });
  });
});
