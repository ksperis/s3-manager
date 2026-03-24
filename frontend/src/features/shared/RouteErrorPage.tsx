/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect } from "react";
import { Link, useRouteError } from "react-router-dom";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { classifyRouteError, resolveRouteErrorHomePath } from "../../utils/routeError";

const retryButtonClass =
  "rounded-md bg-white px-4 py-2 ui-body font-medium text-slate-900 shadow-sm transition hover:bg-slate-100";
const secondaryButtonClass =
  "rounded-md border border-white/60 px-4 py-2 ui-body font-medium text-white transition hover:bg-white/10";

export default function RouteErrorPage() {
  const error = useRouteError();
  const { generalSettings } = useGeneralSettings();
  const errorKind = classifyRouteError(error);
  const homePath = resolveRouteErrorHomePath(generalSettings);
  const isBackendUnavailable = errorKind === "backend_unavailable";

  useEffect(() => {
    console.error("Unhandled route error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 text-center text-white">
      <h1 className="text-3xl font-semibold">
        {isBackendUnavailable ? "Backend temporarily unavailable" : "Unexpected application error"}
      </h1>
      <p className="mt-2 max-w-xl text-slate-200">
        {isBackendUnavailable
          ? "The backend is temporarily unreachable. Retry in a moment, or return to your workspace."
          : "Something went wrong while loading this page. Retry now, or return to your workspace."}
      </p>
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={() => window.location.reload()} className={retryButtonClass}>
          Retry
        </button>
        <Link to={homePath} className={secondaryButtonClass}>
          Home
        </Link>
      </div>
    </div>
  );
}
