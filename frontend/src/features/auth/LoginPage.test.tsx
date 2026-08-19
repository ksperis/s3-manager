import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../components/language";
import { ThemeProvider } from "../../components/theme";
import LoginPage from "./LoginPage";

const mocks = vi.hoisted(() => ({
  fetchLdapProviders: vi.fn(),
  fetchOidcProviders: vi.fn(),
  loginWithLdap: vi.fn(),
  fetchGeneralSettings: vi.fn(),
  fetchLoginSettings: vi.fn(),
  getWorkspaceAccess: vi.fn(),
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

vi.mock("../../api/executionContexts", () => ({
  getWorkspaceAccess: (...args: unknown[]) => mocks.getWorkspaceAccess(...args),
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
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  bucket_quota_management_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
};

function renderLoginPage(initialEntry = "/login") {
  return render(
    <LanguageProvider>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LoginPage />
        </MemoryRouter>
      </ThemeProvider>
    </LanguageProvider>
  );
}

describe("LoginPage LDAP", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/login");
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
    mocks.getWorkspaceAccess.mockResolvedValue({
      admin: { available: false, context_count: 0 },
      ceph_admin: { available: false, context_count: 0 },
      storage_ops: { available: false, context_count: 0 },
      manager: { available: false, context_count: 0 },
      browser: { available: false, context_count: 0 },
      portal: { available: false, context_count: 0 },
      default_workspace: null,
    });
    mocks.loginWithLdap.mockResolvedValue({
      status: "authenticated",
      user: {
        id: 42,
        email: "jane@example.test",
        role: "ui_none",
        is_admin: false,
        account_links: [],
        s3_user_details: [],
        s3_connection_details: [],
      },
    });
  });

  it("associates password sign-in labels and autocomplete hints", async () => {
    const { container } = renderLoginPage();

    const emailInput = await screen.findByLabelText("Email");
    const passwordInput = screen.getByLabelText("Password");

    expect(screen.getAllByText("BucketReef")).not.toHaveLength(0);
    expect(container.querySelectorAll('img[src="/brand/bucketreef-mark-256.png"]')).toHaveLength(2);
    expect(container.querySelector('img[src="/brand/bucketreef-mark-256.png"]')).toHaveClass("h-7", "w-7");
    expect(container.querySelector('img[src="/brand/bucketreef-mark-256.png"]')).toHaveAttribute("alt", "");
    expect(screen.getByRole("heading", { name: "S3-compatible object storage management" })).toBeInTheDocument();
    expect(emailInput).toHaveAttribute("autocomplete", "username");
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
  });

  it("keeps BucketReef visible when a secondary customer logo is configured", async () => {
    mocks.fetchLoginSettings.mockResolvedValueOnce({
      allow_login_access_keys: false,
      allow_login_endpoint_list: false,
      allow_login_custom_endpoint: false,
      default_endpoint_url: null,
      endpoints: [],
      login_logo_url: "https://cdn.example.test/customer-logo.png",
    });

    const { container } = renderLoginPage();

    expect(await screen.findByAltText("Company logo")).toHaveAttribute(
      "src",
      "https://cdn.example.test/customer-logo.png",
    );
    expect(screen.getAllByText("BucketReef")).not.toHaveLength(0);
    expect(container.querySelectorAll('img[src="/brand/bucketreef-mark-256.png"]')).toHaveLength(2);
  });

  it("gives the standalone MFA mark an accessible name", () => {
    window.history.replaceState({}, "", "/login?mfa=mfa_required");
    mocks.fetchOidcProviders.mockReturnValueOnce(new Promise(() => undefined));
    mocks.fetchLdapProviders.mockReturnValueOnce(new Promise(() => undefined));
    mocks.fetchLoginSettings.mockReturnValueOnce(new Promise(() => undefined));
    renderLoginPage();

    expect(screen.getByRole("img", { name: "BucketReef" })).toHaveAttribute(
      "src",
      "/brand/bucketreef-mark-256.png",
    );
  });

  it("shows directory login without persisting browser credentials", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(await screen.findByRole("button", { name: "Directory" }));
    await user.type(screen.getByLabelText("Username"), "jane");
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign in with directory" }));

    await waitFor(() => {
      expect(mocks.loginWithLdap).toHaveBeenCalledWith("corp", "jane", "secret-password");
      expect(mocks.getWorkspaceAccess).toHaveBeenCalledOnce();
    });
    expect(window.localStorage.getItem("token")).toBeNull();
    expect(window.localStorage.getItem("user")).toBeNull();
  });
});
