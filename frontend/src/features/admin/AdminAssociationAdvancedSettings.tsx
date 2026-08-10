/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import { tableActionButtonClasses } from "../../components/tableActionClasses";

type AdminAssociationAdvancedSettingsProps = {
  targetLabel: string;
  associationKind: "account" | "rgw_user";
  allowManagerBrowserDataAccess: boolean;
  onApply: (allowed: boolean) => void;
};

export default function AdminAssociationAdvancedSettings({
  targetLabel,
  associationKind,
  allowManagerBrowserDataAccess,
  onApply,
}: AdminAssociationAdvancedSettingsProps) {
  const [open, setOpen] = useState(false);
  const [draftAllowed, setDraftAllowed] = useState(allowManagerBrowserDataAccess);

  useEffect(() => {
    if (open) setDraftAllowed(allowManagerBrowserDataAccess);
  }, [allowManagerBrowserDataAccess, open]);

  return (
    <>
      <button type="button" className={tableActionButtonClasses} onClick={() => setOpen(true)}>
        Advanced
      </button>
      {open ? (
        <Modal
          title="Advanced association settings"
          onClose={() => setOpen(false)}
          maxWidthClass="max-w-lg"
        >
          <div className="space-y-4">
            <div>
              <p className="ui-body font-medium text-[var(--ui-text)]">{targetLabel}</p>
              <p className="ui-caption text-[var(--ui-text-muted)]">
                {associationKind === "account"
                  ? "This permission is effective only when this same association also has the Account administrator role."
                  : "Direct and UI group permissions are aggregated for this RGW user."}
              </p>
            </div>
            <label className="flex items-start gap-3 rounded-md border border-[color:var(--ui-border)] p-3">
              <input
                type="checkbox"
                aria-label="Allow Manager Browser data access"
                checked={draftAllowed}
                onChange={(event) => setDraftAllowed(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block ui-body font-medium text-[var(--ui-text)]">
                  Allow Manager Browser data access
                </span>
                <span className="block ui-caption text-[var(--ui-text-muted)]">
                  Disabled by default. This permits data-plane Browser operations from the active Manager context.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <UiButton variant="secondary" onClick={() => setOpen(false)}>Cancel</UiButton>
              <UiButton
                onClick={() => {
                  onApply(draftAllowed);
                  setOpen(false);
                }}
              >
                Apply
              </UiButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
