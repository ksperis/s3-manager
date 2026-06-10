const tabsContainerClass =
  "flex flex-wrap gap-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-1";
const tabButtonClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 ui-caption font-semibold transition ${
    active
      ? "bg-[var(--ui-surface)] text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]"
      : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]"
  }`;

export type AdminModalTab<T extends string> = {
  id: T;
  label: string;
  visible?: boolean;
};

export default function AdminModalTabs<T extends string>({
  activeTab,
  onTabChange,
  tabs,
}: {
  activeTab: T;
  onTabChange: (tab: T) => void;
  tabs: AdminModalTab<T>[];
}) {
  return (
    <div className={tabsContainerClass}>
      {tabs
        .filter((tab) => tab.visible !== false)
        .map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={tabButtonClass(activeTab === tab.id)}
          >
            {tab.label}
          </button>
        ))}
    </div>
  );
}
