import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import type { UiGroupAvatarDescriptor } from "../../api/groups";
import type { UserAvatarDescriptor } from "../../api/users";
import { normalizeAccountAccessRole } from "../../api/accountRoles";
import GroupAvatar from "../../components/GroupAvatar";
import UserAvatar from "../../components/UserAvatar";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import { buildAdminPrincipalEditHref } from "./adminPrincipalEditLink";

export type AssociationChipItem = {
  id: number | string;
  label: string;
};

export type AssociationAccountItem = AssociationChipItem & {
  role?: string | null;
};

export type AssociationPrincipalItem = {
  id: number | string;
  kind: "user" | "group";
  label: string;
  email?: string | null;
  avatar?: UserAvatarDescriptor | UiGroupAvatarDescriptor | null;
  role?: string | null;
  role_labels?: string[];
};

export type CompactAssociationItem = {
  id: number | string;
  label: string;
  role_labels?: string[];
};

export type CompactAssociationCategory = {
  id: "accounts" | "s3_users" | "connections";
  label: string;
  itemLabel: string;
  items: CompactAssociationItem[];
};

const DEFAULT_TOOLTIP_LIMIT = 20;
const associationCategoryClasses: Record<CompactAssociationCategory["id"], string> = {
  accounts: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100",
  s3_users: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-100",
  connections: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100",
};

type AssociationRoleTooltipEntry = {
  key: string;
  identity: string;
  kindLabel?: string;
  descriptionKindLabel?: string;
  roles: string[];
};

function roleBadgeClasses(role: string): string {
  const normalized = role.toLowerCase();
  if (normalized.includes("admin") || normalized.includes("manager")) {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200";
  }
  if (normalized.includes("portal")) {
    return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200";
  }
  if (normalized.includes("browser")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200";
  }
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function isAccessProvenanceLabel(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === "direct access" ||
    normalized === "direct or group access" ||
    normalized.startsWith("direct:") ||
    normalized.startsWith("group ")
  );
}

function tooltipDescription(label: string, entries: AssociationRoleTooltipEntry[], remaining: number): string {
  const lines = [
    `${label} (${entries.length + remaining})`,
    ...entries.map((entry) => {
      const identity = `${entry.descriptionKindLabel ? `${entry.descriptionKindLabel}: ` : ""}${entry.identity}`;
      return entry.roles.length > 0 ? `${identity} — Roles: ${entry.roles.join(", ")}` : identity;
    }),
  ];
  if (remaining > 0) lines.push(`… ${remaining} more`);
  return lines.join("\n");
}

