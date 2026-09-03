import type { KeyboardEvent, RefObject } from "react";

import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { cx, uiMenuClass } from "../../components/ui/styles";
import { breadcrumbIconButtonClasses } from "./browserConstants";
import { UpIcon } from "./browserIcons";
import type { PathSuggestion } from "./browserPathSuggestions";

const pathStripClasses =
  "flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-1.5 shadow-[var(--ui-shadow-soft)]";
const inputClasses = cx(toolbarCompactInputClasses, "w-full py-2 font-medium");
const menuClasses = cx(uiMenuClass, "overflow-hidden p-1.5");

type BrowserPathBreadcrumb = {
  label: string;
  prefix: string;
};

type BrowserPathNavigatorProps = {
  inputRef: RefObject<HTMLInputElement>;
  editing: boolean;
  value: string;
  disabled: boolean;
  suggestions: PathSuggestion[];
  suggestionsLoading: boolean;
  activeSuggestionIndex: number;
  breadcrumbs: BrowserPathBreadcrumb[];
  canGoUp: boolean;
  onStartEditing: () => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onHoverSuggestion: (index: number) => void;
  onSelectSuggestion: (suggestion: PathSuggestion) => void;
  onGoUp: () => void;
  onSelectPrefix: (prefix: string) => void;
};

const suggestionSourceBadge = (source: PathSuggestion["source"]) => {
  if (source === "history") return "Recent";
  if (source === "local") return "Visible";
  return null;
};

export default function BrowserPathNavigator({
  inputRef,
  editing,
  value,
  disabled,
  suggestions,
  suggestionsLoading,
  activeSuggestionIndex,
  breadcrumbs,
  canGoUp,
  onStartEditing,
  onChange,
  onBlur,
  onKeyDown,
  onHoverSuggestion,
  onSelectSuggestion,
  onGoUp,
  onSelectPrefix,
}: BrowserPathNavigatorProps) {
  const activeSuggestion =
    activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length;

  return (
    <div
      className={`${pathStripClasses} ui-caption font-semibold text-slate-500 dark:text-slate-400`}
      onClick={editing ? undefined : onStartEditing}
      onDoubleClick={editing ? undefined : onStartEditing}
    >
      {editing ? (
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            placeholder="root"
            aria-label="Path"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="browser-path-suggestion-list"
            aria-expanded={suggestions.length > 0 || suggestionsLoading}
            aria-activedescendant={
              activeSuggestion
                ? `browser-path-suggestion-${activeSuggestionIndex}`
                : undefined
            }
            className={`${inputClasses} min-w-0`}
            disabled={disabled}
            spellCheck={false}
          />
          {(suggestions.length > 0 || suggestionsLoading) && (
            <div
              id="browser-path-suggestion-list"
              role="listbox"
              className={`absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden py-1 ui-caption ${menuClasses}`}
            >
              {suggestions.length === 0 ? (
                <div className="px-2 py-1.5 text-slate-500 dark:text-slate-300">
                  Searching folders...
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  {suggestions.map((suggestion, index) => {
                    const isActive = index === activeSuggestionIndex;
                    const suggestionId = `browser-path-suggestion-${index}`;
                    const sourceBadge = suggestionSourceBadge(suggestion.source);
                    return (
                      <button
                        id={suggestionId}
                        key={`${suggestion.source}-${suggestion.value}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => onHoverSuggestion(index)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onSelectSuggestion(suggestion);
                        }}
                        className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                          isActive
                            ? "bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                            : "text-slate-700 hover:bg-primary-50/70 dark:text-slate-200 dark:hover:bg-slate-800"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate font-semibold"
                            title={suggestion.label}
                          >
                            {suggestion.label}
                          </span>
                          <span
                            className="mt-0.5 block break-all text-[11px] font-medium leading-tight text-slate-400 dark:text-slate-500"
                            title={suggestion.value}
                          >
                            {suggestion.value}
                          </span>
                        </span>
                        {sourceBadge && (
                          <span className="ml-2 shrink-0 self-start rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                            {sourceBadge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {suggestionsLoading && suggestions.length > 0 && (
                <div className="border-t border-slate-200 px-2 py-1 text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  Searching more folders...
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onGoUp();
            }}
            className={breadcrumbIconButtonClasses}
            disabled={!canGoUp}
            aria-label="Parent folder"
            title="Parent folder"
          >
            <UpIcon className="h-3.5 w-3.5" />
          </button>
          <nav
            aria-label="Current path"
            className="browser-path-scroll min-w-0 flex flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-0.5"
          >
            {breadcrumbs.length === 0 ? (
              <span className="shrink-0 text-slate-400">(root)</span>
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectPrefix("");
                }}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                title="root"
              >
                root
              </button>
            )}
            {breadcrumbs.map((crumb) => (
              <span
                key={crumb.prefix}
                className="flex shrink-0 items-center gap-1"
              >
                <span className="text-slate-300">/</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectPrefix(crumb.prefix);
                  }}
                  className="max-w-[220px] truncate rounded-md px-1.5 py-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 sm:max-w-[320px] md:max-w-[420px]"
                  title={crumb.prefix}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
