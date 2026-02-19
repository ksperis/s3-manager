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
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-7rem] h-80 w-80 rounded-full bg-primary-500/20 blur-3xl" />
        <div className="absolute -right-24 bottom-[-7rem] h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/95 p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
            <CubeIcon className="h-5 w-5" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold text-slate-900">Signing you in</h1>
          {processing && <p className="ui-body text-slate-500">Please wait...</p>}
          {error && (
            <>
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700">{error}</p>
              <button
                type="button"
                className="mt-6 w-full rounded-xl bg-primary px-4 py-2.5 ui-body font-semibold text-white shadow-sm transition hover:bg-sky-500"
                onClick={() => navigate("/login", { replace: true })}
              >
                Back to login
              </button>
            </>
          )}
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
