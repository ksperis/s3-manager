import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeneralSettingsProvider, useGeneralSettings } from "./GeneralSettingsContext";
import * as appSettingsApi from "../api/appSettings";

vi.mock("../api/appSettings", async () => {
  const actual = await vi.importActual<typeof import("../api/appSettings")>("../api/appSettings");
  return {
    ...actual,
    fetchGeneralSettings: vi.fn(),
  };
});

function Probe() {
  const { generalSettings, loading } = useGeneralSettings();
  return (
    <div>
      <span data-testid="migration">{String(generalSettings.bucket_migration_enabled)}</span>
      <span data-testid="compare">{String(generalSettings.bucket_compare_enabled)}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
}

describe("GeneralSettingsProvider fallbacks", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps bucket migration/compare flags disabled when no token is available", async () => {
    const fetchGeneralSettings = vi.mocked(appSettingsApi.fetchGeneralSettings);
    fetchGeneralSettings.mockResolvedValueOnce({
      manager_enabled: true,
      ceph_admin_enabled: true,
      storage_ops_enabled: true,
      browser_enabled: true,
      browser_root_enabled: true,
      browser_manager_enabled: true,
      browser_portal_enabled: true,
      browser_ceph_admin_enabled: true,
      allow_portal_manager_workspace: true,
      portal_enabled: true,
      billing_enabled: true,
      endpoint_status_enabled: true,
      quota_alerts_enabled: true,
      usage_history_enabled: true,
      bucket_migration_enabled: true,
      bucket_compare_enabled: true,
      manager_ceph_s3_user_keys_enabled: true,
      allow_ui_user_bucket_migration: true,
      allow_login_access_keys: true,
      allow_login_endpoint_list: true,
      allow_login_custom_endpoint: true,
      allow_user_private_connections: true,
    });

    render(
      <GeneralSettingsProvider>
        <Probe />
      </GeneralSettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("migration").textContent).toBe("false");
    expect(screen.getByTestId("compare").textContent).toBe("false");
    expect(fetchGeneralSettings).not.toHaveBeenCalled();
  });

  it("falls back to disabled migration/compare flags when settings fetch fails", async () => {
    const fetchGeneralSettings = vi.mocked(appSettingsApi.fetchGeneralSettings);
    window.localStorage.setItem("token", "token-value");
    fetchGeneralSettings.mockRejectedValueOnce(new Error("network down"));

    render(
      <GeneralSettingsProvider>
        <Probe />
      </GeneralSettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
      expect(fetchGeneralSettings).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId("migration").textContent).toBe("false");
    expect(screen.getByTestId("compare").textContent).toBe("false");
  });
});
