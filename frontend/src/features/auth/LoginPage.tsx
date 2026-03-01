/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOidcProviders, login, loginWithKeys, startOidcLogin, type OidcProviderInfo } from "../../api/auth";
import { fetchGeneralSettings, fetchLoginSettings, type GeneralSettings, type LoginSettings } from "../../api/appSettings";
import { DEFAULT_GENERAL_SETTINGS, useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useLanguage } from "../../components/language";
import { prefetchWorkspaceBranch } from "../../utils/routePrefetch";
import { resolvePostLoginPath, type SessionUser } from "../../utils/workspaces";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setGeneralSettings } = useGeneralSettings();
  const { setLanguagePreference } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [mode, setMode] = useState<"password" | "keys">("password");
  const [error, setError] = useState<string | null>(null);
  const [oidcError, setOidcError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState<string | null>(null);
  const [oidcProviders, setOidcProviders] = useState<OidcProviderInfo[]>([]);
  const [loginSettings, setLoginSettings] = useState<LoginSettings | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [loginBrandingLogoFailed, setLoginBrandingLogoFailed] = useState(false);
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

  useEffect(() => {
    let isMounted = true;
    fetchOidcProviders()
      .then((providers) => {
        if (isMounted) {
          setOidcProviders(Array.isArray(providers) ? providers : []);
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
    const endpoints = Array.isArray(loginSettings.endpoints) ? loginSettings.endpoints : [];
    const defaultEndpoint = endpoints.find((endpoint) => endpoint.is_default);
    if (defaultEndpoint) {
      setSelectedEndpoint(defaultEndpoint.endpoint_url);
    }
  }, [loginSettings, selectedEndpoint, customEndpoint]);

  useEffect(() => {
    setLoginBrandingLogoFailed(false);
  }, [loginSettings?.login_logo_url]);

  const handlePasswordLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      localStorage.setItem("token", res.access_token);
      const sessionUser: SessionUser = { ...res.user, authType: "password" };
      localStorage.setItem("user", JSON.stringify(sessionUser));
      setLanguagePreference(res.user.ui_language ?? "auto");
      localStorage.removeItem("s3SessionEndpoint");
      const settings = await loadGeneralSettings();
      const destination = resolvePostLoginPath(sessionUser, settings);
      prefetchWorkspaceBranch(destination);
      navigate(destination, { replace: true });
    } catch (err) {
      console.error(err);
      setError("Invalid credentials or server unavailable");
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
      localStorage.setItem("token", res.access_token);
      if (endpointUrl) {
        localStorage.setItem("s3SessionEndpoint", endpointUrl);
      } else {
        localStorage.removeItem("s3SessionEndpoint");
      }
      const userPayload: SessionUser = {
        email: res.session.account_id ? `${res.session.account_id}@s3-session` : "s3-session",
        role: "ui_user",
        authType: "s3_session",
        actorType: res.session.actor_type,
        accountId: res.session.account_id ?? null,
        accountName: res.session.account_name ?? null,
        capabilities: res.session.capabilities,
      };
      localStorage.setItem("user", JSON.stringify(userPayload));
      setLanguagePreference("auto");
      const settings = await loadGeneralSettings();
      const destination = resolvePostLoginPath(userPayload, settings);
      prefetchWorkspaceBranch(destination);
      navigate(destination, { replace: true });
    } catch (err) {
      console.error(err);
      setError("Unable to authenticate with these access keys");
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = (next: "password" | "keys") => {
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

  const tabClasses = (value: "password" | "keys") =>
    `rounded-lg px-3 py-2 ui-body font-semibold transition ${
      mode === value
        ? "bg-white text-slate-900 shadow-sm ring-1 ring-primary-200"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    }`;

  const allowAccessKeys = loginSettings?.allow_login_access_keys ?? false;
  const allowEndpointList = Boolean(loginSettings?.allow_login_endpoint_list);
  const allowCustomEndpoint = Boolean(loginSettings?.allow_login_custom_endpoint);
  const endpointOptions = loginSettings?.endpoints ?? [];
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
  }, [allowAccessKeys, mode]);

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
                Sign in to continue.
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
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Need help?</p>
                  <p className="mt-1 ui-body text-slate-200">
                    Contact your platform admin if you can&apos;t sign in.
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

            {allowAccessKeys && (
              <div className="mb-6 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 p-1.5 ui-body font-semibold text-slate-600">
                <button type="button" className={tabClasses("password")} onClick={() => handleModeChange("password")}>
                  Email & password
                </button>
                <button type="button" className={tabClasses("keys")} onClick={() => handleModeChange("keys")}>
                  S3 access keys
                </button>
              </div>
            )}

            {mode === "password" || !allowAccessKeys ? (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="ui-body font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClasses}
                    placeholder="admin@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="ui-body font-medium text-slate-700">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClasses}
                    placeholder="••••••••"
                    required
                  />
                </div>
                {error && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700">
                    {error}
                  </p>
                )}
                <button type="submit" disabled={loading} className={buttonClasses}>
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleKeyLogin} className="space-y-4">
                <div>
                  <label className="ui-body font-medium text-slate-700">Access key</label>
                  <input
                    type="text"
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    className={inputClasses}
                    placeholder="ACCESS_KEY"
                    required
                  />
                </div>
                <div>
                  <label className="ui-body font-medium text-slate-700">Secret key</label>
                  <input
                    type="password"
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
                        <label className="ui-body font-medium text-slate-700">Endpoint</label>
                        <select
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
                        <label className="ui-body font-medium text-slate-700">Custom endpoint URL (optional)</label>
                        <input
                          type="url"
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
                      <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-caption text-rose-700">
                        {endpointError}
                      </p>
                    )}
                  </div>
                )}
                {error && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700">
                    {error}
                  </p>
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
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700">
                    {oidcError}
                  </p>
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
