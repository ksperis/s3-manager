import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../components/language";
import LoginPage from "./LoginPage";

const mocks = vi.hoisted(() => ({
  fetchLdapProviders: vi.fn(),
  fetchOidcProviders: vi.fn(),
  loginWithLdap: vi.fn(),
  fetchGeneralSettings: vi.fn(),
  fetchLoginSettings: vi.fn(),
}));

vi.mock("../../api/auth", () => ({
  fetchLdapProviders: (...args: unknown[]) => mocks.fetchLdapProviders(...args),
  fetchOidcProviders: (...args: unknown[]) => mocks.fetchOidcProviders(...args),
  login: vi.fn(),
  loginWithKeys: vi.fn(),
  loginWithLdap: (...args: unknown[]) => mocks.loginWithLdap(...args),
  startOidcLogin: vi.fn(),
}));

vi.mock("../../api/appSettings", () => ({
  fetchGeneralSettings: (...args: unknown[]) => mocks.fetchGeneralSettings(...args),
  fetchLoginSettings: (...args: unknown[]) => mocks.fetchLoginSettings(...args),
}));

vi.mock("../../utils/routePrefetch", () => ({
  prefetchWorkspaceBranch: vi.fn(),
}));

const generalSettings = {
  manager_enabled: true,
  ceph_admin_enabled: false,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: false,
  browser_ceph_admin_enabled: false,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
  allow_user_private_connections: false,
};

function renderLoginPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </LanguageProvider>
  );
}

describe("LoginPage LDAP", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.fetchOidcProviders.mockResolvedValue([]);
    mocks.fetchLdapProviders.mockResolvedValue([{ id: "corp", display_name: "Corporate LDAP" }]);
    mocks.fetchLoginSettings.mockResolvedValue({
      allow_login_access_keys: false,
      allow_login_endpoint_list: false,
      allow_login_custom_endpoint: false,
      default_endpoint_url: null,
      endpoints: [],
      login_logo_url: null,
    });
    mocks.fetchGeneralSettings.mockResolvedValue(generalSettings);
    mocks.loginWithLdap.mockResolvedValue({
      access_token: "ldap-access-token",
      token_type: "bearer",
      user: {
        id: 42,
        email: "jane@example.test",
        role: "ui_none",
        is_admin: false,
        accounts: [],
        account_links: [],
        s3_users: [],
        s3_user_details: [],
        s3_connections: [],
        s3_connection_details: [],
        auth_provider: "ldap:corp",
      },
    });
  });

  it("shows directory login when LDAP providers exist and stores ldap auth type", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(await screen.findByRole("button", { name: "Directory" }));
    await user.type(screen.getByLabelText("Username"), "jane");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in with directory" }));

    await waitFor(() => {
      expect(mocks.loginWithLdap).toHaveBeenCalledWith("corp", "jane", "secret-password");
    });
    expect(window.localStorage.getItem("token")).toBe("ldap-access-token");
    expect(JSON.parse(window.localStorage.getItem("user") || "{}")).toMatchObject({
      email: "jane@example.test",
      authType: "ldap",
      auth_provider: "ldap:corp",
    });
  });
});
