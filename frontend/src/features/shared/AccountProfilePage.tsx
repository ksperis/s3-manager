/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { isAdminLikeRole, isSuperAdminRole, readStoredUser } from "../../utils/workspaces";
import ApiTokensPage from "../admin/ApiTokensPage";
import ProfilePage from "./ProfilePage";

type AccountTab = "profile" | "connections" | "api-tokens";

export default function AccountProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { generalSettings } = useGeneralSettings();
  const storedUser = useMemo(() => readStoredUser(), []);
  const isS3Session = storedUser?.authType === "s3_session";
  const canManagePrivateConnections =
    !isS3Session &&
    (isAdminLikeRole(storedUser?.role) ||
      (storedUser?.role === "ui_user" && generalSettings.allow_user_private_connections));
  const canManageApiTokens = !isS3Session && isSuperAdminRole(storedUser?.role);
  const availableTabs = useMemo<AccountTab[]>(
    () => [
      "profile",
      ...(canManagePrivateConnections ? (["connections"] as const) : []),
      ...(canManageApiTokens ? (["api-tokens"] as const) : []),
    ],
    [canManageApiTokens, canManagePrivateConnections]
  );
  const requestedTab = searchParams.get("tab") as AccountTab | null;
  const activeTab: AccountTab = requestedTab && availableTabs.includes(requestedTab) ? requestedTab : "profile";
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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
    ...(canManagePrivateConnections ? [{ id: "connections", label: "Private S3 connections" }] : []),
    ...(canManageApiTokens ? [{ id: "api-tokens", label: "API tokens" }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="User profile"
        description="Manage your identity, preferences, private storage connections, and automation tokens."
        breadcrumbs={[{ label: "Profile" }]}
      />
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={changeTab} variant="bar" />
      {activeTab === "profile" ? (
        <ProfilePage showPageHeader={false} showSettingsCards showConnectionsSection={false} onUnsavedChangesChange={setHasUnsavedChanges} />
      ) : null}
      {activeTab === "connections" ? (
        <ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection onUnsavedChangesChange={setHasUnsavedChanges} />
      ) : null}
      {activeTab === "api-tokens" ? (
        <ApiTokensPage showPageHeader={false} onUnsavedChangesChange={setHasUnsavedChanges} />
      ) : null}
    </div>
  );
}
