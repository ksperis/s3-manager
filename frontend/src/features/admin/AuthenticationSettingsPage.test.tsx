import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../api/appSettings";
import type {
  LdapProviderAdminItem,
  LdapProviderAdminPayload,
  OidcProviderAdminItem,
  OidcProviderAdminPayload,
} from "../../api/authSettings";
import AuthenticationSettingsPage from "./AuthenticationSettingsPage";

const setGeneralSettingsMock = vi.fn();
const fetchAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const fetchDefaultAppSettingsMock = vi.fn<() => Promise<AppSettings>>();
const updateAppSettingsMock = vi.fn<(payload: AppSettings) => Promise<AppSettings>>();
const fetchOidcAdminProvidersMock = vi.fn<() => Promise<OidcProviderAdminItem[]>>();
const createOidcAdminProviderMock = vi.fn<(payload: OidcProviderAdminPayload) => Promise<OidcProviderAdminItem>>();
const updateOidcAdminProviderMock = vi.fn<
  (providerId: string, payload: OidcProviderAdminPayload) => Promise<OidcProviderAdminItem>
>();
const deleteOidcAdminProviderMock = vi.fn<(providerId: string) => Promise<void>>();
const fetchLdapAdminProvidersMock = vi.fn<() => Promise<LdapProviderAdminItem[]>>();
const createLdapAdminProviderMock = vi.fn<(payload: LdapProviderAdminPayload) => Promise<LdapProviderAdminItem>>();
const updateLdapAdminProviderMock = vi.fn<
  (providerId: string, payload: LdapProviderAdminPayload) => Promise<LdapProviderAdminItem>
>();
const deleteLdapAdminProviderMock = vi.fn<(providerId: string) => Promise<void>>();

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    setGeneralSettings: setGeneralSettingsMock,
  }),
}));

vi.mock("../../api/appSettings", () => ({
  fetchAppSettings: () => fetchAppSettingsMock(),
  fetchDefaultAppSettings: () => fetchDefaultAppSettingsMock(),
  updateAppSettings: (payload: AppSettings) => updateAppSettingsMock(payload),
}));

