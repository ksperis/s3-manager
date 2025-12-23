/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const ADMIN_ROLE = "ui_admin";
const USER_ROLE = "ui_user";

type StoredUser = {
  role?: string | null;
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
  { id: "admin", label: "Admin", path: "/admin" },
  { id: "manager", label: "Manager", path: "/manager" },
  { id: "browser", label: "Browser", path: "/browser" },
  { id: "portal", label: "Portail", path: "/portal" },
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

function resolveAvailableEnvironments(user: StoredUser | null): EnvironmentOption[] {
  if (!user || !user.role) return [];
  if (user.role === ADMIN_ROLE) return ALL_ENVIRONMENTS;
  if (user.role !== USER_ROLE) return [];
  const links = user.account_links ?? [];
  const hasPortalAccess = links.some((link) => link.account_role !== "portal_none");
  const hasAccountAdmin = links.some((link) => link.account_admin);
  const canManageBuckets = user.capabilities?.can_manage_buckets !== false;

  return ALL_ENVIRONMENTS.filter((env) => {
    if (env.id === "portal") return hasPortalAccess;
    if (env.id === "manager") return hasAccountAdmin;
    if (env.id === "browser") return hasAccountAdmin && canManageBuckets;
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
  const environments = resolveAvailableEnvironments(user);
  const current = resolveEnvironmentId(location.pathname, environments);

  if (environments.length <= 1 || !current) return null;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = environments.find((env) => env.id === event.target.value);
    if (!next) return;
    if (location.pathname.startsWith(next.path)) return;
    navigate(next.path);
  };

  return (
    <div className="relative">
      <select
        className="appearance-none rounded-full border border-slate-200 bg-white px-3 py-1.5 pr-7 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900"
        value={current.id}
        onChange={handleChange}
        aria-label="Changer d'environnement"
        title="Changer d'environnement"
      >
        {environments.map((env) => (
          <option key={env.id} value={env.id}>
            {env.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-500 dark:text-slate-300">
        ▼
      </div>
    </div>
  );
}
