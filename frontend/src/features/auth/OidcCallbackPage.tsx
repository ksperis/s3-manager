/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { completeOidcLogin } from "../../api/auth";
import { fetchGeneralSettings } from "../../api/appSettings";
import { DEFAULT_GENERAL_SETTINGS, useGeneralSettings } from "../../components/GeneralSettingsContext";
import { resolvePostLoginPath, type SessionUser } from "../../utils/workspaces";

export default function OidcCallbackPage() {
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setGeneralSettings } = useGeneralSettings();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!provider) {
      setProcessing(false);
      setError("Missing identity provider.");
      return;
    }
    if (!code || !state) {
      setProcessing(false);
      setError("Incomplete authentication response.");
      return;
    }

    async function finalizeLogin() {
      try {
        const res = await completeOidcLogin(provider, code, state);
        if (cancelled) return;
        localStorage.setItem("token", res.access_token);
        const sessionUser: SessionUser = { ...res.user, authType: "oidc" };
        localStorage.setItem("user", JSON.stringify({ ...sessionUser, authProvider: provider }));
        let settings = DEFAULT_GENERAL_SETTINGS;
        try {
          settings = await fetchGeneralSettings();
          setGeneralSettings(settings);
        } catch (loadError) {
          console.error(loadError);
        }
        const baseDestination = resolvePostLoginPath(sessionUser, settings);
        const destination = baseDestination === "/unauthorized" ? baseDestination : res.redirect_path || baseDestination;
        navigate(destination, { replace: true });
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Unable to complete the sign-in. Please try again.");
          setProcessing(false);
        }
      }
    }

    finalizeLogin();
    return () => {
      cancelled = true;
    };
  }, [navigate, provider, searchParams, setGeneralSettings]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-xl">
        <h1 className="mb-2 ui-title font-semibold text-slate-800">Signing you in</h1>
        {processing && <p className="ui-body text-slate-500">Please wait…</p>}
        {error && (
          <>
            <p className="ui-body text-rose-600">{error}</p>
            <button
              type="button"
              className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-white shadow-sm transition hover:bg-sky-500"
              onClick={() => navigate("/login", { replace: true })}
            >
              Back to login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
