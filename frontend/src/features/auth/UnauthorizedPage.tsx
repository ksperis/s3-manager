/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import FullPageStatus from "../../components/FullPageStatus";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { readStoredUser, resolvePostLoginPath } from "../../utils/workspaces";

export default function UnauthorizedPage() {
  const { generalSettings } = useGeneralSettings();
  const homePath = useMemo(() => resolvePostLoginPath(readStoredUser(), generalSettings), [generalSettings]);
  const canReturnToWorkspace = homePath !== "/login" && homePath !== "/unauthorized";

  return (
    <FullPageStatus
      title="Unauthorized access"
      description="Your account does not have the required permissions yet. Please contact an administrator so they can assign a role before you try again."
      primaryAction={canReturnToWorkspace ? { label: "Back to workspace", to: homePath, variant: "primary" } : undefined}
      secondaryAction={{ label: "Switch account", to: "/login" }}
    />
  );
}
