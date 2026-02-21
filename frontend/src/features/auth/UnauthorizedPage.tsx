/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { readStoredUser, resolvePostLoginPath } from "../../utils/workspaces";

export default function UnauthorizedPage() {
  const { generalSettings } = useGeneralSettings();
  const homePath = useMemo(() => resolvePostLoginPath(readStoredUser(), generalSettings), [generalSettings]);
  const canReturnToWorkspace = homePath !== "/login" && homePath !== "/unauthorized";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 text-center text-white">
      <h1 className="text-3xl font-semibold">Unauthorized access</h1>
      <p className="mt-2 max-w-xl text-slate-200">
        Your account does not have the required permissions yet. Please contact an administrator so they can assign a
        role before you try again.
      </p>
      <div className="mt-6 flex gap-3">
        {canReturnToWorkspace && (
          <Link
            to={homePath}
            className="rounded-md bg-white px-4 py-2 ui-body font-medium text-slate-900 shadow-sm transition hover:bg-slate-100"
          >
            Back to workspace
          </Link>
        )}
        <Link
          to="/login"
          className={`rounded-md px-4 py-2 ui-body font-medium transition ${
            canReturnToWorkspace
              ? "border border-white/60 text-white hover:bg-white/10"
              : "bg-white text-slate-900 shadow-sm hover:bg-slate-100"
          }`}
        >
          Switch account
        </Link>
      </div>
    </div>
  );
}
