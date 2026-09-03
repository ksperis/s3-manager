import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings } from "../../api/appSettings";
import ManagerSettingsPage from "./ManagerSettingsPage";

const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();

vi.mock("../../api/appSettings", () => ({
  fetchAppSettings: () => fetchAppSettingsMock(),
  fetchDefaultAppSettings: () => fetchDefaultAppSettingsMock(),
  updateAppSettings: (payload: AppSettings) => updateAppSettingsMock(payload),
}));

function buildSettings(): AppSettings {
  return {
    general: {
      manager_enabled: true,
      ceph_admin_enabled: false,
      storage_ops_enabled: false,
      browser_enabled: true,
      browser_root_enabled: true,
      browser_manager_enabled: false,
      browser_portal_enabled: true,
      browser_ceph_admin_enabled: true,
      portal_enabled: true,
      billing_enabled: false,
      endpoint_status_enabled: false,
      quota_alerts_enabled: false,
      usage_history_enabled: false,
      bucket_migration_enabled: true,
      bucket_purge_enabled: false,
      bucket_compare_enabled: true,
      bucket_integrity_check_enabled: false,
      bucket_usage_stats_enabled: true,
      bucket_quota_management_enabled: true,
      manager_ceph_s3_user_keys_enabled: false,
      managed_private_connection_provisioning_enabled: false,
      allow_login_access_keys: false,
      allow_login_endpoint_list: false,
      allow_login_custom_endpoint: false,
    },
    manager: {
      manager_rgw_usage_metrics_enabled: true,
      bucket_migration_parallelism_default: 8,
      bucket_migration_parallelism_max: 16,
      bucket_migration_max_active_per_endpoint: 2,
    },
    quota_notifications: {
      threshold_percent: 85,
      include_subject_contact_email: false,
      smtp_host: null,
      smtp_port: 587,
      smtp_username: null,
      smtp_from_email: null,
      smtp_from_name: null,
      smtp_starttls: true,
      smtp_timeout_seconds: 15,
    },
    browser: {
      allow_proxy_transfers: true,
      direct_upload_parallelism: 5,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 5,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 3,
      streaming_zip_threshold_mb: 200,
    },
    onboarding: {
      dismissed: false,
    },
    branding: {
      primary_color: "#0569f8",
      login_logo_url: null,
    },
  };
}

describe("ManagerSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAppSettingsMock.mockResolvedValue(buildSettings());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
  });

  it("renders Ceph access-key management and sends its kill switch in the save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Ceph S3 User access-key management")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(toggle);
    expect(toggle.checked).toBe(true);

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.manager_ceph_s3_user_keys_enabled).toBe(true);
  });

  it("saves managed private connection provisioning from an experimental default-off toggle", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Provision managed private connections")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.managed_private_connection_provisioning_enabled).toBe(true);
    expect(screen.getAllByText("Experimental")).toHaveLength(2);
  });

  it("saves RGW metrics independently from bucket composition statistics", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const compositionToggle = (await screen.findByLabelText("Bucket composition statistics")) as HTMLInputElement;
    const rgwMetricsToggle = screen.getByLabelText("RGW traffic and usage metrics") as HTMLInputElement;
    expect(compositionToggle.checked).toBe(true);
    expect(rgwMetricsToggle.checked).toBe(true);

    await user.click(rgwMetricsToggle);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.manager.manager_rgw_usage_metrics_enabled).toBe(false);
    expect(payload.general.bucket_usage_stats_enabled).toBe(true);
  });

  it("renders bucket quota kill switch and sends it in save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    expect(
      await screen.findByText(
        "Enables Ceph bucket quota management for eligible S3 Account and RGW User contexts in Manager. Requires buckets=write on the endpoint Admin Ops identity."
      )
    ).toBeInTheDocument();
    const toggle = (await screen.findByLabelText("Bucket quota management")) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.bucket_quota_management_enabled).toBe(false);
  });

  it("renders bucket integrity toggle and sends it in save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Bucket integrity check tool")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(toggle);
    expect(toggle.checked).toBe(true);

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.bucket_integrity_check_enabled).toBe(true);
  });

  it("renders bucket purge toggle and sends it in save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Bucket purge tool")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(toggle);
    expect(toggle.checked).toBe(true);

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.bucket_purge_enabled).toBe(true);
  });

  it("resets Ceph access-key management from defaults", async () => {
    const user = userEvent.setup();
    const defaults = buildSettings();
    defaults.general.manager_ceph_s3_user_keys_enabled = true;
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Ceph S3 User access-key management")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expect(toggle.checked).toBe(true);
    });
  });

  it("resets managed private connection provisioning from defaults", async () => {
    const user = userEvent.setup();
    const current = buildSettings();
    current.general.managed_private_connection_provisioning_enabled = true;
    fetchAppSettingsMock.mockResolvedValue(current);

    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Provision managed private connections")) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expect(toggle.checked).toBe(false);
    });
  });

  it("resets RGW metrics and bucket composition from their independent defaults", async () => {
    const user = userEvent.setup();
    const current = buildSettings();
    current.general.bucket_usage_stats_enabled = false;
    current.manager.manager_rgw_usage_metrics_enabled = true;
    fetchAppSettingsMock.mockResolvedValue(current);
    const defaults = buildSettings();
    defaults.general.bucket_usage_stats_enabled = true;
    defaults.manager.manager_rgw_usage_metrics_enabled = false;
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const compositionToggle = (await screen.findByLabelText("Bucket composition statistics")) as HTMLInputElement;
    const rgwMetricsToggle = screen.getByLabelText("RGW traffic and usage metrics") as HTMLInputElement;
    expect(compositionToggle.checked).toBe(false);
    expect(rgwMetricsToggle.checked).toBe(true);

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expect(compositionToggle.checked).toBe(true);
      expect(rgwMetricsToggle.checked).toBe(false);
    });
  });

  it("resets bucket integrity toggle from defaults", async () => {
    const user = userEvent.setup();
    const defaults = buildSettings();
    defaults.general.bucket_integrity_check_enabled = true;
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Bucket integrity check tool")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expect(toggle.checked).toBe(true);
    });
  });

  it("resets bucket purge toggle from defaults", async () => {
    const user = userEvent.setup();
    const defaults = buildSettings();
    defaults.general.bucket_purge_enabled = true;
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Bucket purge tool")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await user.click(screen.getByRole("button", { name: "Load defaults" }));

    await waitFor(() => {
      expect(toggle.checked).toBe(true);
    });
  });


  it("shows Experimental badge on bucket migration tool toggle", async () => {
    render(<ManagerSettingsPage />);

    await screen.findByLabelText("Bucket migration tool");
    expect(screen.getAllByText("Experimental")).toHaveLength(2);
  });

  it("groups global usage and Manager tools without workspace policy wording", async () => {
    render(<ManagerSettingsPage />);

    await screen.findByLabelText("Bucket composition statistics");
    expect(screen.getByText("Usage and metrics")).toBeInTheDocument();
    expect(screen.getByText("Manager tools")).toBeInTheDocument();
    expect(screen.getByText("Optional administrative and operational tools available in Manager.")).toBeInTheDocument();
    expect(screen.queryByText(/Workspace access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/non-admin/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").map((toggle) => toggle.getAttribute("aria-label"))).toEqual([
      "Bucket composition statistics",
      "RGW traffic and usage metrics",
      "Bucket quota management",
      "Ceph S3 User access-key management",
      "Provision managed private connections",
      "Bucket migration tool",
      "Bucket compare tool",
      "Bucket integrity check tool",
      "Bucket purge tool",
    ]);
  });
});
