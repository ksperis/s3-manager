/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import PageShell from "../../components/PageShell";
import PageTabs, { PageTabPanel } from "../../components/PageTabs";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import {
  canAccessPrivateConnectionsSection,
  readStoredUser,
} from "../../utils/workspaces";
import ProfilePage from "./ProfilePage";
import SecurityPage from "./SecurityPage";
import {
  buildWorkspaceBreadcrumbs,
  resolveWorkspaceIdFromPath,
} from "../../navigation/workspacePages";

type AccountTab = "profile" | "security" | "connections";

export default function AccountProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const storedUser = useMemo(() => readStoredUser(), []);
  const isS3Session = storedUser?.authType === "s3_session";
  const canAccessPrivateConnections =
    !isS3Session && canAccessPrivateConnectionsSection(storedUser);
  const availableTabs = useMemo<AccountTab[]>(
    () => [
      "profile",
      ...(!isS3Session ? (["security"] as const) : []),
      ...(canAccessPrivateConnections ? (["connections"] as const) : []),
    ],
    [canAccessPrivateConnections, isS3Session]
  );
  const requestedTab = searchParams.get("tab") as AccountTab | null;
  const activeTab: AccountTab = requestedTab && availableTabs.includes(requestedTab) ? requestedTab : "profile";
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingTab, setPendingTab] = useState<AccountTab | null>(null);
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

  const applyTabChange = (tab: AccountTab) => {
    setHasUnsavedChanges(false);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
  };

  const changeTab = (tab: string) => {
    if (!availableTabs.includes(tab as AccountTab) || tab === activeTab) return;
    if (hasUnsavedChanges) {
      setPendingTab(tab as AccountTab);
      return;
    }
    applyTabChange(tab as AccountTab);
  };

  const tabs = [
    { id: "profile", label: "Profile" },
    ...(!isS3Session ? [{ id: "security", label: "Security" }] : []),
    ...(canAccessPrivateConnections ? [{ id: "connections", label: "Private S3 connections" }] : []),
  ];
  const pageDescription = isS3Session
    ? "Review the profile details associated with this temporary S3 session."
    : canAccessPrivateConnections
      ? "Manage your personal details, preferences, sign-in security, and private connections."
      : "Manage your personal details, preferences, and sign-in security.";

  return (
    <PageShell
      title="User profile"
      description={pageDescription}
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
      </PageTabPanel>
      {pendingTab ? (
        <ConfirmActionDialog
          title="Discard unsaved changes?"
          description="The changes in the current profile section have not been saved."
          confirmLabel="Discard changes"
          onCancel={() => setPendingTab(null)}
          onConfirm={() => {
            const nextTab = pendingTab;
            setPendingTab(null);
            applyTabChange(nextTab);
          }}
        />
      ) : null}
    </PageShell>
  );
}
