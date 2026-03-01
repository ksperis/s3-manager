/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGeneralSettings } from "./GeneralSettingsContext";
import TopbarDropdownSelect, { TopbarDropdownOption } from "./TopbarDropdownSelect";
import { listExecutionContexts } from "../api/executionContexts";
import {
  WORKSPACE_STORAGE_KEY,
  isAdminLikeRole,
  type WorkspaceId,
  readStoredUser,
  readStoredWorkspaceId,
  resolveAvailableWorkspacesWithFlags,
  resolveWorkspaceFromPath,
} from "../utils/workspaces";

type EnvironmentSwitcherProps = {
  triggerMode?: "icon" | "icon_label";
  openInPortal?: boolean;
  widthClassName?: string;
  menuMinWidthClassName?: string;
  compactOnNarrow?: boolean;
};

export type WorkspaceSwitcherModel = {
  currentWorkspaceId: WorkspaceId;
  currentWorkspaceLabel: string;
  options: TopbarDropdownOption[];
  onChange: (nextWorkspaceId: string) => void;
};

export function useWorkspaceSwitcherModel(): WorkspaceSwitcherModel | null {
  const navigate = useNavigate();
  const location = useLocation();
  const user = readStoredUser();
  const [workspaceContextAvailability, setWorkspaceContextAvailability] = useState<{
    manager: boolean | null;
    browser: boolean | null;
  }>({
    manager: null,
    browser: null,
  });
  const { generalSettings } = useGeneralSettings();
  const environments = useMemo(() => {
    const base = resolveAvailableWorkspacesWithFlags(user, generalSettings);
    const isUiUser = user?.role === "ui_user";
    const isSessionUser = user?.authType === "s3_session";
    if (!isUiUser || isSessionUser) {
      return base;
    }
    return base.filter((workspace) => {
      if (workspace.id === "manager" && workspaceContextAvailability.manager === false) return false;
      if (workspace.id === "browser" && workspaceContextAvailability.browser === false) return false;
      return true;
    });
  }, [generalSettings, user, workspaceContextAvailability.browser, workspaceContextAvailability.manager]);
  const current = resolveWorkspaceFromPath(location.pathname, environments);

  useEffect(() => {
    const isUiUser = user?.role === "ui_user";
    const isSessionUser = user?.authType === "s3_session";
    if (!isUiUser || isSessionUser || isAdminLikeRole(user?.role)) {
      setWorkspaceContextAvailability({ manager: null, browser: null });
      return;
    }
    let cancelled = false;
    Promise.allSettled([listExecutionContexts("manager"), listExecutionContexts("browser")]).then((results) => {
      if (cancelled) return;
      const managerAvailable = results[0].status === "fulfilled" && results[0].value.length > 0;
      const browserAvailable = results[1].status === "fulfilled" && results[1].value.length > 0;
      setWorkspaceContextAvailability({
        manager: managerAvailable,
        browser: browserAvailable,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.authType, user?.role]);

  const currentWorkspaceId = current?.id ?? null;

  useEffect(() => {
    if (!currentWorkspaceId) {
      return;
    }
    const stored = readStoredWorkspaceId();
    if (stored !== currentWorkspaceId) {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, currentWorkspaceId);
    }
  }, [currentWorkspaceId]);

  if (environments.length <= 1 || !current) {
    return null;
  }

  const options: TopbarDropdownOption[] = environments.map((env) => ({
    value: env.id,
    label: env.label,
    icon: workspaceIconById(env.id),
  }));

  const handleChange = (nextWorkspaceId: string) => {
    const next = environments.find((env) => env.id === nextWorkspaceId);
    if (!next) return;
    if (location.pathname.startsWith(next.path)) return;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, next.id);
    navigate(next.path);
  };

  return {
    currentWorkspaceId: current.id,
    currentWorkspaceLabel: current.label,
    options,
    onChange: handleChange,
  };
}

export default function EnvironmentSwitcher({
  triggerMode = "icon_label",
  openInPortal = true,
  widthClassName,
  menuMinWidthClassName = "min-w-48",
  compactOnNarrow,
}: EnvironmentSwitcherProps) {
  const model = useWorkspaceSwitcherModel();
  if (!model) return null;
  const iconOnly = triggerMode === "icon";

  return (
    <TopbarDropdownSelect
      value={model.currentWorkspaceId}
      options={model.options}
      onChange={model.onChange}
      ariaLabel="Changer de workspace"
      triggerLabel="Workspace"
      title="Changer de workspace"
      align="right"
      widthClassName={widthClassName ?? (iconOnly ? "w-9" : "w-44 xl:w-56")}
      menuMinWidthClassName={menuMinWidthClassName}
      compactOnNarrow={compactOnNarrow ?? !iconOnly}
      triggerMode={triggerMode}
      openInPortal={openInPortal}
      icon={<WorkspaceIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />}
    />
  );
}

function WorkspaceIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M3 10h18" />
    </svg>
  );
}

export function workspaceIconById(id: WorkspaceId): React.ReactNode {
  if (id === "admin") return <AdminIcon className="h-4 w-4" />;
  if (id === "ceph-admin") return <CephIcon className="h-4 w-4" />;
  if (id === "manager") return <ManagerIcon className="h-4 w-4" />;
  if (id === "browser") return <BrowserIcon className="h-4 w-4" />;
  return <PortalIcon className="h-4 w-4" />;
}

function AdminIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 3.5 4 7v5c0 4.5 3.2 7.8 8 8.8 4.8-1 8-4.3 8-8.8V7l-8-3.5Z" />
      <path strokeLinecap="round" strokeWidth={1.6} d="M9.2 12.2 11 14l3.8-3.8" />
    </svg>
  );
}

function CephIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <ellipse cx="12" cy="6.5" rx="6.5" ry="2.7" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5.5 6.5v5.5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5.5 12v5.5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V12" />
    </svg>
  );
}

function ManagerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="4" width="8" height="7" rx="1.5" strokeWidth={1.6} />
      <rect x="13" y="4" width="8" height="7" rx="1.5" strokeWidth={1.6} />
      <rect x="3" y="13" width="8" height="7" rx="1.5" strokeWidth={1.6} />
      <rect x="13" y="13" width="8" height="7" rx="1.5" strokeWidth={1.6} />
    </svg>
  );
}

function BrowserIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeWidth={1.6} d="M3 9h18" />
      <circle cx="7" cy="6.8" r="0.9" />
      <circle cx="10.5" cy="6.8" r="0.9" />
      <circle cx="14" cy="6.8" r="0.9" />
    </svg>
  );
}

function PortalIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 3.5 4.5 8v8l7.5 4.5L19.5 16V8L12 3.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="m12 12 7.5-4M12 12l-7.5-4M12 12v8.5" />
    </svg>
  );
}
