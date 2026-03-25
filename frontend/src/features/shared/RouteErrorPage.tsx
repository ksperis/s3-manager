/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect } from "react";
import { useRouteError } from "react-router-dom";
import FullPageStatus from "../../components/FullPageStatus";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { classifyRouteError, resolveRouteErrorHomePath } from "../../utils/routeError";

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
    <FullPageStatus
      title={isBackendUnavailable ? "Backend temporarily unavailable" : "Unexpected application error"}
      description={
        isBackendUnavailable
          ? "The backend is temporarily unreachable. Retry in a moment, or return to your workspace."
          : "Something went wrong while loading this page. Retry now, or return to your workspace."
      }
      primaryAction={{ label: "Retry", onClick: () => window.location.reload(), variant: "primary" }}
      secondaryAction={{ label: "Home", to: homePath }}
    />
  );
}
