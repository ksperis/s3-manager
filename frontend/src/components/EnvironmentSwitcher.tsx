/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { GeneralSettings } from "../api/appSettings";
import { useGeneralSettings } from "./GeneralSettingsContext";

const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";
const WORKSPACE_STORAGE_KEY = "selectedWorkspace";

type StoredUser = {
  role?: string | null;
  authType?: string | null;
  account_links?: { account_id: number; account_role?: string | null; account_admin?: boolean | null }[] | null;
  capabilities?: {
    can_manage_buckets?: boolean;
  };
};

type EnvironmentOption = {
  id: "admin" | "manager" | "browser" | "portal";
  label: string;
  path: string;
};

const ALL_ENVIRONMENTS: EnvironmentOption[] = [
  { id: "admin", label: "Admin (plateforme)", path: "/admin" },
  { id: "manager", label: "Manager (admin tenant)", path: "/manager" },
  { id: "browser", label: "Browser (objets)", path: "/browser" },
  { id: "portal", label: "Portail (self-service)", path: "/portal" },
];

function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

function getStoredWorkspaceId(): EnvironmentOption["id"] | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (!stored) return null;
  if (stored === "admin" || stored === "manager" || stored === "browser" || stored === "portal") return stored;
  return null;
}

function resolveAvailableEnvironments(user: StoredUser | null): EnvironmentOption[] {
  if (!user || !user.role) return [];
  if (user.role === ADMIN_ROLE) return ALL_ENVIRONMENTS;
  if (user.role !== USER_ROLE) return [];
  if (user.authType === "rgw_session") {
    return ALL_ENVIRONMENTS.filter((env) => env.id === "manager" || env.id === "browser");
  }
  const links = user.account_links ?? [];
  const hasPortalAccess = links.some(
    (link) => link.account_role === "portal_user" || link.account_role === "portal_manager"
  );
  const hasAccountAdmin = links.some((link) => Boolean(link.account_admin));
  const portalOnly = hasPortalAccess && !hasAccountAdmin;
  const canManageBuckets = user.capabilities?.can_manage_buckets !== false;

  if (portalOnly) {
    return ALL_ENVIRONMENTS.filter((env) => env.id === "portal");
  }

  return ALL_ENVIRONMENTS.filter((env) => {
    if (env.id === "portal") return hasPortalAccess;
    if (env.id === "manager") return true;
    if (env.id === "browser") return canManageBuckets;
    return false;
  });
}

function resolveEnvironmentId(pathname: string, options: EnvironmentOption[]): EnvironmentOption | null {
  const segment = pathname.split("/")[1] || "";
  const active = options.find((option) => option.id === segment);
  return active ?? options[0] ?? null;
}

export default function EnvironmentSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const { generalSettings } = useGeneralSettings();
  const environments = resolveAvailableEnvironmentsWithFlags(user, generalSettings);
  const current = resolveEnvironmentId(location.pathname, environments);

  useEffect(() => {
    if (!current) {
      return;
    }
    const stored = getStoredWorkspaceId();
    if (stored !== current.id) {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, current.id);
    }
  }, [current?.id]);

  if (environments.length <= 1 || !current) return null;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = environments.find((env) => env.id === event.target.value);
    if (!next) return;
    if (location.pathname.startsWith(next.path)) return;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, next.id);
    navigate(next.path);
  };

  return (
    <div className="relative">
      <select
        className="appearance-none rounded-full border border-slate-200 bg-white px-2.5 py-1 pr-6 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900"
        value={current.id}
        onChange={handleChange}
        aria-label="Changer de workspace"
        title="Changer de workspace"
      >
        {environments.map((env) => (
          <option key={env.id} value={env.id}>
            {env.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center ui-caption text-slate-500 dark:text-slate-300">
        ▼
      </div>
    </div>
  );
}

function resolveAvailableEnvironmentsWithFlags(user: StoredUser | null, generalSettings: GeneralSettings): EnvironmentOption[] {
  const filtered = resolveAvailableEnvironments(user);
  return filtered.filter((env) => {
    if (env.id === "manager") return generalSettings.manager_enabled;
    if (env.id === "browser") return generalSettings.browser_enabled && generalSettings.browser_root_enabled;
    if (env.id === "portal") return generalSettings.portal_enabled;
    return true;
  });
}
