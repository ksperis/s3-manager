import type { ReactNode } from "react";

export type AssociationChipItem = {
  id: number | string;
  label: string;
};

export type AssociationAccountItem = AssociationChipItem & {
  account_admin?: boolean | null;
  account_role?: string | null;
};

export type AssociationSummarySection = {
  label: string;
  value: ReactNode;
  visible?: boolean;
};

const chipClass =
  "inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100";
const sectionLabelClass = "ui-badge font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
const sectionValueClass = "ui-caption text-slate-600 dark:text-slate-300";

function normalizePortalRole(value?: string | null): "portal_none" | "portal_user" | "portal_manager" {
  if (value === "portal_user" || value === "portal_manager") return value;
  return "portal_none";
}

export function AssociationChips({ items }: { items: AssociationChipItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span key={`${item.id}-${index}`} className={chipClass}>
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function AccountAssociationChips({ accounts }: { accounts: AssociationAccountItem[] }) {
  if (accounts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {accounts.map((account, index) => {
        const portalRole = normalizePortalRole(account.account_role);
        return (
          <span
            key={`${account.id}-${Boolean(account.account_admin) ? "admin" : "user"}-${portalRole}-${index}`}
            className={chipClass}
          >
            <span>{account.label}</span>
            {account.account_admin && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                Admin
              </span>
            )}
            {portalRole !== "portal_none" && (
              <span className="rounded-full bg-sky-100 px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide text-sky-800 dark:bg-sky-900/40 dark:text-sky-100">
                {portalRole === "portal_manager" ? "Portal manager" : "Portal user"}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function AssociationSummary({ sections }: { sections: AssociationSummarySection[] }) {
  const visibleSections = sections.filter((section) => section.visible !== false);
  if (visibleSections.length === 0) {
    return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
  }
  return (
    <div className={visibleSections.length > 1 ? "space-y-1" : undefined}>
      {visibleSections.map((section) => (
        <div key={section.label}>
          <div className={sectionLabelClass}>{section.label}</div>
          <div className={sectionValueClass}>{section.value ?? "-"}</div>
        </div>
      ))}
    </div>
  );
}
