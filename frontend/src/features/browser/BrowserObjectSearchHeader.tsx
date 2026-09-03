import type { RefObject } from "react";

import {
  toolbarCompactInputClasses,
  toolbarCompactSelectClasses,
} from "../../components/toolbarControlClasses";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import {
  cx,
  uiCheckboxClass,
  uiMenuClass,
  uiMutedTextClass,
} from "../../components/ui/styles";
import { filterChipClasses } from "./browserConstants";
import { ChevronDownIcon, SearchIcon, SlidersIcon } from "./browserIcons";

const searchInputClasses = cx(
  toolbarCompactInputClasses,
  "h-8 w-full py-1.5 text-sm font-normal placeholder:text-slate-400 dark:placeholder:text-slate-500",
);
const selectClasses = cx(toolbarCompactSelectClasses, "h-9 w-full");
const optionCardClasses =
  "inline-flex items-center gap-2 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-1.5 ui-caption font-medium text-[var(--ui-text)] shadow-[var(--ui-shadow-soft)]";
const labelClasses = cx("ui-caption font-medium", uiMutedTextClass);
const menuClasses = cx(uiMenuClass, "overflow-hidden p-1.5");

type BrowserSearchScope = "prefix" | "bucket";
type BrowserObjectTypeFilter = "all" | "file" | "folder";

type BrowserObjectSearchHeaderProps = {
  rootRef: RefObject<HTMLDivElement>;
  optionsButtonRef: RefObject<HTMLButtonElement>;
  optionsMenuRef: RefObject<HTMLDivElement>;
  advancedOptionsEnabled: boolean;
  optionsOpen: boolean;
  filter: string;
  objectNounPlural: string;
  nameSortActive: boolean;
  sortDirection: "asc" | "desc";
  advancedOptionsActive: boolean;
  hasSearchQuery: boolean;
  searchScope: BrowserSearchScope;
  recursive: boolean;
  exactMatch: boolean;
  caseSensitive: boolean;
  typeFilter: BrowserObjectTypeFilter;
  storageFilter: string;
  storageClasses: readonly string[];
  canReset: boolean;
  onSortName: () => void;
  onFilterChange: (value: string) => void;
  onToggleOptions: () => void;
  onScopeChange: (scope: BrowserSearchScope) => void;
  onRecursiveChange: (enabled: boolean) => void;
  onExactMatchChange: (enabled: boolean) => void;
  onCaseSensitiveChange: (enabled: boolean) => void;
  onTypeFilterChange: (filter: BrowserObjectTypeFilter) => void;
  onStorageFilterChange: (filter: string) => void;
  onClear: () => void;
  onClose: () => void;
};

export default function BrowserObjectSearchHeader({
  rootRef,
  optionsButtonRef,
  optionsMenuRef,
  advancedOptionsEnabled,
  optionsOpen,
  filter,
  objectNounPlural,
  nameSortActive,
  sortDirection,
  advancedOptionsActive,
  hasSearchQuery,
  searchScope,
  recursive,
  exactMatch,
  caseSensitive,
  typeFilter,
  storageFilter,
  storageClasses,
  canReset,
  onSortName,
  onFilterChange,
  onToggleOptions,
  onScopeChange,
  onRecursiveChange,
  onExactMatchChange,
  onCaseSensitiveChange,
  onTypeFilterChange,
  onStorageFilterChange,
  onClear,
  onClose,
}: BrowserObjectSearchHeaderProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 pr-3">
      <button
        type="button"
        onClick={onSortName}
        className="group inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap text-left text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100"
      >
        <span>Name</span>
        <ChevronDownIcon
          className={`h-3 w-3 transition ${
            nameSortActive ? "opacity-100" : "opacity-30"
          } ${nameSortActive && sortDirection === "asc" ? "-rotate-180" : ""}`}
        />
      </button>
      <div
        ref={rootRef}
        className="relative w-48 min-w-0 flex-1 sm:w-56 md:w-64 normal-case"
      >
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <SearchIcon className="h-3 w-3" />
        </span>
        <input
          type="text"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={`Search ${objectNounPlural}`}
          aria-label={`Search ${objectNounPlural}`}
          className={`${searchInputClasses} pl-9 ${
            advancedOptionsEnabled ? "pr-9" : "pr-3"
          } normal-case`}
        />
        {advancedOptionsEnabled && (
          <button
            ref={optionsButtonRef}
            type="button"
            onClick={onToggleOptions}
            className={`absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
              advancedOptionsActive
                ? "text-primary-700 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-500/20"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            }`}
            aria-haspopup="menu"
            aria-expanded={optionsOpen}
            aria-label="Search options"
            title="Search options"
          >
            <SlidersIcon className="h-3 w-3" />
          </button>
        )}
        <AnchoredPortalMenu
          open={advancedOptionsEnabled && optionsOpen}
          anchorRef={optionsButtonRef}
          placement="bottom-end"
          offset={8}
          minWidth={288}
          className={`w-72 ${menuClasses}`}
        >
          <div ref={optionsMenuRef} className="space-y-3">
            <label className="block space-y-1">
              <span className={labelClasses}>Scope</span>
              <select
                value={searchScope}
                onChange={(event) =>
                  onScopeChange(event.target.value as BrowserSearchScope)
                }
                className={selectClasses}
                aria-label="Search scope"
                disabled={!hasSearchQuery}
              >
                <option value="prefix">Current path</option>
                <option value="bucket">Whole bucket</option>
              </select>
            </label>
            <label className={optionCardClasses}>
              <input
                type="checkbox"
                checked={recursive}
                onChange={(event) => onRecursiveChange(event.target.checked)}
                disabled={!hasSearchQuery || searchScope === "bucket"}
                className={uiCheckboxClass}
                aria-label="Search recursively in subfolders"
              />
              <span>Recursive</span>
            </label>
            <label className={optionCardClasses}>
              <input
                type="checkbox"
                checked={exactMatch}
                onChange={(event) => onExactMatchChange(event.target.checked)}
                disabled={!hasSearchQuery}
                className={uiCheckboxClass}
                aria-label="Use exact match"
              />
              <span>Exact match</span>
            </label>
            <label className={optionCardClasses}>
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(event) => onCaseSensitiveChange(event.target.checked)}
                disabled={!hasSearchQuery}
                className={uiCheckboxClass}
                aria-label="Case-sensitive search"
              />
              <span>Case-sensitive</span>
            </label>
            <label className="block space-y-1">
              <span className={labelClasses}>Type</span>
              <select
                value={typeFilter}
                onChange={(event) =>
                  onTypeFilterChange(
                    event.target.value as BrowserObjectTypeFilter,
                  )
                }
                className={selectClasses}
                aria-label="Object type filter"
              >
                <option value="all">All</option>
                <option value="file">Files</option>
                <option value="folder">Folders</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className={labelClasses}>Storage class</span>
              <select
                value={storageFilter}
                onChange={(event) =>
                  onStorageFilterChange(event.target.value)
                }
                className={selectClasses}
                aria-label="Storage class filter"
              >
                <option value="all">All classes</option>
                {storageClasses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={onClear}
                className={filterChipClasses}
                disabled={!canReset}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={onClose}
                className={filterChipClasses}
              >
                Close
              </button>
            </div>
          </div>
        </AnchoredPortalMenu>
      </div>
    </div>
  );
}
