/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOidcProviders, login, loginWithKeys, startOidcLogin, type OidcProviderInfo } from "../../api/auth";
import { fetchLoginSettings, type LoginSettings } from "../../api/appSettings";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh: refreshGeneralSettings } = useGeneralSettings();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [seedPrefillApplied, setSeedPrefillApplied] = useState(false);
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
  const resolveDestination = (
    role?: string | null,
    accountLinks?: { account_role?: string | null; account_admin?: boolean | null }[] | null
  ) => {
    if (role === "ui_admin") return "/admin";
    if (role === "ui_user") {
      const links = accountLinks ?? [];
      const hasPortalAccess = links.some(
        (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
      );
      const hasAccountAdmin = links.some((link) => link.account_admin);
      if (hasPortalAccess && !hasAccountAdmin) return "/portal";
      return "/manager";
    }
    return "/unauthorized";
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
    if (!loginSettings || seedPrefillApplied) return;
    if (loginSettings.seed_login_prefill && !email && !password) {
      setEmail(loginSettings.seed_login_email ?? "");
      setPassword(loginSettings.seed_login_password ?? "");
    }
    setSeedPrefillApplied(true);
  }, [email, loginSettings, password, seedPrefillApplied]);

  const handlePasswordLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      localStorage.setItem("token", res.access_token);
      localStorage.setItem("user", JSON.stringify({ ...res.user, authType: "password" }));
      localStorage.removeItem("s3SessionEndpoint");
      refreshGeneralSettings();
      const destination = resolveDestination(res.user.role, res.user.account_links ?? null);
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
      const userPayload = {
        email: res.session.account_id ? `${res.session.account_id}@s3-session` : "s3-session",
        role: "ui_user",
        authType: "rgw_session",
        actorType: res.session.actor_type,
        accountId: res.session.account_id ?? null,
        accountName: res.session.account_name ?? null,
        capabilities: res.session.capabilities,
      };
      localStorage.setItem("user", JSON.stringify(userPayload));
      refreshGeneralSettings();
      navigate("/manager", { replace: true });
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
    `rounded-full px-4 py-2 ui-body font-semibold transition ${
      mode === value
        ? "bg-white text-slate-900 shadow-sm"
        : "text-slate-500 hover:text-slate-800"
    }`;

  const allowAccessKeys = loginSettings?.allow_login_access_keys ?? true;
  const allowEndpointList = Boolean(loginSettings?.allow_login_endpoint_list);
  const allowCustomEndpoint = Boolean(loginSettings?.allow_login_custom_endpoint);
  const endpointOptions = loginSettings?.endpoints ?? [];

  useEffect(() => {
    if (!allowAccessKeys && mode === "keys") {
      setMode("password");
    }
  }, [allowAccessKeys, mode]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl">
        <h1 className="mb-4 ui-title font-semibold text-slate-800">Sign in</h1>
        <p className="mb-6 ui-body text-slate-500">s3-manager admin portal</p>
        {allowAccessKeys && (
          <div className="mb-6 flex rounded-full bg-slate-100 p-1 ui-body font-semibold text-slate-600">
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
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="ui-body text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-50"
            >
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
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
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
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="https://s3.example.com"
                    />
                    {allowEndpointList && (
                      <p className="mt-1 ui-caption text-slate-500">Custom endpoint overrides the selection above.</p>
                    )}
                  </div>
                )}
                {endpointError && <p className="ui-caption text-rose-600">{endpointError}</p>}
              </div>
            )}
            {error && <p className="ui-body text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-50"
            >
              {loading ? "Connecting..." : "Connect with keys"}
            </button>
          </form>
        )}

        {oidcProviders.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              <span>Ou</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            {oidcProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => startOidcFlow(provider.id)}
                disabled={Boolean(oidcLoading)}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 ui-body font-medium text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {oidcLoading === provider.id ? "Redirection..." : `Continuer avec ${provider.display_name}`}
              </button>
            ))}
            {oidcError && <p className="ui-body text-rose-600">{oidcError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
