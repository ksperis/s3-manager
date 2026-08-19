/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { completeOidcLogin } from "../../api/auth";
import { fetchGeneralSettings } from "../../api/appSettings";
import { getWorkspaceAccess } from "../../api/executionContexts";
import { DEFAULT_GENERAL_SETTINGS, useGeneralSettings } from "../../components/GeneralSettingsContext";
import BrandMark from "../../components/BrandMark";
import { useLanguage } from "../../components/language";
import { useTheme } from "../../components/theme";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { PRODUCT_NAME } from "../../constants/product";
import { useSession } from "../../auth/SessionProvider";
import { coordinateOidcCallback } from "./oidcCallbackCoordinator";
import { prefetchWorkspaceBranch } from "../../utils/routePrefetch";
import {
  resolvePostLoginPath,
  resolvePostLoginPathWithWorkspaceAccess,
  type SessionUser,
} from "../../utils/workspaces";

export default function OidcCallbackPage() {
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setGeneralSettings } = useGeneralSettings();
  const { setLanguagePreference } = useLanguage();
  const { setTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);
  const { acceptAuthentication } = useSession();

  useEffect(() => {
    let cancelled = false;
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!provider) {
      setProcessing(false);
      setError("Missing identity provider.");
      return;
    }
    const providerId = provider;
    if (!code || !state) {
      setProcessing(false);
      setError("Incomplete authentication response.");
      return;
    }
    const codeValue = code;
    const stateValue = state;

    async function finalizeLogin() {
      try {
        const res = await coordinateOidcCallback(
          providerId,
          codeValue,
          stateValue,
          completeOidcLogin,
        );
        if (cancelled) return;
        if (res.status === "mfa_required" || res.status === "mfa_enrollment_required") {
          navigate(`/login?mfa=${res.status}`, { replace: true });
          return;
        }
        if (res.status === "link_approval_required") {
          setError("This identity must be approved by a superadministrator before it can be linked.");
          setProcessing(false);
          return;
        }
        if (!res.user) throw new Error("OIDC session did not return a user");
        acceptAuthentication(res, "oidc");
        const sessionUser: SessionUser = { ...res.user, authType: "oidc" };
        setLanguagePreference(res.user.ui_language ?? "auto");
        if (res.user.ui_preferences?.theme === "light" || res.user.ui_preferences?.theme === "dark") {
          setTheme(res.user.ui_preferences.theme);
        }
        let settings = DEFAULT_GENERAL_SETTINGS;
        try {
          settings = await fetchGeneralSettings();
          setGeneralSettings(settings);
        } catch (loadError) {
          console.error(loadError);
        }
        let baseDestination = resolvePostLoginPath(sessionUser, settings);
        try {
          const workspaceAccess = await getWorkspaceAccess();
          baseDestination = resolvePostLoginPathWithWorkspaceAccess(
            sessionUser,
            settings,
            workspaceAccess
          );
        } catch (workspaceError) {
          console.error(workspaceError);
        }
        const destination = baseDestination;
        prefetchWorkspaceBranch(destination);
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
  }, [acceptAuthentication, navigate, provider, searchParams, setGeneralSettings, setLanguagePreference, setTheme]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-7rem] h-80 w-80 rounded-full bg-primary-500/20 blur-3xl" />
        <div className="auth-brand-glow-coral absolute -right-24 bottom-[-7rem] h-96 w-96 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/95 p-8 text-center shadow-2xl">
          <BrandMark alt={PRODUCT_NAME} className="mx-auto mb-5 h-16 w-16" />
          <h1 className="mb-2 text-2xl font-semibold text-slate-900">Signing you in</h1>
          {processing && <p className="ui-body text-slate-500">Please wait...</p>}
          {error && (
            <>
              <UiInlineMessage tone="error">{error}</UiInlineMessage>
              <button
                type="button"
                className="mt-6 w-full rounded-xl bg-primary px-4 py-2.5 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600"
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
