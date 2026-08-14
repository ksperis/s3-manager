/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchLdapProviders,
  fetchOidcProviders,
  beginWebAuthnAuthentication,
  beginWebAuthnRegistration,
  finishWebAuthnAuthentication,
  finishWebAuthnRegistration,
  login,
  loginWithKeys,
  loginWithLdap,
  startOidcLogin,
  verifyRecoveryCode,
  type AuthenticationResponse,
  type LDAPProviderInfo,
  type OidcProviderInfo,
} from "../../api/auth";
import { fetchGeneralSettings, fetchLoginSettings, type GeneralSettings, type LoginSettings } from "../../api/appSettings";
import { getWorkspaceAccess } from "../../api/executionContexts";
import { DEFAULT_GENERAL_SETTINGS, useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useLanguage } from "../../components/language";
import { useTheme } from "../../components/theme";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { CLIENT_STORAGE_KEYS, removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { useSession } from "../../auth/SessionProvider";
import { authenticatePasskey, createPasskey } from "../../auth/webauthn";
import { prefetchWorkspaceBranch } from "../../utils/routePrefetch";
import {
  resolvePostLoginPath,
  resolvePostLoginPathWithWorkspaceAccess,
  type SessionUser,
} from "../../utils/workspaces";

type LoginMode = "password" | "keys" | "ldap";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setGeneralSettings } = useGeneralSettings();
  const { setLanguagePreference } = useLanguage();
  const { setTheme } = useTheme();
  const { acceptAuthentication } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ldapUsername, setLdapUsername] = useState("");
  const [ldapPassword, setLdapPassword] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [mode, setMode] = useState<LoginMode>("password");
  const [error, setError] = useState<string | null>(null);
  const [oidcError, setOidcError] = useState<string | null>(null);
  const [ldapError, setLdapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState<string | null>(null);
  const [oidcProviders, setOidcProviders] = useState<OidcProviderInfo[]>([]);
  const [ldapProviders, setLdapProviders] = useState<LDAPProviderInfo[]>([]);
  const [selectedLdapProvider, setSelectedLdapProvider] = useState("");
  const [loginSettings, setLoginSettings] = useState<LoginSettings | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [loginBrandingLogoFailed, setLoginBrandingLogoFailed] = useState(false);
  const [mfaStage, setMfaStage] = useState<"mfa_required" | "mfa_enrollment_required" | null>(() => {
    if (typeof window === "undefined") return null;
    const value = new URLSearchParams(window.location.search).get("mfa");
    return value === "mfa_required" || value === "mfa_enrollment_required" ? value : null;
  });
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pendingEnrollment, setPendingEnrollment] = useState<AuthenticationResponse | null>(null);
  const loadGeneralSettings = async (): Promise<GeneralSettings> => {
    try {
      const settings = await fetchGeneralSettings();
      setGeneralSettings(settings);
      return settings;
    } catch (err) {
      console.error(err);
      return DEFAULT_GENERAL_SETTINGS;
    }
  };

  const resolveInteractiveDestination = async (
    sessionUser: SessionUser,
    settings: GeneralSettings
  ): Promise<string> => {
    try {
      const workspaceAccess = await getWorkspaceAccess();
      return resolvePostLoginPathWithWorkspaceAccess(sessionUser, settings, workspaceAccess);
    } catch (workspaceError) {
      console.error(workspaceError);
      return resolvePostLoginPath(sessionUser, settings);
    }
  };

  const finishLogin = async (res: AuthenticationResponse, authType: SessionUser["authType"]) => {
    if (res.status === "mfa_required" || res.status === "mfa_enrollment_required") {
      setMfaStage(res.status);
      return;
    }
    if (res.status !== "authenticated") {
      throw new Error("Authentication requires administrator approval");
    }
    acceptAuthentication(res, authType);
    const sessionUser: SessionUser = res.user
      ? { ...res.user, authType }
      : {
          email: res.session?.account_id ? `${res.session.account_id}@s3-session` : "s3-session",
          role: "ui_user",
          authType: "s3_session",
          actorType: res.session?.actor_type,
          accountId: res.session?.account_id ?? null,
          accountName: res.session?.account_name ?? null,
          capabilities: res.session?.capabilities,
        };
    if (res.user) {
      setLanguagePreference(res.user.ui_language ?? "auto");
      if (res.user.ui_preferences?.theme === "light" || res.user.ui_preferences?.theme === "dark") {
        setTheme(res.user.ui_preferences.theme);
      }
    } else {
      setLanguagePreference("auto");
    }
    const appSettings = await loadGeneralSettings();
    const destination = await resolveInteractiveDestination(sessionUser, appSettings);
    prefetchWorkspaceBranch(destination);
    navigate(destination, { replace: true });
  };

  useEffect(() => {
    let isMounted = true;
    fetchOidcProviders()
      .then((providers) => {
        if (isMounted) {
          setOidcProviders(providers);
        }
      })
      .catch(() => {
        if (isMounted) {
          setOidcError("Unable to load identity providers");
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchLdapProviders()
      .then((providers) => {
        if (isMounted) {
          setLdapProviders(providers);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLdapError("Unable to load directory providers");
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    setEndpointLoading(true);
    fetchLoginSettings()
      .then((settings) => {
        if (isMounted) {
          setLoginSettings(settings);
        }
      })
      .catch(() => {
        if (isMounted) {
          setEndpointError("Unable to load endpoint options");
        }
      })
      .finally(() => {
        if (isMounted) {
          setEndpointLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!loginSettings) return;
    if (selectedEndpoint || customEndpoint) return;
    const defaultEndpoint = loginSettings.endpoints.find((endpoint) => endpoint.is_default);
    if (defaultEndpoint) {
      setSelectedEndpoint(defaultEndpoint.endpoint_url);
    }
  }, [loginSettings, selectedEndpoint, customEndpoint]);

  useEffect(() => {
    if (selectedLdapProvider || ldapProviders.length === 0) return;
    setSelectedLdapProvider(ldapProviders[0].id);
  }, [ldapProviders, selectedLdapProvider]);

  useEffect(() => {
    setLoginBrandingLogoFailed(false);
  }, [loginSettings?.login_logo_url]);

  const handlePasswordLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      await finishLogin(res, "password");
    } catch (err) {
      console.error(err);
      setError("Invalid credentials or server unavailable");
    } finally {
      setLoading(false);
    }
  };

  const handleLdapLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLdapError(null);
    const providerId = selectedLdapProvider || ldapProviders[0]?.id || "";
    if (!providerId) {
      setError("No directory provider is available");
      return;
    }
    setLoading(true);
    try {
      const res = await loginWithLdap(providerId, ldapUsername.trim(), ldapPassword);
      await finishLogin(res, "ldap");
    } catch (err) {
      console.error(err);
      setError("Unable to authenticate with this directory account");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const normalizedCustom = customEndpoint.trim().replace(/\/+$/, "");
      const normalizedSelected = selectedEndpoint.trim().replace(/\/+$/, "");
      const normalizedDefault =
        loginSettings?.default_endpoint_url?.trim().replace(/\/+$/, "") ?? "";
      const shouldSendEndpoint = allowEndpointList || allowCustomEndpoint;
      const endpointUrl = shouldSendEndpoint
        ? normalizedCustom || normalizedSelected || normalizedDefault || undefined
        : undefined;
      const res = await loginWithKeys(accessKey.trim(), secretKey.trim(), endpointUrl);
      if (endpointUrl) {
        writeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint, endpointUrl);
      } else {
        removeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
      }
      await finishLogin(res, "s3_session");
    } catch (err) {
      console.error(err);
      setError("Unable to authenticate with these access keys");
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = (next: LoginMode) => {
    setMode(next);
    setError(null);
  };

  const startOidcFlow = async (providerId: string) => {
    setOidcError(null);
    setOidcLoading(providerId);
    try {
      const { authorization_url } = await startOidcLogin(providerId);
      window.location.href = authorization_url;
    } catch (err) {
      console.error(err);
      setOidcError("Unable to start external authentication");
      setOidcLoading(null);
    }
  };

  const completePasskey = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = mfaStage === "mfa_enrollment_required"
        ? await (async () => {
            const options = await beginWebAuthnRegistration();
            const credential = await createPasskey(options);
            return finishWebAuthnRegistration(credential);
          })()
        : await (async () => {
            const options = await beginWebAuthnAuthentication();
            const credential = await authenticatePasskey(options);
            return finishWebAuthnAuthentication(credential);
          })();
      if (res.recovery_codes?.length) {
        setRecoveryCodes(res.recovery_codes);
        setPendingEnrollment(res);
        return;
      }
      await finishLogin(res, "password");
    } catch (err) {
      console.error(err);
      setError("Passkey verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const completeRecovery = async () => {
    setError(null);
    setLoading(true);
    try {
      await finishLogin(await verifyRecoveryCode(recoveryCode), "password");
    } catch (err) {
      console.error(err);
      setError("The recovery code is invalid or has already been used.");
    } finally {
      setLoading(false);
    }
  };

  const tabClasses = (value: LoginMode) =>
    `min-w-0 rounded-lg px-2 py-2 ui-body font-semibold leading-tight transition ${
      mode === value
        ? "bg-white text-slate-900 shadow-sm ring-1 ring-primary-200"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    }`;

  const allowAccessKeys = loginSettings?.allow_login_access_keys ?? false;
  const allowEndpointList = Boolean(loginSettings?.allow_login_endpoint_list);
  const allowCustomEndpoint = Boolean(loginSettings?.allow_login_custom_endpoint);
  const endpointOptions = loginSettings?.endpoints ?? [];
  const hasLdapProviders = ldapProviders.length > 0;
  const loginModes: Array<{ value: LoginMode; label: string }> = [
    { value: "password", label: "Email & password" },
    ...(hasLdapProviders ? [{ value: "ldap" as const, label: "Directory" }] : []),
    ...(allowAccessKeys ? [{ value: "keys" as const, label: "S3 access keys" }] : []),
  ];
  const loginBrandingLogoUrl = loginSettings?.login_logo_url ?? null;
  const shouldShowLeftLogo = Boolean(loginBrandingLogoUrl && !loginBrandingLogoFailed);
  const inputClasses =
    "mt-1 w-full rounded-xl border border-slate-200/90 bg-white/90 px-3 py-2.5 ui-body text-slate-800 shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
  const buttonClasses =
    "w-full rounded-xl bg-primary px-4 py-2.5 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60";
  const providerButtonClasses =
    "flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-white px-4 py-2.5 ui-body font-medium text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50";

  useEffect(() => {
    if (!allowAccessKeys && mode === "keys") {
      setMode("password");
    }
    if (!hasLdapProviders && mode === "ldap") {
      setMode("password");
    }
  }, [allowAccessKeys, hasLdapProviders, mode]);

  if (mfaStage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 text-slate-900 shadow-2xl">
          <h1 className="text-2xl font-semibold">
            {mfaStage === "mfa_enrollment_required" ? "Create your administrator passkey" : "Verify your passkey"}
          </h1>
          <p className="mt-3 ui-body text-slate-600">
            Administrator access requires user verification with a passkey bound to this site.
          </p>
          {error && <div className="mt-4"><UiInlineMessage tone="error">{error}</UiInlineMessage></div>}
          {!pendingEnrollment && (
            <button type="button" className={`${buttonClasses} mt-6`} disabled={loading} onClick={() => void completePasskey()}>
              {mfaStage === "mfa_enrollment_required" ? "Create passkey" : "Use passkey"}
            </button>
          )}
          {mfaStage === "mfa_required" && !pendingEnrollment && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <label className="ui-body font-medium" htmlFor="recovery-code">Recovery code</label>
              <input
                id="recovery-code"
                className={inputClasses}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                autoComplete="one-time-code"
              />
              <button type="button" className="mt-3 ui-body font-semibold text-primary" disabled={loading || !recoveryCode.trim()} onClick={() => void completeRecovery()}>
                Use recovery code
              </button>
            </div>
          )}
          {recoveryCodes.length > 0 && (
            <div className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-950">
              <p className="font-semibold">Save these one-time recovery codes now.</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
                {recoveryCodes.map((code) => <li key={code}>{code}</li>)}
              </ul>
              <button
                type="button"
                className={`${buttonClasses} mt-5`}
                disabled={loading || !pendingEnrollment}
                onClick={() => pendingEnrollment && void finishLogin(pendingEnrollment, "password")}
              >
                I saved these recovery codes
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-7rem] h-80 w-80 rounded-full bg-primary-500/20 blur-3xl" />
        <div className="absolute -right-24 bottom-[-7rem] h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_40%)]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6">
        <div className="grid w-full items-stretch gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden rounded-3xl border border-slate-700/50 bg-slate-900/55 p-8 shadow-2xl backdrop-blur lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-800/70 px-3 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-300">
                <CubeIcon className="h-3.5 w-3.5 text-primary-300" />
                S3 Manager
              </div>
              <h1 className="mt-6 text-3xl font-semibold leading-tight text-white">
                S3 Management
                <br />
                Console
              </h1>
              <p className="mt-3 max-w-md ui-body text-slate-300">
                Sign in to reach the workspace that matches your role and execution context.
              </p>
            </div>
            {shouldShowLeftLogo ? (
              <div className="flex h-full items-end">
                <div className="w-full rounded-xl border border-slate-700/70 bg-slate-900/70 px-4 py-5">
                  <img
                    src={loginBrandingLogoUrl ?? ""}
                    alt="Company logo"
                    className="mx-auto max-h-28 w-auto object-contain"
                    onError={() => setLoginBrandingLogoFailed(true)}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-4 py-3">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">After sign-in</p>
                  <p className="mt-1 ui-body text-slate-200">
                    Password sign-in opens your assigned UI workspaces. Access keys create an S3 session when that mode is enabled.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-4 py-3">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Need help?</p>
                  <p className="mt-1 ui-body text-slate-200">
                    Contact your platform admin if you don&apos;t know which sign-in method or endpoint to use.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-4 py-3">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Security note</p>
                  <p className="mt-1 ui-body text-slate-200">
                    Never share your password, secret key, or session token.
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-white/70 bg-white/95 p-6 shadow-2xl sm:p-8">
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
                <CubeIcon className="h-3.5 w-3.5 text-primary-600" />
                S3 Manager
              </div>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">Sign in</h2>
              <p className="mt-1 ui-body text-slate-500">Use your account credentials.</p>
            </div>

            {loginModes.length > 1 && (
              <div
                className="mb-6 grid gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 p-1.5 ui-body font-semibold text-slate-600"
                style={{ gridTemplateColumns: `repeat(${loginModes.length}, minmax(0, 1fr))` }}
              >
                {loginModes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={tabClasses(item.value)}
                    onClick={() => handleModeChange(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {mode === "ldap" && hasLdapProviders ? (
              <form onSubmit={handleLdapLogin} className="space-y-4">
                {ldapProviders.length > 1 && (
                  <div>
                    <label htmlFor="ldap-provider" className="ui-body font-medium text-slate-700">
                      Directory
                    </label>
                    <select
                      id="ldap-provider"
                      value={selectedLdapProvider || ldapProviders[0]?.id || ""}
                      onChange={(e) => setSelectedLdapProvider(e.target.value)}
                      className={inputClasses}
                      required
                    >
                      {ldapProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.display_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor="ldap-username" className="ui-body font-medium text-slate-700">
                    Username
                  </label>
                  <input
                    id="ldap-username"
                    type="text"
                    autoComplete="username"
                    value={ldapUsername}
                    onChange={(e) => setLdapUsername(e.target.value)}
                    className={inputClasses}
                    placeholder="jane.doe or jane@example.com"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="ldap-password" className="ui-body font-medium text-slate-700">
                    Password
                  </label>
                  <input
                    id="ldap-password"
                    type="password"
                    autoComplete="current-password"
                    value={ldapPassword}
                    onChange={(e) => setLdapPassword(e.target.value)}
                    className={inputClasses}
                    placeholder="••••••••"
                    required
                  />
                </div>
                {(error || ldapError) && (
                  <UiInlineMessage tone="error">{error || ldapError}</UiInlineMessage>
                )}
                <button type="submit" disabled={loading} className={buttonClasses}>
                  {loading ? "Signing in..." : "Sign in with directory"}
                </button>
              </form>
            ) : mode === "password" || !allowAccessKeys ? (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="ui-body font-medium text-slate-700">Email</label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClasses}
                    placeholder="admin@example.com"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="login-password" className="ui-body font-medium text-slate-700">Password</label>
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClasses}
                    placeholder="••••••••"
                    required
                  />
                </div>
                {error && (
                  <UiInlineMessage tone="error">{error}</UiInlineMessage>
                )}
                <button type="submit" disabled={loading} className={buttonClasses}>
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleKeyLogin} className="space-y-4">
                <div>
                  <label htmlFor="login-access-key" className="ui-body font-medium text-slate-700">Access key</label>
                  <input
                    id="login-access-key"
                    type="text"
                    autoComplete="username"
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    className={inputClasses}
                    placeholder="ACCESS_KEY"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="login-secret-key" className="ui-body font-medium text-slate-700">Secret key</label>
                  <input
                    id="login-secret-key"
                    type="password"
                    autoComplete="current-password"
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    className={inputClasses}
                    placeholder="••••••••"
                    required
                  />
                </div>
                {(allowEndpointList || allowCustomEndpoint) && (
                  <div className="space-y-3">
                    {allowEndpointList && (
                      <div>
                        <label htmlFor="login-endpoint" className="ui-body font-medium text-slate-700">Endpoint</label>
                        <select
                          id="login-endpoint"
                          value={selectedEndpoint}
                          onChange={(e) => setSelectedEndpoint(e.target.value)}
                          disabled={endpointLoading}
                          className={`${inputClasses} disabled:opacity-60`}
                        >
                          {endpointLoading && <option value="">Loading endpoints...</option>}
                          {!endpointLoading && <option value="">Select endpoint</option>}
                          {!endpointLoading &&
                            endpointOptions.map((endpoint) => (
                              <option key={endpoint.id} value={endpoint.endpoint_url} title={endpoint.endpoint_url}>
                                {endpoint.is_default ? `${endpoint.name} (default)` : endpoint.name}
                              </option>
                            ))}
                        </select>
                        {!endpointLoading && endpointOptions.length === 0 && (
                          <p className="mt-1 ui-caption text-slate-500">
                            {allowCustomEndpoint
                              ? "No endpoint configured. Use a custom endpoint URL."
                              : "No endpoint configured. Ask an admin to add one."}
                          </p>
                        )}
                      </div>
                    )}
                    {allowCustomEndpoint && (
                      <div>
                        <label htmlFor="login-custom-endpoint" className="ui-body font-medium text-slate-700">Custom endpoint URL (optional)</label>
                        <input
                          id="login-custom-endpoint"
                          type="url"
                          autoComplete="url"
                          value={customEndpoint}
                          onChange={(e) => setCustomEndpoint(e.target.value)}
                          className={inputClasses}
                          placeholder="https://s3.example.com"
                        />
                        {allowEndpointList && (
                          <p className="mt-1 ui-caption text-slate-500">Custom endpoint overrides the selection above.</p>
                        )}
                      </div>
                    )}
                    {endpointError && (
                      <UiInlineMessage tone="error">{endpointError}</UiInlineMessage>
                    )}
                  </div>
                )}
                {error && (
                  <UiInlineMessage tone="error">{error}</UiInlineMessage>
                )}
                <button type="submit" disabled={loading} className={buttonClasses}>
                  {loading ? "Connecting..." : "Connect with keys"}
                </button>
              </form>
            )}

            {oidcProviders.length > 0 && (
              <div className="mt-6 space-y-2">
                <div className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>Or</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                {oidcProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => startOidcFlow(provider.id)}
                    disabled={Boolean(oidcLoading)}
                    className={providerButtonClasses}
                  >
                    {oidcLoading === provider.id ? "Redirecting..." : `Continue with ${provider.display_name}`}
                  </button>
                ))}
                {oidcError && (
                  <UiInlineMessage tone="error">{oidcError}</UiInlineMessage>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CubeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m12 12 8-4.5M12 12 4 7.5M12 12v9" />
    </svg>
  );
}
