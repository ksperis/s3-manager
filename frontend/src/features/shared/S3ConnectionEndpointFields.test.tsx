import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorageEndpoint } from "../../api/storageEndpoints";
import S3ConnectionEndpointFields from "./S3ConnectionEndpointFields";

const endpoint = {
  id: 7,
  name: "Ceph main",
  endpoint_url: "https://rgw.example.test",
  force_path_style: true,
  verify_tls: true,
  provider: "ceph",
  has_admin_secret: false,
  has_supervision_secret: false,
  has_ceph_admin_secret: false,
  features: {
    admin: { enabled: false },
    account: { enabled: false },
    sts: { enabled: false },
    usage: { enabled: false },
    metrics: { enabled: false },
    static_website: { enabled: false },
    iam: { enabled: false },
    sns: { enabled: false },
    sse: { enabled: false },
    replication: { enabled: false },
    healthcheck: { enabled: true, mode: "http" },
  },
  is_default: true,
  is_editable: true,
  tags: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
} satisfies StorageEndpoint;

describe("S3ConnectionEndpointFields", () => {
  it("uses shared controls for configured endpoint selection", () => {
    const onEndpointIdChange = vi.fn();

    render(
      <S3ConnectionEndpointFields
        mode="preset"
        onModeChange={vi.fn()}
        modeInputName="connection-endpoint-mode"
        endpointId=""
        onEndpointIdChange={onEndpointIdChange}
        endpoints={[endpoint]}
        loadingEndpoints={false}
        form={{
          provider_hint: "",
          endpoint_url: "",
          region: "",
          force_path_style: true,
          verify_tls: true,
        }}
        onFormChange={vi.fn()}
      />
    );

    const configuredEndpoint = screen.getByRole("combobox", { name: "Configured endpoint" });
    expect(configuredEndpoint).toHaveClass("ui-control");

    fireEvent.change(configuredEndpoint, { target: { value: "7" } });
    expect(onEndpointIdChange).toHaveBeenCalledWith("7");
  });

  it("uses shared controls for custom endpoint settings", () => {
    const onFormChange = vi.fn();

    render(
      <S3ConnectionEndpointFields
        mode="custom"
        onModeChange={vi.fn()}
        modeInputName="connection-endpoint-mode"
        endpointId=""
        onEndpointIdChange={vi.fn()}
        endpoints={[endpoint]}
        loadingEndpoints={false}
        form={{
          provider_hint: "",
          endpoint_url: "",
          region: "",
          force_path_style: false,
          verify_tls: true,
        }}
        onFormChange={onFormChange}
      />
    );

    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveClass("ui-control");
    expect(screen.getByLabelText("Region")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Endpoint URL")).toHaveClass("ui-control");

    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "minio" },
    });
    fireEvent.change(screen.getByLabelText("Endpoint URL"), {
      target: { value: "https://minio.example.test" },
    });
    fireEvent.click(screen.getByLabelText("Force path style"));

    expect(onFormChange).toHaveBeenCalledWith("provider_hint", "minio");
    expect(onFormChange).toHaveBeenCalledWith("endpoint_url", "https://minio.example.test");
    expect(onFormChange).toHaveBeenCalledWith("force_path_style", true);
  });
});
