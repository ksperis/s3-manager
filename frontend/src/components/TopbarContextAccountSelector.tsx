/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionContext } from "../api/executionContexts";
import { formatAccountLabel } from "../features/shared/storageEndpointLabel";

export type ContextAccessMode = "admin" | "portal" | "session" | "s3_user" | "connection" | null;

export function getContextAccessModeVisual(mode: ContextAccessMode): {
  label: string;
  shortLabel: string;
  classes: string;
} {
  if (mode === "admin") {
    return {
      label: "Mode admin",
      shortLabel: "Admin",
      classes: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100",
    };
  }
  if (mode === "portal") {
    return {
      label: "Mode portal",
      shortLabel: "Portal",
      classes: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100",
    };
  }
  if (mode === "connection") {
    return {
      label: "Mode connection",
      shortLabel: "Connection",
      classes: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-100",
    };
  }
  if (mode === "s3_user") {
    return {
      label: "Mode S3 user",
      shortLabel: "S3 user",
      classes: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-100",
    };
  }
  return {
    label: "Session",
    shortLabel: "Session",
    classes: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  };
}

type TopbarContextAccountSelectorProps = {
  contexts: ExecutionContext[];
  selectedContextId: string | null;
  onContextChange: (selectedValue: string) => void;
  selectedLabel: string;
  identityLabel: string | null;
  accessMode: ContextAccessMode;
  canToggleAccess?: boolean;
  onToggleAccess?: () => void;
  defaultEndpointId: number | null;
  defaultEndpointName: string | null;
  widthClassName?: string;
  searchThreshold?: number;
};

export default function TopbarContextAccountSelector({
  contexts,
  selectedContextId,
  onContextChange,
  selectedLabel,
  identityLabel,
  accessMode,
  canToggleAccess = false,
  onToggleAccess,
  defaultEndpointId,
  defaultEndpointName,
  widthClassName = "w-[26rem] max-w-[55vw] min-w-[19rem]",
  searchThreshold = 6,
}: TopbarContextAccountSelectorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const modeVisual = getContextAccessModeVisual(accessMode);
  const canShowToggle = (accessMode === "admin" || accessMode === "portal") && Boolean(onToggleAccess);

  const contextItems = useMemo(
    () =>
      contexts.map((context) => {
        const label = formatAccountLabel(context, defaultEndpointId, defaultEndpointName);
        const description =
          context.kind === "connection"
            ? "Connexion privee"
            : context.kind === "legacy_user"
              ? "Identite legacy S3 user"
              : "Compte RGW";
        const haystack = [label, context.display_name, context.endpoint_name, context.endpoint_url, description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return {
          id: context.id,
          label,
          description,
          haystack,
          endpointUrl: context.endpoint_url ?? null,
        };
      }),
    [contexts, defaultEndpointId, defaultEndpointName]
  );

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return contextItems;
    return contextItems.filter((item) => item.haystack.includes(normalized));
  }, [contextItems, query]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) setQuery("");
  }, [menuOpen]);

  return (
    <div ref={rootRef} className={`relative ${widthClassName}`}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className={`inline-flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 text-left shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900 ${
          menuOpen ? "border-primary/70" : ""
        }`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={identityLabel ?? undefined}
      >
        <AccountIcon className="h-4 w-4 text-slate-500 dark:text-slate-300" />
        <span className="min-w-0 flex-1 truncate ui-caption font-semibold text-slate-700 dark:text-slate-100">
          {selectedLabel}
        </span>
        <span className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${modeVisual.classes}`}>
          {modeVisual.shortLabel}
        </span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-slate-500 transition-transform dark:text-slate-300 ${
            menuOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {menuOpen && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-full rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="rounded-lg border border-slate-200/70 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Identite IAM actuelle</p>
            <p className="truncate ui-caption font-semibold text-slate-800 dark:text-slate-100">
              {identityLabel ?? "Non disponible pour ce contexte"}
            </p>
            {canShowToggle && (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-slate-200/70 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/70">
                <div className="min-w-0">
                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-100">Mode admin</p>
                  <p className="truncate ui-caption text-slate-500 dark:text-slate-400">{modeVisual.label}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={accessMode === "admin"}
                  onClick={onToggleAccess}
                  disabled={!canToggleAccess}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    accessMode === "admin"
                      ? "bg-amber-400/80 dark:bg-amber-500/70"
                      : "bg-slate-200 dark:bg-slate-700"
                  } ${canToggleAccess ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                  aria-label={
                    accessMode === "admin"
                      ? canToggleAccess
                        ? "Mode admin actif, basculer en mode portal"
                        : "Mode admin actif"
                      : canToggleAccess
                        ? "Mode portal actif, basculer en mode admin"
                        : "Mode portal actif"
                  }
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition ${
                      accessMode === "admin" ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            )}
          </div>

          {contextItems.length > searchThreshold && (
            <div className="relative mt-2">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher un compte..."
                className="h-9 w-full rounded-lg border border-slate-200/80 bg-white pl-8 pr-3 ui-caption text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          )}

          <div className="mt-2 max-h-72 overflow-y-auto">
            {filteredItems.length === 0 ? (
              <div className="rounded-lg px-3 py-2 ui-caption text-slate-500 dark:text-slate-400">
                Aucun compte ne correspond a votre recherche.
              </div>
            ) : (
              filteredItems.map((item) => {
                const active = item.id === selectedContextId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (item.id !== selectedContextId) onContextChange(item.id);
                    }}
                    className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition ${
                      active
                        ? "bg-primary-50 text-primary-900 dark:bg-primary-900/30 dark:text-primary-100"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="mt-0.5 h-4 w-4 shrink-0">
                      {active ? <CheckIcon className="h-4 w-4" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate ui-caption font-semibold">{item.label}</span>
                      <span className="block truncate ui-caption text-slate-500 dark:text-slate-400">
                        {item.description}
                        {item.endpointUrl ? ` · ${item.endpointUrl}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m5 7 5 6 5-6" />
    </svg>
  );
}

function AccountIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M3 10h18" />
      <circle cx="8.5" cy="14.2" r="1.1" strokeWidth={1.4} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M12 14.2h6" />
    </svg>
  );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="11" cy="11" r="6.5" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeWidth={1.6} d="m16 16 4.5 4.5" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m4.5 10.5 3.2 3.2 7.8-7.8" />
    </svg>
  );
}
