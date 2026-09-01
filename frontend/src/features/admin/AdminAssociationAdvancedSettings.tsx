/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import {
  cx,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
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
            <div className="space-y-1">
              <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{targetLabel}</p>
              <p className={cx("ui-caption", uiMutedTextClass)}>
                {associationKind === "account"
                  ? "This permission is effective only when this same association also has the Account administrator role."
                  : "Direct and UI group permissions are aggregated for this RGW user."}
              </p>
            </div>
            <UiCheckboxField
              aria-label="Allow Manager Browser data access"
              checked={draftAllowed}
              onChange={(event) => setDraftAllowed(event.target.checked)}
              checkboxClassName="mt-0.5 shrink-0"
              className={cx("w-full items-start gap-3 px-4 py-4", uiPanelMutedClass)}
            >
              <span className="min-w-0 flex-1">
                <span className={cx("block ui-body font-semibold", uiTitleTextClass)}>
                  Allow Manager Browser data access
                </span>
                <span className={cx("mt-0.5 block ui-caption", uiMutedTextClass)}>
                  Disabled by default. This permits data-plane Browser operations from the active Manager context.
                </span>
              </span>
            </UiCheckboxField>
            <div className="flex items-center justify-end gap-2">
              <UiButton variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </UiButton>
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
