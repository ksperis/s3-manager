import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, GeneralFeatureLocks } from "../../api/appSettings";
import GeneralSettingsPage from "./GeneralSettingsPage";

const setGeneralSettingsMock = vi.fn();
const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchGeneralFeatureLocksMock = vi.fn<() => Promise<GeneralFeatureLocks>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();
const applyBrandingMock = vi.fn();

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    setGeneralSettings: setGeneralSettingsMock,
  }),
}));

vi.mock("../../api/appSettings", () => ({
  fetchAppSettings: () => fetchAppSettingsMock(),
  fetchDefaultAppSettings: () => fetchDefaultAppSettingsMock(),
  fetchGeneralFeatureLocks: () => fetchGeneralFeatureLocksMock(),
  updateAppSettings: (payload: AppSettings) => updateAppSettingsMock(payload),
}));

vi.mock("../../components/ui/brandingRuntime", async () => {
  const actual = await vi.importActual<typeof import("../../components/ui/brandingRuntime")>(
    "../../components/ui/brandingRuntime"
  );
  return {
    ...actual,
    applyBranding: (primaryColor: string) => applyBrandingMock(primaryColor),
  };
});

vi.mock("../../utils/confirm", () => ({
  confirmAction: () => true,
}));

function buildSettings(): AppSettings {
  return {
    general: {
      manager_enabled: true,
      ceph_admin_enabled: false,
      browser_enabled: true,
      browser_root_enabled: true,
      browser_manager_enabled: false,
      browser_portal_enabled: true,
      browser_ceph_admin_enabled: true,
      allow_portal_manager_workspace: false,
      portal_enabled: false,
      billing_enabled: false,
      endpoint_status_enabled: false,
      bucket_migration_enabled: true,
      bucket_compare_enabled: true,
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

function unlockedFeatureLocks(): GeneralFeatureLocks {
  return {
    manager_enabled: { forced: false, value: null, source: null },
    ceph_admin_enabled: { forced: false, value: null, source: null },
    browser_enabled: { forced: false, value: null, source: null },
    portal_enabled: { forced: false, value: null, source: null },
    billing_enabled: { forced: false, value: null, source: null },
    endpoint_status_enabled: { forced: false, value: null, source: null },
  };
}

describe("GeneralSettingsPage branding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const initialSettings = buildSettings();
    fetchAppSettingsMock.mockResolvedValue(initialSettings);
    fetchGeneralFeatureLocksMock.mockResolvedValue(unlockedFeatureLocks());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
  });

  it("only shows color picker (no hex input)", async () => {
    render(<GeneralSettingsPage />);
    expect(await screen.findByLabelText("Primary color picker")).toBeInTheDocument();
    expect(screen.queryByLabelText("Primary color hex")).not.toBeInTheDocument();
  });

  it("saves branding color and applies it immediately", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    const picker = (await screen.findByLabelText("Primary color picker")) as HTMLInputElement;
    fireEvent.change(picker, { target: { value: "#0057b8" } });

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.branding.primary_color).toBe("#0057b8");
    expect(applyBrandingMock).toHaveBeenCalledWith("#0057b8");
  });

  it("shows custom endpoint warning only when option is enabled", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    expect(screen.queryByText(/custom endpoints are intended for trusted\/local environments/i)).not.toBeInTheDocument();

    await user.click(await screen.findByLabelText("Custom login endpoint"));
    expect(screen.getByText(/custom endpoints are intended for trusted\/local environments/i)).toBeInTheDocument();
  });

  it("does not render manager extra tools toggles", async () => {
    render(<GeneralSettingsPage />);

    await screen.findByLabelText("Primary color picker");
    expect(screen.queryByLabelText("Bucket migration tool")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bucket compare tool")).not.toBeInTheDocument();
  });
});
