import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, GeneralFeatureLocks, QuotaNotificationSettings } from "../../api/appSettings";
import GeneralSettingsPage from "./GeneralSettingsPage";

const setGeneralSettingsMock = vi.fn();
const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchGeneralFeatureLocksMock = vi.fn<() => Promise<GeneralFeatureLocks>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();
const sendQuotaNotificationTestEmailMock = vi.fn<
  (payload: QuotaNotificationSettings) => Promise<{ status: string; recipient: string; sent_at: string }>
>();
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
  sendQuotaNotificationTestEmail: (payload: QuotaNotificationSettings) => sendQuotaNotificationTestEmailMock(payload),
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
      storage_ops_enabled: false,
      browser_enabled: true,
      browser_root_enabled: true,
      browser_manager_enabled: false,
      browser_ceph_admin_enabled: true,
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

function unlockedFeatureLocks(): GeneralFeatureLocks {
  return {
    manager_enabled: { forced: false, value: null, source: null },
    ceph_admin_enabled: { forced: false, value: null, source: null },
    storage_ops_enabled: { forced: false, value: null, source: null },
    browser_enabled: { forced: false, value: null, source: null },
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
    sendQuotaNotificationTestEmailMock.mockResolvedValue({
      status: "sent",
      recipient: "superadmin@example.com",
      sent_at: "2026-01-01T00:00:00",
    });
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

  it("sends a quota SMTP test email with current quota notification settings", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsPage />);

    await screen.findByLabelText("Primary color picker");
    await user.click(screen.getByRole("button", { name: /send test email/i }));

    await waitFor(() => {
      expect(sendQuotaNotificationTestEmailMock).toHaveBeenCalledTimes(1);
    });
    expect(sendQuotaNotificationTestEmailMock.mock.calls[0][0]).toEqual(buildSettings().quota_notifications);
    expect(await screen.findByText(/test email sent to superadmin@example.com/i)).toBeInTheDocument();
  });

  it("shows backend detail when initial settings load fails with detail", async () => {
    fetchAppSettingsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { detail: "Forbidden by policy" } },
      message: "Request failed with status code 403",
    });

    render(<GeneralSettingsPage />);

    expect(await screen.findByText("Forbidden by policy")).toBeInTheDocument();
  });

  it("falls back to error.message when initial settings load fails without detail", async () => {
    fetchAppSettingsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: {} },
      message: "Network Error",
    });

    render(<GeneralSettingsPage />);

    expect(await screen.findByText("Network Error")).toBeInTheDocument();
  });
});
