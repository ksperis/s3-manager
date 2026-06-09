import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminBrowserPage from "./CephAdminBrowserPage";
import CephAdminBucketsPage from "./CephAdminBucketsPage";
import CephAdminDashboard from "./CephAdminDashboard";

const useCephAdminEndpointMock = vi.fn();
const capturedWorkbenchProps: Array<Record<string, unknown>> = [];

vi.mock("./CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: {
      endpoint_status_enabled: false,
    },
  }),
}));

vi.mock("../browser/BrowserEmbed", () => ({
  default: (props: { onSelectedBucketNameChange?: (bucketName: string) => void }) => (
    <button
      type="button"
      data-testid="browser-embed"
      onClick={() => props.onSelectedBucketNameChange?.("bucket-a")}
    >
      browser
    </button>
  ),
}));

vi.mock("../shared/BucketOpsWorkbench", () => ({
  default: (props: Record<string, unknown>) => {
    capturedWorkbenchProps.push(props);
    const shell = props.shell as { pageDescription?: string } | undefined;
    return <div>{shell?.pageDescription}</div>;
  },
}));

describe("ceph-admin shell pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedWorkbenchProps.length = 0;
    useCephAdminEndpointMock.mockReturnValue({
      loading: false,
      selectedEndpointId: null,
      selectedEndpoint: null,
      selectedEndpointAccess: null,
      selectedEndpointAccessLoading: false,
      selectedEndpointAccessError: null,
    });
  });

  it("renders the ceph-admin dashboard without a page-level context strip", () => {
    render(
      <MemoryRouter>
        <CephAdminDashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Select a Ceph endpoint before using Ceph Admin")).toBeInTheDocument();
    expect(screen.queryByText("Endpoint context")).not.toBeInTheDocument();
  });

  it("renders the ceph-admin browser page without a page-level context strip", () => {
    render(
      <MemoryRouter>
        <CephAdminBrowserPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Select a Ceph endpoint")).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation")).getByRole("link", {
        name: "Ceph Admin",
      })
    ).toHaveAttribute("href", "/ceph-admin");
    expect(within(screen.getByRole("navigation")).getByText("Browser")).toBeInTheDocument();
    expect(screen.queryByText("Endpoint context")).not.toBeInTheDocument();
  });

  it("adds the selected bucket to the ceph-admin browser breadcrumb", () => {
    useCephAdminEndpointMock.mockReturnValue({
      loading: false,
      selectedEndpointId: 1,
      selectedEndpoint: {
        id: 1,
        name: "Lab RGW",
        capabilities: {},
      },
      selectedEndpointAccess: null,
      selectedEndpointAccessLoading: false,
      selectedEndpointAccessError: null,
    });

    render(
      <MemoryRouter>
        <CephAdminBrowserPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("browser-embed"));

    expect(within(screen.getByRole("navigation")).getByText("bucket-a")).toBeInTheDocument();
  });

  it("keeps the shared buckets workbench shell without injecting a context strip", () => {
    render(<CephAdminBucketsPage />);

    expect(screen.getByText("Cluster-level bucket listing (Admin Ops + S3).")).toBeInTheDocument();
    expect(capturedWorkbenchProps[0]).toMatchObject({
      mode: "ceph-admin",
      shell: {
        pageDescription: "Cluster-level bucket listing (Admin Ops + S3).",
      },
    });
  });
});
