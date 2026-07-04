import type { ReactNode } from "react";

export type AssociationChipItem = {
  id: number | string;
  label: string;
};

export type AssociationAccountItem = AssociationChipItem & {
  account_admin?: boolean | null;
};

export type AssociationSummarySection = {
  label: string;
  value: ReactNode;
  visible?: boolean;
};

const chipClass =
  "inline-flex max-w-full min-w-0 flex-wrap items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100";
const sectionLabelClass = "ui-badge font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
const sectionValueClass = "min-w-0 max-w-full ui-caption text-slate-600 dark:text-slate-300";

export function AssociationChips({ items }: { items: AssociationChipItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex max-w-full min-w-0 flex-wrap gap-1.5">
      {items.map((item, index) => (
        <span key={`${item.id}-${index}`} className={chipClass}>
          <span className="min-w-0 max-w-full break-all">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

export function AccountAssociationChips({ accounts }: { accounts: AssociationAccountItem[] }) {
  if (accounts.length === 0) return null;
  return (
    <div className="flex max-w-full min-w-0 flex-wrap gap-1.5">
      {accounts.map((account, index) => (
        <span key={`${account.id}-${Boolean(account.account_admin) ? "admin" : "user"}-${index}`} className={chipClass}>
          <span className="min-w-0 max-w-full break-all">{account.label}</span>
          {account.account_admin && (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
              Admin
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export default function AssociationSummary({ sections }: { sections: AssociationSummarySection[] }) {
  const visibleSections = sections.filter((section) => section.visible !== false);
  if (visibleSections.length === 0) {
    return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
  }
  return (
    <div className={visibleSections.length > 1 ? "min-w-0 max-w-full space-y-1" : "min-w-0 max-w-full"}>
      {visibleSections.map((section) => (
        <div key={section.label} className="min-w-0 max-w-full">
          <div className={sectionLabelClass}>{section.label}</div>
          <div className={sectionValueClass}>{section.value ?? "-"}</div>
        </div>
      ))}
    </div>
  );
}
