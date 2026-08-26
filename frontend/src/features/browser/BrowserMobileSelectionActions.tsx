/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";
import type { BrowserActionId, BrowserActionState } from "./browserActions";
import {
  bulkDangerClasses,
  toolbarButtonClasses,
  toolbarIconButtonClasses,
  toolbarPrimaryClasses,
} from "./browserConstants";
import { DownloadIcon, MoreIcon, OpenIcon, XIcon } from "./browserIcons";

type BrowserMobileSelectionActionsProps = {
  actions: BrowserActionState[];
  canDownload: boolean;
  canOpen: boolean;
  onDownload: () => void;
  onOpen: () => void;
  onRunAction: (actionId: BrowserActionId) => void;
  summary: string;
};

export default function BrowserMobileSelectionActions({
  actions,
  canDownload,
  canOpen,
  onDownload,
  onOpen,
  onRunAction,
  summary,
}: BrowserMobileSelectionActionsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sheetOpen) return;
    const sheet = sheetRef.current;
    const focusable = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSheetOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const triggerButton = moreButtonRef.current;
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerButton?.focus();
    };
  }, [sheetOpen]);

  return (
    <>
      <div
        role="toolbar"
        aria-label="Selected object actions"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 gap-2 border-t border-slate-200 bg-white/95 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur dark:border-slate-700 dark:bg-slate-950/95"
      >
        <button
          type="button"
          className={`${toolbarButtonClasses} min-h-11 justify-center`}
          onClick={onOpen}
          disabled={!canOpen}
        >
          <OpenIcon className="h-4 w-4" />
          Open
        </button>
        <button
          type="button"
          className={`${toolbarPrimaryClasses} min-h-11 justify-center`}
          onClick={onDownload}
          disabled={!canDownload}
        >
          <DownloadIcon className="h-4 w-4" />
          Download
        </button>
        <button
          ref={moreButtonRef}
          type="button"
          className={`${toolbarButtonClasses} min-h-11 justify-center`}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          <MoreIcon className="h-4 w-4" />
          More
        </button>
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-slate-950/45"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSheetOpen(false);
            }
          }}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="browser-mobile-actions-title"
            className="max-h-[75vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl dark:bg-slate-900"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2
                  id="browser-mobile-actions-title"
                  className="font-semibold text-slate-900 dark:text-slate-100"
                >
                  {summary}
                </h2>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Available actions for the current selection
                </p>
              </div>
              <button
                type="button"
                className={`${toolbarIconButtonClasses} min-h-11 min-w-11`}
                onClick={() => setSheetOpen(false)}
                aria-label="Close actions"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-2">
              {actions
                .filter(
                  (action) =>
                    action.id !== "open" && action.id !== "download",
                )
                .map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    aria-label={action.label}
                    className={`${action.id === "delete" ? bulkDangerClasses : toolbarButtonClasses} min-h-11 w-full justify-start`}
                    disabled={!action.enabled}
                    title={action.disabledReason}
                    onClick={() => {
                      onRunAction(action.id);
                      setSheetOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 text-left">
                      {action.label}
                    </span>
                    {!action.enabled && action.disabledReason && (
                      <span className="ml-3 max-w-[55%] text-right ui-caption font-normal text-slate-500 dark:text-slate-400">
                        {action.disabledReason}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
