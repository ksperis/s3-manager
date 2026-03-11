/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { CephAdminBucket } from "../../api/cephAdmin";
import { tableActionMenuItemClasses } from "../../components/tableActionClasses";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";

type BucketOpsRowActionsMenuProps = {
  actionMenuKey: string;
  activeActionMenuKey: string | null;
  setActiveActionMenuKey: Dispatch<SetStateAction<string | null>>;
  actionMenuAnchorRefs: RefObject<Record<string, HTMLButtonElement | null>>;
  actionMenuSurfaceRef: RefObject<HTMLDivElement | null>;
  bucket: CephAdminBucket;
  isStorageOps: boolean;
  selectedEndpointId: number | null | undefined;
  cephAdminBrowserEnabled: boolean;
  onOpenInBrowser: (bucket: CephAdminBucket) => void;
  onConfigure: (bucket: CephAdminBucket) => void;
  onOpenInManager?: (bucket: CephAdminBucket) => void;
};

const toAnchorRef = (node: HTMLElement | null): RefObject<HTMLElement | null> => ({ current: node });

export default function BucketOpsRowActionsMenu({
  actionMenuKey,
  activeActionMenuKey,
  setActiveActionMenuKey,
  actionMenuAnchorRefs,
  actionMenuSurfaceRef,
  bucket,
  isStorageOps,
  selectedEndpointId,
  cephAdminBrowserEnabled,
  onOpenInBrowser,
  onConfigure,
  onOpenInManager,
}: BucketOpsRowActionsMenuProps) {
  const menuOpen = activeActionMenuKey === actionMenuKey;

  return (
    <div className="inline-flex items-center">
      <button
        ref={(node) => {
          actionMenuAnchorRefs.current[actionMenuKey] = node;
        }}
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-600 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100"
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          setActiveActionMenuKey((prev) => (prev === actionMenuKey ? null : actionMenuKey));
        }}
      >
        ⋮
      </button>
      <AnchoredPortalMenu
        open={menuOpen}
        anchorRef={toAnchorRef(actionMenuAnchorRefs.current[actionMenuKey])}
        placement="bottom-end"
        offset={4}
        minWidth={176}
        className="w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <div
          ref={(node) => {
            if (menuOpen) actionMenuSurfaceRef.current = node;
          }}
          role="menu"
          aria-label={`Actions for bucket ${bucket.name}`}
        >
          {isStorageOps ? (
            <>
              <button
                type="button"
                role="menuitem"
                className={`${tableActionMenuItemClasses} !px-2 !py-1 !text-[11px]`}
                onClick={() => {
                  onConfigure(bucket);
                  setActiveActionMenuKey(null);
                }}
              >
                Configure
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!onOpenInManager}
                className={`${tableActionMenuItemClasses} !px-2 !py-1 !text-[11px]`}
                title={onOpenInManager ? "Open this bucket context in Manager" : "Manager action unavailable"}
                onClick={() => {
                  if (!onOpenInManager) return;
                  onOpenInManager(bucket);
                  setActiveActionMenuKey(null);
                }}
              >
                Open in Manager
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={!selectedEndpointId || !cephAdminBrowserEnabled}
                className={`${tableActionMenuItemClasses} !px-2 !py-1 !text-[11px]`}
                title={
                  selectedEndpointId && cephAdminBrowserEnabled
                    ? "Open this bucket in Ceph Admin Browser"
                    : "Ceph Admin Browser is disabled in application settings"
                }
                onClick={() => {
                  if (!selectedEndpointId || !cephAdminBrowserEnabled) return;
                  onOpenInBrowser(bucket);
                  setActiveActionMenuKey(null);
                }}
              >
                Open in Browser
              </button>
              <button
                type="button"
                role="menuitem"
                className={`${tableActionMenuItemClasses} !px-2 !py-1 !text-[11px]`}
                onClick={() => {
                  onConfigure(bucket);
                  setActiveActionMenuKey(null);
                }}
              >
                Configure
              </button>
            </>
          )}
        </div>
      </AnchoredPortalMenu>
    </div>
  );
}
