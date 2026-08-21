/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import PageShell from "../../components/PageShell";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import {
  canAccessPrivateConnectionsSection,
  isSuperAdminRole,
  readStoredUser,
} from "../../utils/workspaces";
import ApiTokensPage from "../admin/ApiTokensPage";
import ProfilePage from "./ProfilePage";
import SecurityPage from "./SecurityPage";
import {
  buildWorkspaceBreadcrumbs,
  resolveWorkspaceIdFromPath,
} from "../../navigation/workspacePages";

type AccountTab = "profile" | "security" | "connections" | "api-tokens";

export default function AccountProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const storedUser = useMemo(() => readStoredUser(), []);
  const isS3Session = storedUser?.authType === "s3_session";
  const canAccessPrivateConnections =
    !isS3Session && canAccessPrivateConnectionsSection(storedUser);
  const canManageApiTokens = !isS3Session && isSuperAdminRole(storedUser?.role);
  const availableTabs = useMemo<AccountTab[]>(
    () => [
      "profile",
      ...(!isS3Session ? (["security"] as const) : []),
      ...(canAccessPrivateConnections ? (["connections"] as const) : []),
      ...(canManageApiTokens ? (["api-tokens"] as const) : []),
    ],
    [canAccessPrivateConnections, canManageApiTokens, isS3Session]
  );
  const requestedTab = searchParams.get("tab") as AccountTab | null;
  const activeTab: AccountTab = requestedTab && availableTabs.includes(requestedTab) ? requestedTab : "profile";
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const workspace = resolveWorkspaceIdFromPath(location.pathname);

  useEffect(() => {
    if (!requestedTab || requestedTab === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set("tab", "profile");
    setSearchParams(next, { replace: true });
  }, [activeTab, requestedTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const changeTab = (tab: string) => {
    if (!availableTabs.includes(tab as AccountTab) || tab === activeTab) return;
    if (hasUnsavedChanges && !window.confirm("Discard unsaved changes?")) return;
    setHasUnsavedChanges(false);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
  };

  const tabs = [
    { id: "profile", label: "Profile" },
    ...(!isS3Session ? [{ id: "security", label: "Security" }] : []),
    ...(canAccessPrivateConnections ? [{ id: "connections", label: "Private S3 connections" }] : []),
    ...(canManageApiTokens ? [{ id: "api-tokens", label: "API tokens" }] : []),
  ];

  return (
    <PageShell
      title="User profile"
      description="Manage your identity, preferences, private storage connections, and automation tokens."
      breadcrumbs={buildWorkspaceBreadcrumbs(workspace, { label: "Profile" })}
    >
      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={changeTab}
        variant="line"
        ariaLabel="Profile sections"
        idPrefix="account-profile"
      />
      <PageTabPanel idPrefix="account-profile" tabId={activeTab}>
        {activeTab === "profile" ? (
          <ProfilePage showPageHeader={false} showSettingsCards showConnectionsSection={false} onUnsavedChangesChange={setHasUnsavedChanges} />
        ) : null}
        {activeTab === "connections" ? (
          <ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection onUnsavedChangesChange={setHasUnsavedChanges} />
        ) : null}
        {activeTab === "security" ? <SecurityPage /> : null}
        {activeTab === "api-tokens" ? (
          <ApiTokensPage showPageHeader={false} onUnsavedChangesChange={setHasUnsavedChanges} />
        ) : null}
      </PageTabPanel>
    </PageShell>
  );
}
