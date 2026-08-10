import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings } from "../../api/appSettings";
import PortalSettingsPage from "./PortalSettingsPage";

const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();

vi.mock("../../api/appSettings", () => ({
  fetchAppSettings: () => fetchAppSettingsMock(),
  fetchDefaultAppSettings: () => fetchDefaultAppSettingsMock(),
  updateAppSettings: (payload: AppSettings) => updateAppSettingsMock(payload),
}));

vi.mock("../../utils/confirm", () => ({
  confirmAction: () => true,
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
      portal_enabled: false,
      billing_enabled: false,
      endpoint_status_enabled: false,
      quota_alerts_enabled: false,
      usage_history_enabled: false,
      bucket_migration_enabled: true,
      bucket_purge_enabled: false,
      bucket_compare_enabled: true,
      bucket_integrity_check_enabled: true,
      bucket_usage_stats_enabled: true,
      bucket_quota_management_enabled: true,
      manager_ceph_s3_user_keys_enabled: true,
      allow_login_access_keys: false,
      allow_login_endpoint_list: false,
      allow_login_custom_endpoint: false,
    },
    portal: {
      browser_access_enabled: false,
      allow_private_storage_space_create: true,
      allow_portal_named_bucket_create: false,
      allow_portal_user_access_key_create: true,
      server_access_logging_enabled: true,
      server_access_log_retention_days: 30,
      storage_space_version_cleanup_enabled: true,
      max_portal_user_access_keys: 2,
      bucket_defaults: {
        versioning: true,
        enable_cors: true,
        enable_lifecycle: true,
        noncurrent_version_expiration_days: 90,
        cors_allowed_origins: [],
      },
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
      primary_color: "#0ea5e9",
      login_logo_url: null,
    },
  };
}

describe("PortalSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAppSettingsMock.mockResolvedValue(buildSettings());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
  });

  it("sends max portal user keys in save payload", async () => {
    render(<PortalSettingsPage />);

    expect(
      await screen.findByText("Configure Portal self-service behavior and backing storage defaults.")
    ).toBeInTheDocument();
    const input = (await screen.findByLabelText("Max S3 access keys per portal user")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.portal.max_portal_user_access_keys).toBe(5);
  });

  it("saves standalone Browser workspace access disabled by default", async () => {
    render(<PortalSettingsPage />);

    const toggle = await screen.findByLabelText("Portal Browser workspace access");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateAppSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateAppSettingsMock.mock.calls[0][0].portal.browser_access_enabled).toBe(true);
  });

  it("sends server access log retention in save payload", async () => {
    render(<PortalSettingsPage />);

    const input = (await screen.findByLabelText("Server access log retention days")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "45" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.portal.server_access_log_retention_days).toBe(45);
  });

  it("sends version history retention days in save payload", async () => {
    render(<PortalSettingsPage />);

    const input = (await screen.findByLabelText("Version history retention days")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "45" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.portal.bucket_defaults.noncurrent_version_expiration_days).toBe(45);
  });

  it("rejects a non-positive version history retention", async () => {
    render(<PortalSettingsPage />);

    const input = (await screen.findByLabelText("Version history retention days")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Version history retention must be a positive integer.")).toBeInTheDocument();
    expect(updateAppSettingsMock).not.toHaveBeenCalled();
  });

  it("saves named storage creation setting without override policy controls", async () => {
    render(<PortalSettingsPage />);

    fireEvent.click(await screen.findByLabelText("Portal named storage creation"));
    fireEvent.click(screen.getByLabelText("Portal Server Access Logging"));
    fireEvent.click(screen.getByLabelText("Portal Storage Space history cleanup"));
    expect(screen.queryByRole("checkbox", { name: "Allow override" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.portal.allow_portal_named_bucket_create).toBe(true);
    expect(payload.portal.server_access_logging_enabled).toBe(false);
    expect(payload.portal.storage_space_version_cleanup_enabled).toBe(false);
    expect("override_policy" in payload.portal).toBe(false);
  });

  it("labels portal user Storage Space creation without bucket management wording", async () => {
    render(<PortalSettingsPage />);

    expect(await screen.findByText("Private Storage Space creation")).toBeInTheDocument();
    expect(screen.queryByText("Bucket management")).not.toBeInTheDocument();
    expect(screen.queryByText("Policy bucket access")).not.toBeInTheDocument();
    expect(screen.queryByText("Storage Space access policy")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Private Storage Space creation")).toBeInTheDocument();
  });
});
