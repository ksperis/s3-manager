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
      bucket_compare_enabled: true,
      manager_ceph_s3_user_keys_enabled: false,
      allow_ui_user_bucket_migration: false,
      allow_login_access_keys: false,
      allow_login_endpoint_list: false,
      allow_login_custom_endpoint: false,
      allow_user_private_connections: false,
    },
    portal: {
      allow_portal_key: false,
      allow_portal_user_bucket_create: true,
      allow_portal_user_access_key_create: true,
      max_portal_user_access_keys: 2,
      iam_group_manager_policy: {
        actions: ["iam:*", "s3:*", "sts:*"],
        advanced_policy: null,
      },
      iam_group_user_policy: {
        actions: ["s3:ListAllMyBuckets", "sts:GetSessionToken"],
        advanced_policy: null,
      },
      bucket_access_policy: {
        actions: ["s3:GetBucketLocation"],
        advanced_policy: null,
      },
      bucket_defaults: {
        versioning: true,
        enable_cors: true,
        enable_lifecycle: true,
        cors_allowed_origins: [],
      },
      override_policy: {
        allow_portal_key: false,
        allow_portal_user_bucket_create: false,
        allow_portal_user_access_key_create: false,
        iam_group_manager_policy: { actions: false, advanced_policy: false },
        iam_group_user_policy: { actions: false, advanced_policy: false },
        bucket_access_policy: { actions: false, advanced_policy: false },
        bucket_defaults: {
          versioning: false,
          enable_cors: false,
          enable_lifecycle: false,
          cors_allowed_origins: false,
        },
      },
    },
    manager: {
      allow_manager_user_usage_stats: true,
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

describe("ManagerSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAppSettingsMock.mockResolvedValue(buildSettings());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
  });

  it("renders Ceph S3 User keys toggle and sends it in save payload", async () => {
    const user = userEvent.setup();
    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Ceph S3 User keys manager")) as HTMLInputElement;
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

  it("resets Ceph S3 User keys toggle from defaults", async () => {
    const user = userEvent.setup();
    const defaults = buildSettings();
    defaults.general.manager_ceph_s3_user_keys_enabled = true;
    fetchDefaultAppSettingsMock.mockResolvedValue(defaults);

    render(<ManagerSettingsPage />);

    const toggle = (await screen.findByLabelText("Ceph S3 User keys manager")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));

    await waitFor(() => {
      expect(toggle.checked).toBe(true);
    });
  });

  it("shows Experimental badge on bucket migration tool toggle", async () => {
    render(<ManagerSettingsPage />);

    await screen.findByLabelText("Bucket migration tool");
    expect(screen.getByText("Experimental")).toBeInTheDocument();
  });

  it("does not render allow portal manager workspace toggle", async () => {
    render(<ManagerSettingsPage />);

    await screen.findByLabelText("Allow manager user stats");
    expect(screen.queryByLabelText("Allow portal manager workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Deprecated")).not.toBeInTheDocument();
  });
});