export function AssociationRoleTooltip({
  label,
  entries,
  tooltipLimit = DEFAULT_TOOLTIP_LIMIT,
  ariaLabel,
  focusable = false,
  children,
}: {
  label: string;
  entries: AssociationRoleTooltipEntry[];
  tooltipLimit?: number;
  ariaLabel: string;
  focusable?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const descriptionId = useId();
  const boundedLimit = Math.max(1, tooltipLimit);
  const listedEntries = useMemo(() => entries.slice(0, boundedLimit), [boundedLimit, entries]);
  const remaining = entries.length - listedEntries.length;
  const description = tooltipDescription(label, listedEntries, remaining);

  const cancelClose = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const openTooltip = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };
  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose();
  };

  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
  }, []);

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex max-w-full"
      aria-label={ariaLabel}
      aria-describedby={descriptionId}
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={openTooltip}
      onMouseLeave={scheduleClose}
      onFocusCapture={openTooltip}
      onBlurCapture={handleBlur}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {children}
      <span id={descriptionId} className="sr-only whitespace-pre-line">{description}</span>
      <AnchoredPortalMenu
        open={open}
        anchorRef={anchorRef}
        placement="bottom-start"
        offset={4}
        minWidth={340}
        className="pointer-events-auto max-h-[calc(100vh-1rem)] w-96 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <div
          role="tooltip"
          aria-label={`${label} details`}
          onMouseEnter={openTooltip}
          onMouseLeave={scheduleClose}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1 dark:border-slate-800">
            <p className="text-[11px] font-semibold leading-4 text-slate-900 dark:text-slate-100">{label}</p>
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {entries.length} total
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {listedEntries.map((entry) => (
              <div key={entry.key} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1">
                <div className="flex min-w-0 flex-1 items-baseline gap-1">
                  {entry.kindLabel ? (
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {entry.kindLabel}
                    </span>
                  ) : null}
                  <span className="min-w-0 truncate text-[11px] font-medium leading-4 text-slate-800 dark:text-slate-100">
                    {entry.identity}
                  </span>
                </div>
                {entry.roles.length > 0 ? (
                  <div className="flex shrink-0 flex-wrap justify-end gap-0.5">
                    {entry.roles.map((role) => (
                      <span
                        key={`${entry.key}:${role}`}
                        className={`rounded-full border px-1 py-0.5 text-[9px] font-semibold leading-none ${roleBadgeClasses(role)}`}
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {remaining > 0 ? (
            <p className="border-t border-slate-100 pt-1 text-[10px] font-medium leading-4 text-slate-500 dark:border-slate-800 dark:text-slate-400">
              +{remaining} more {remaining === 1 ? "entry" : "entries"}
            </p>
          ) : null}
        </div>
      </AnchoredPortalMenu>
    </span>
  );
}

export function accountAssociationRoleLabels(
  account: AssociationAccountItem,
  _showPortalRole = true,
): string[] {
  const roles: string[] = [];
  const portalRole = normalizeAccountAccessRole(account.role);
  roles.push(
    portalRole === "account_administrator"
      ? "Account administrator"
      : portalRole === "portal_manager"
        ? "Portal manager"
        : "Portal user"
  );
  if (roles.length === 0) roles.push("Member");
  return roles;
}

export function uiPrincipalRoleLabel(role?: string | null): string {
  const normalized = (role ?? "").toLowerCase();
  if (["ui_superadmin", "super_admin", "superadmin"].includes(normalized)) return "Superadmin";
  if (["ui_admin", "account_admin", "admin"].includes(normalized)) return "Admin";
  if (["ui_none", "none"].includes(normalized)) return "No UI access";
  if (["ui_user", "account_user", "user"].includes(normalized)) return "User";
  return role?.trim() || "User";
}

export function CompactAssociationSummary({
  categories,
  tooltipLimit = DEFAULT_TOOLTIP_LIMIT,
}: {
  categories: CompactAssociationCategory[];
  tooltipLimit?: number;
}) {
  const visibleCategories = categories.filter((category) => category.items.length > 0);
  if (visibleCategories.length === 0) {
    return <span className="ui-caption text-slate-500 dark:text-slate-400">None</span>;
  }
  const total = visibleCategories.reduce((sum, category) => sum + category.items.length, 0);
  const entries = visibleCategories.flatMap((category) =>
    category.items.map((item) => ({
      key: `${category.id}:${item.id}`,
      kindLabel: category.itemLabel,
      descriptionKindLabel: category.itemLabel,
      identity: item.label,
      roles: (item.role_labels ?? []).filter((role) => !isAccessProvenanceLabel(role)),
    })),
  );
  return (
    <AssociationRoleTooltip
      label="Linked associations"
      entries={entries}
      tooltipLimit={tooltipLimit}
      ariaLabel={`${total} linked association${total === 1 ? "" : "s"}`}
      focusable
    >
      <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
        {visibleCategories.map((category) => (
          <span
            key={category.id}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ui-caption font-semibold ${associationCategoryClasses[category.id]}`}
          >
            <span>{category.label}</span>
            <span aria-label={`${category.items.length} ${category.label.toLowerCase()}`}>{category.items.length}</span>
          </span>
        ))}
      </span>
    </AssociationRoleTooltip>
  );
}

function principalTooltipEntry(item: AssociationPrincipalItem, _showPortalRole: boolean): AssociationRoleTooltipEntry {
  const identity = item.email && item.email !== item.label ? `${item.label} · ${item.email}` : item.label;
  const roles: string[] = [...(item.role_labels ?? [])];
  const kindLabel = item.kind === "group" ? "UI group" : "UI user";
  if (item.role) {
    const portalRole = normalizeAccountAccessRole(item.role);
    roles.push(
      portalRole === "account_administrator"
        ? "Account administrator"
        : portalRole === "portal_manager"
          ? "Portal manager"
          : "Portal user"
    );
  }
  return {
    key: `${item.kind}:${item.id}`,
    identity,
    kindLabel,
    descriptionKindLabel: kindLabel,
    roles,
  };
}

export function AssociationPrincipalStack({
  items,
  showPortalRole = true,
  maxVisible = 5,
  tooltipLimit = DEFAULT_TOOLTIP_LIMIT,
}: {
  items: AssociationPrincipalItem[];
  showPortalRole?: boolean;
  maxVisible?: number;
  tooltipLimit?: number;
}) {
  if (items.length === 0) return <span className="ui-caption text-slate-500 dark:text-slate-400">None</span>;
  const visible = items.slice(0, maxVisible);
  const remaining = items.length - visible.length;
  const entries = items.map((item) => principalTooltipEntry(item, showPortalRole));
  return (
    <AssociationRoleTooltip
      label="Linked principals"
      entries={entries}
      tooltipLimit={tooltipLimit}
      ariaLabel={`${items.length} linked principal${items.length === 1 ? "" : "s"}`}
    >
      <span className="inline-flex items-center -space-x-1.5">{visible.map((item) => {
        const principalType = item.kind === "group" ? "UI group" : "UI user";
        const href = buildAdminPrincipalEditHref({
          id: item.id,
          kind: item.kind,
          search: item.email || item.label,
        });
        return (
          <a
            key={`${item.kind}-${item.id}`}
            href={href}
            aria-label={`Edit ${principalType} ${item.label}`}
            className={`group relative inline-flex shrink-0 transition-transform hover:z-20 hover:-translate-y-0.5 focus:z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-surface)] ${
              item.kind === "group" ? "rounded-lg" : "rounded-full"
            }`}
          >
            {item.kind === "group" ? (
              <GroupAvatar
                name={item.label}
                avatar={item.avatar as UiGroupAvatarDescriptor | null | undefined}
                size="sm"
                decorative
              />
            ) : (
              <UserAvatar
                name={item.label}
                email={item.email}
                avatar={item.avatar as UserAvatarDescriptor | null | undefined}
                size="sm"
                decorative
              />
            )}
          </a>
        );
      })}
      {remaining > 0 ? (
        <span
          aria-hidden="true"
          className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--ui-surface)] bg-slate-200 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-100"
        >
          +{remaining}
        </span>
      ) : null}
      </span>
    </AssociationRoleTooltip>
  );
}
