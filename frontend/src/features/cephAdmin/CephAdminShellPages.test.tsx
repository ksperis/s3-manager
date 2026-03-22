import { render, screen } from "@testing-library/react";
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
  default: () => <div data-testid="browser-embed">browser</div>,
}));

vi.mock("../shared/BucketOpsWorkbench", () => ({
  default: (props: Record<string, unknown>) => {
    capturedWorkbenchProps.push(props);
    const shell = props.shell as { contextStrip?: { label?: string } } | undefined;
    return <div>{shell?.contextStrip?.label}</div>;
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

  it("renders the helperized endpoint context strip on the ceph-admin dashboard", () => {
    render(
      <MemoryRouter>
        <CephAdminDashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Endpoint context")).toBeInTheDocument();
    expect(screen.getByText("Select a Ceph endpoint before using Ceph Admin")).toBeInTheDocument();
  });

  it("renders the helperized endpoint context strip on the ceph-admin browser page", () => {
    render(
      <MemoryRouter>
        <CephAdminBrowserPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Endpoint context")).toBeInTheDocument();
    expect(screen.getByText("Select a Ceph endpoint")).toBeInTheDocument();
  });

  it("injects the endpoint context strip into the shared buckets workbench", () => {
    render(<CephAdminBucketsPage />);

    expect(screen.getByText("Endpoint context")).toBeInTheDocument();
    expect(capturedWorkbenchProps[0]).toMatchObject({
      mode: "ceph-admin",
      shell: {
        contextStrip: {
          label: "Endpoint context",
        },
      },
    });
  });
});