vi.mock("../../api/authSettings", () => ({
  fetchOidcAdminProviders: () => fetchOidcAdminProvidersMock(),
  createOidcAdminProvider: (payload: OidcProviderAdminPayload) => createOidcAdminProviderMock(payload),
  updateOidcAdminProvider: (providerId: string, payload: OidcProviderAdminPayload) =>
    updateOidcAdminProviderMock(providerId, payload),
  deleteOidcAdminProvider: (providerId: string) => deleteOidcAdminProviderMock(providerId),
  fetchLdapAdminProviders: () => fetchLdapAdminProvidersMock(),
  createLdapAdminProvider: (payload: LdapProviderAdminPayload) => createLdapAdminProviderMock(payload),
  updateLdapAdminProvider: (providerId: string, payload: LdapProviderAdminPayload) =>
    updateLdapAdminProviderMock(providerId, payload),
  deleteLdapAdminProvider: (providerId: string) => deleteLdapAdminProviderMock(providerId),
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
      manager_ceph_s3_user_keys_enabled: false,
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

function buildOidcProvider(overrides: Partial<OidcProviderAdminItem> = {}): OidcProviderAdminItem {
  return {
    provider_id: "ui",
    display_name: "UI Provider",
    discovery_url: "https://issuer.example.test/.well-known/openid-configuration",
    client_id: "client-id",
    redirect_uri: "https://app.example.test/auth/callback",
    scopes: ["openid", "email", "profile"],
    prompt: null,
    enabled: true,
    icon_url: null,
    use_pkce: true,
    use_nonce: true,
    source: "ui",
    editable: true,
    field_locks: {},
    has_client_secret: false,
    ...overrides,
  };
}

function buildEnvOidcProvider(): OidcProviderAdminItem {
  const field_locks = Object.fromEntries(
    [
      "provider_id",
      "display_name",
      "discovery_url",
      "client_id",
      "redirect_uri",
      "scopes",
      "prompt",
      "enabled",
      "icon_url",
      "use_pkce",
      "use_nonce",
      "client_secret",
    ].map((field) => [field, { forced: true, source: `OIDC_PROVIDERS__GOOGLE__${field.toUpperCase()}` }])
  );
  return buildOidcProvider({
    provider_id: "google",
    display_name: "Google",
    source: "environment",
    editable: false,
    field_locks,
    has_client_secret: true,
  });
}

function buildLdapProvider(overrides: Partial<LdapProviderAdminItem> = {}): LdapProviderAdminItem {
  return {
    provider_id: "corp",
    display_name: "Corporate LDAP",
    url: "ldaps://ldap.example.test",
    bind_dn: "cn=s3-manager,ou=svc,dc=example,dc=test",
    user_base_dn: "ou=people,dc=example,dc=test",
    user_filter: "(uid={username})",
    email_attribute: "mail",
    name_attribute: "displayName",
    subject_attribute: null,
    start_tls: false,
    tls_verify: true,
    tls_ca_file: null,
    timeout_seconds: 5,
    enabled: true,
    allow_insecure: false,
    allow_email_linking: false,
    source: "ui",
    editable: true,
    field_locks: {},
    has_bind_password: false,
    ...overrides,
  };
}

function buildEnvLdapProvider(): LdapProviderAdminItem {
  const field_locks = Object.fromEntries(
    [
      "provider_id",
      "display_name",
      "url",
      "bind_dn",
      "bind_password",
      "user_base_dn",
      "user_filter",
      "email_attribute",
      "name_attribute",
      "subject_attribute",
      "start_tls",
      "tls_verify",
      "tls_ca_file",
      "timeout_seconds",
      "enabled",
      "allow_insecure",
      "allow_email_linking",
    ].map((field) => [field, { forced: true, source: `LDAP_PROVIDERS__CORP__${field.toUpperCase()}` }])
  );
  return buildLdapProvider({
    source: "environment",
    editable: false,
    field_locks,
    has_bind_password: true,
  });
}

function sectionByText(text: string): HTMLElement {
  const section = screen.getByText(text).closest("section");
  if (!section) {
    throw new Error(`Unable to find section for ${text}`);
  }
  return section;
}

function firstButton(name: string): HTMLElement {
  const buttons = screen.getAllByRole("button", { name });
  const button = buttons[0];
  if (!button) {
    throw new Error(`Unable to find button ${name}`);
  }
  return button;
}

describe("AuthenticationSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAppSettingsMock.mockResolvedValue(buildSettings());
    fetchDefaultAppSettingsMock.mockResolvedValue(buildSettings());
    updateAppSettingsMock.mockImplementation(async (payload: AppSettings) => payload);
    fetchOidcAdminProvidersMock.mockResolvedValue([]);
    fetchLdapAdminProvidersMock.mockResolvedValue([]);
    createOidcAdminProviderMock.mockImplementation(async (payload: OidcProviderAdminPayload) =>
      buildOidcProvider({
        provider_id: payload.provider_id,
        display_name: payload.display_name,
        has_client_secret: Boolean(payload.client_secret),
      })
    );
    updateOidcAdminProviderMock.mockImplementation(async (_providerId, payload: OidcProviderAdminPayload) =>
      buildOidcProvider({
        provider_id: payload.provider_id,
        display_name: payload.display_name,
        has_client_secret: Boolean(payload.client_secret),
      })
    );
    deleteOidcAdminProviderMock.mockResolvedValue();
    createLdapAdminProviderMock.mockImplementation(async (payload: LdapProviderAdminPayload) =>
      buildLdapProvider({
        provider_id: payload.provider_id,
        display_name: payload.display_name,
        has_bind_password: Boolean(payload.bind_password),
      })
    );
    updateLdapAdminProviderMock.mockImplementation(async (_providerId, payload: LdapProviderAdminPayload) =>
      buildLdapProvider({
        provider_id: payload.provider_id,
        display_name: payload.display_name,
        has_bind_password: Boolean(payload.bind_password),
      })
    );
    deleteLdapAdminProviderMock.mockResolvedValue();
  });

  it("renders the authentication toggles", async () => {
    render(<AuthenticationSettingsPage />);

    expect(await screen.findByRole("heading", { name: "Authentication settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Access-key login")).toBeInTheDocument();
    expect(screen.getByLabelText("Access-key endpoint list")).toBeInTheDocument();
    expect(screen.getByLabelText("Custom login endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("Private S3 connections for UI users")).toBeInTheDocument();
  });

  it("saves authentication changes and refreshes general settings context", async () => {
    const user = userEvent.setup();
    render(<AuthenticationSettingsPage />);

    await user.click(await screen.findByLabelText("Access-key login"));
    await user.click(screen.getByLabelText("Private S3 connections for UI users"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.allow_login_access_keys).toBe(true);
    expect(payload.general.allow_user_private_connections).toBe(true);
    expect(setGeneralSettingsMock).toHaveBeenLastCalledWith(payload.general);
  });

  it("shows the custom endpoint warning only when custom endpoint login is enabled", async () => {
    const user = userEvent.setup();
    render(<AuthenticationSettingsPage />);

    expect(screen.queryByText(/custom endpoints are restricted to public https targets/i)).not.toBeInTheDocument();

    await user.click(await screen.findByLabelText("Custom login endpoint"));
    expect(screen.getByText(/custom endpoints are restricted to public https targets/i)).toBeInTheDocument();
  });

  it("resets only authentication fields to defaults", async () => {
    const user = userEvent.setup();
    const initialSettings = buildSettings();
    initialSettings.general.manager_enabled = false;
    initialSettings.branding.primary_color = "#2563eb";
    const defaultSettings = buildSettings();
    defaultSettings.general.allow_login_access_keys = true;
    defaultSettings.general.allow_login_endpoint_list = true;
    defaultSettings.general.allow_login_custom_endpoint = true;
    defaultSettings.general.allow_user_private_connections = true;
    defaultSettings.general.manager_enabled = true;
    defaultSettings.branding.primary_color = "#dc2626";
    fetchAppSettingsMock.mockResolvedValueOnce(initialSettings);
    fetchDefaultAppSettingsMock.mockResolvedValueOnce(defaultSettings);

    render(<AuthenticationSettingsPage />);

    await screen.findByLabelText("Access-key login");
    await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => {
      expect(fetchDefaultAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateAppSettingsMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateAppSettingsMock.mock.calls[0][0] as AppSettings;
    expect(payload.general.allow_login_access_keys).toBe(true);
    expect(payload.general.allow_login_endpoint_list).toBe(true);
    expect(payload.general.allow_login_custom_endpoint).toBe(true);
    expect(payload.general.allow_user_private_connections).toBe(true);
    expect(payload.general.manager_enabled).toBe(false);
    expect(payload.branding.primary_color).toBe("#2563eb");
  });

  it("renders OIDC providers with source and status badges", async () => {
    fetchOidcAdminProvidersMock.mockResolvedValueOnce([
      buildEnvOidcProvider(),
      buildOidcProvider({ provider_id: "ui", display_name: "UI Provider" }),
    ]);

    render(<AuthenticationSettingsPage />);

    expect(await screen.findByText("OIDC PROVIDERS")).toBeInTheDocument();
    expect(screen.getAllByText("Google").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UI Provider").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Environment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("UI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enabled").length).toBeGreaterThanOrEqual(2);
  });

  it("shows environment providers as locked read-only fields", async () => {
    const user = userEvent.setup();
    fetchOidcAdminProvidersMock.mockResolvedValueOnce([buildEnvOidcProvider()]);

    render(<AuthenticationSettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "View OIDC provider google" }).length).toBeGreaterThan(0);
    });
    await user.click(firstButton("View OIDC provider google"));

    expect(await screen.findByText("View OIDC provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByLabelText("Client secret")).toBeDisabled();
    expect(screen.getByText("Forced by OIDC_PROVIDERS__GOOGLE__DISPLAY_NAME.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save OIDC provider" })).not.toBeInTheDocument();
  });

  it("creates an OIDC provider with a write-only client secret", async () => {
    const user = userEvent.setup();
    fetchOidcAdminProvidersMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      buildOidcProvider({ provider_id: "google", display_name: "Google", has_client_secret: true }),
    ]);

    render(<AuthenticationSettingsPage />);

    await screen.findByText("OIDC PROVIDERS");
    const oidcSection = sectionByText("OIDC PROVIDERS");
    await user.click(within(oidcSection).getByRole("button", { name: "Add OIDC provider" }));
    await user.type(within(oidcSection).getByLabelText("Provider ID"), "google");
    await user.type(within(oidcSection).getByLabelText("Display name"), "Google");
    await user.type(
      within(oidcSection).getByLabelText("Discovery URL"),
      "https://issuer.example.test/.well-known/openid-configuration"
    );
    await user.type(within(oidcSection).getByLabelText("Client ID"), "client-id");
    await user.type(within(oidcSection).getByLabelText("Redirect URI"), "https://app.example.test/auth/callback");
    await user.type(within(oidcSection).getByLabelText("Client secret"), "super-secret");
    await user.click(within(oidcSection).getByRole("button", { name: "Save OIDC provider" }));

    await waitFor(() => {
      expect(createOidcAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    const payload = createOidcAdminProviderMock.mock.calls[0][0];
    expect(payload.provider_id).toBe("google");
    expect(payload.client_secret).toBe("super-secret");
    expect(payload.scopes).toEqual(["openid", "email", "profile"]);
    expect(screen.queryByDisplayValue("super-secret")).not.toBeInTheDocument();
  });

  it("edits an OIDC provider while preserving a blank client secret", async () => {
    const user = userEvent.setup();
    const provider = buildOidcProvider({ has_client_secret: true });
    fetchOidcAdminProvidersMock.mockResolvedValueOnce([provider]).mockResolvedValueOnce([
      buildOidcProvider({ display_name: "Updated Provider", has_client_secret: true }),
    ]);

    render(<AuthenticationSettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Edit OIDC provider ui" }).length).toBeGreaterThan(0);
    });
    await user.click(firstButton("Edit OIDC provider ui"));
    const displayName = screen.getByLabelText("Display name");
    await user.clear(displayName);
    await user.type(displayName, "Updated Provider");
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("placeholder", "Stored secret is not displayed");
    await user.click(screen.getByRole("button", { name: "Save OIDC provider" }));

    await waitFor(() => {
      expect(updateOidcAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    expect(updateOidcAdminProviderMock.mock.calls[0][0]).toBe("ui");
    expect(updateOidcAdminProviderMock.mock.calls[0][1].display_name).toBe("Updated Provider");
    expect(updateOidcAdminProviderMock.mock.calls[0][1].client_secret).toBeNull();
    expect(updateOidcAdminProviderMock.mock.calls[0][1].clear_client_secret).toBe(false);
  });

  it("deletes only UI-managed OIDC providers", async () => {
    const user = userEvent.setup();
    fetchOidcAdminProvidersMock.mockResolvedValueOnce([
      buildEnvOidcProvider(),
      buildOidcProvider({ provider_id: "ui", display_name: "UI Provider" }),
    ]).mockResolvedValueOnce([]);

    render(<AuthenticationSettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Google").length).toBeGreaterThan(0);
    });
    const googleRow = screen.getAllByText("Google")[0].closest("tr") as HTMLElement;
    const uiProviderRow = screen.getAllByText("UI Provider")[0].closest("tr") as HTMLElement;
    expect(within(googleRow).queryByRole("button", { name: "Delete OIDC provider google" })).toBeNull();
    await user.click(within(uiProviderRow).getByRole("button", { name: "Delete OIDC provider ui" }));

    await waitFor(() => {
      expect(deleteOidcAdminProviderMock).toHaveBeenCalledWith("ui");
    });
  });

  it("renders LDAP providers with source and status badges", async () => {
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([
      buildEnvLdapProvider(),
      buildLdapProvider({ provider_id: "ui-ldap", display_name: "UI LDAP" }),
    ]);

    render(<AuthenticationSettingsPage />);

    expect(await screen.findByText("LDAP PROVIDERS")).toBeInTheDocument();
    const ldapSection = sectionByText("LDAP PROVIDERS");
    expect(within(ldapSection).getAllByText("Corporate LDAP").length).toBeGreaterThan(0);
    expect(within(ldapSection).getAllByText("UI LDAP").length).toBeGreaterThan(0);
    expect(within(ldapSection).getAllByText("Environment").length).toBeGreaterThan(0);
    expect(within(ldapSection).getAllByText("UI").length).toBeGreaterThan(0);
    expect(within(ldapSection).getAllByText("Enabled").length).toBeGreaterThanOrEqual(2);
  });

  it("shows environment LDAP providers as locked read-only fields", async () => {
    const user = userEvent.setup();
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([buildEnvLdapProvider()]);

    render(<AuthenticationSettingsPage />);

    await screen.findByText("LDAP PROVIDERS");
    const ldapSection = sectionByText("LDAP PROVIDERS");
    await user.click(within(ldapSection).getAllByRole("button", { name: "View LDAP provider corp" })[0]);

    expect(await within(ldapSection).findByText("View LDAP provider")).toBeInTheDocument();
    expect(within(ldapSection).getByLabelText("LDAP Display name")).toBeDisabled();
    expect(within(ldapSection).getByLabelText("LDAP Bind password")).toBeDisabled();
    expect(within(ldapSection).getByText("Forced by LDAP_PROVIDERS__CORP__URL.")).toBeInTheDocument();
    expect(within(ldapSection).queryByRole("button", { name: "Save LDAP provider" })).not.toBeInTheDocument();
  });

  it("creates an LDAP provider with a write-only bind password", async () => {
    const user = userEvent.setup();
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      buildLdapProvider({ provider_id: "corp", display_name: "Corporate LDAP", has_bind_password: true }),
    ]);

    render(<AuthenticationSettingsPage />);

    await screen.findByText("LDAP PROVIDERS");
    const ldapSection = sectionByText("LDAP PROVIDERS");
    await user.click(within(ldapSection).getByRole("button", { name: "Add LDAP provider" }));
    await user.type(within(ldapSection).getByLabelText("LDAP Provider ID"), "corp");
    await user.type(within(ldapSection).getByLabelText("LDAP Display name"), "Corporate LDAP");
    const urlInput = within(ldapSection).getByLabelText("LDAP URL");
    await user.clear(urlInput);
    await user.type(urlInput, "ldaps://ldap.example.test");
    await user.type(within(ldapSection).getByLabelText("LDAP Bind DN"), "cn=s3-manager,ou=svc,dc=example,dc=test");
    await user.type(within(ldapSection).getByLabelText("LDAP Bind password"), "ldap-secret");
    await user.type(within(ldapSection).getByLabelText("LDAP User base DN"), "ou=people,dc=example,dc=test");
    await user.click(within(ldapSection).getByRole("button", { name: "Save LDAP provider" }));

    await waitFor(() => {
      expect(createLdapAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    const payload = createLdapAdminProviderMock.mock.calls[0][0];
    expect(payload.provider_id).toBe("corp");
    expect(payload.bind_password).toBe("ldap-secret");
    expect(payload.url).toBe("ldaps://ldap.example.test");
    expect(screen.queryByDisplayValue("ldap-secret")).not.toBeInTheDocument();
  });

  it("edits an LDAP provider while preserving a blank bind password", async () => {
    const user = userEvent.setup();
    const provider = buildLdapProvider({ has_bind_password: true });
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([provider]).mockResolvedValueOnce([
      buildLdapProvider({ display_name: "Updated LDAP", has_bind_password: true }),
    ]);

    render(<AuthenticationSettingsPage />);

    await screen.findByText("LDAP PROVIDERS");
    const ldapSection = sectionByText("LDAP PROVIDERS");
    await user.click(within(ldapSection).getAllByRole("button", { name: "Edit LDAP provider corp" })[0]);
    const displayName = within(ldapSection).getByLabelText("LDAP Display name");
    await user.clear(displayName);
    await user.type(displayName, "Updated LDAP");
    expect(within(ldapSection).getByLabelText("LDAP Bind password")).toHaveAttribute(
      "placeholder",
      "Stored password is not displayed"
    );
    await user.click(within(ldapSection).getByRole("button", { name: "Save LDAP provider" }));

    await waitFor(() => {
      expect(updateLdapAdminProviderMock).toHaveBeenCalledTimes(1);
    });
    expect(updateLdapAdminProviderMock.mock.calls[0][0]).toBe("corp");
    expect(updateLdapAdminProviderMock.mock.calls[0][1].display_name).toBe("Updated LDAP");
    expect(updateLdapAdminProviderMock.mock.calls[0][1].bind_password).toBeNull();
  });

  it("deletes only UI-managed LDAP providers", async () => {
    const user = userEvent.setup();
    fetchLdapAdminProvidersMock.mockResolvedValueOnce([
      buildEnvLdapProvider(),
      buildLdapProvider({ provider_id: "ui-ldap", display_name: "UI LDAP" }),
    ]).mockResolvedValueOnce([]);

    render(<AuthenticationSettingsPage />);

    await screen.findByText("LDAP PROVIDERS");
    const ldapSection = sectionByText("LDAP PROVIDERS");
    expect(
      within(within(ldapSection).getAllByText("Corporate LDAP")[0].closest("tr") as HTMLElement).queryByRole("button", {
        name: "Delete LDAP provider corp",
      })
    ).toBeNull();
    await user.click(
      within(within(ldapSection).getAllByText("UI LDAP")[0].closest("tr") as HTMLElement).getByRole("button", {
        name: "Delete LDAP provider ui-ldap",
      })
    );

    await waitFor(() => {
      expect(deleteLdapAdminProviderMock).toHaveBeenCalledWith("ui-ldap");
    });
  });
});
