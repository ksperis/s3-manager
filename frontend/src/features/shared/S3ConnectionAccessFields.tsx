/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { cx, uiMutedTextClass, uiPanelMutedClass, uiTitleTextClass } from "../../components/ui/styles";

type S3ConnectionAccessFieldsProps = {
  accessManager: boolean;
  accessBrowser: boolean;
  onAccessManagerChange: (checked: boolean) => void;
  onAccessBrowserChange: (checked: boolean) => void;
  title?: string;
  hint?: string;
  className?: string;
  variant?: "plain" | "panel";
  ownerSummary?: string | null;
};

export default function S3ConnectionAccessFields({
  accessManager,
  accessBrowser,
  onAccessManagerChange,
  onAccessBrowserChange,
  title = "Workspace access",
  hint = "At least one access must be enabled.",
  className,
  variant = "plain",
  ownerSummary,
}: S3ConnectionAccessFieldsProps) {
  return (
    <section className={cx("space-y-2", variant === "panel" ? cx("px-3 py-3", uiPanelMutedClass) : "", className)}>
      <div className={cx("ui-body", uiTitleTextClass)}>{title}</div>
      <div className="flex flex-wrap items-center gap-4">
        <UiCheckboxField
          checked={accessManager}
          onChange={(event) => onAccessManagerChange(event.target.checked)}
          className="ui-body text-[var(--ui-text)]"
        >
          Access manager
        </UiCheckboxField>
        <UiCheckboxField
          checked={accessBrowser}
          onChange={(event) => onAccessBrowserChange(event.target.checked)}
          className="ui-body text-[var(--ui-text)]"
        >
          Access browser
        </UiCheckboxField>
      </div>
      <p className={cx("ui-caption", uiMutedTextClass)}>{hint}</p>
      {ownerSummary ? <p className={cx("ui-caption", uiMutedTextClass)}>Owner metadata: {ownerSummary}</p> : null}
    </section>
  );
}
