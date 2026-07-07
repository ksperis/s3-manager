/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";

import UiButton from "../../../components/ui/UiButton";

type BucketFeatureJsonExampleProps = {
  show: boolean;
  onToggle: () => void;
  example: string;
  onUseExample?: () => void;
  helperText?: ReactNode;
  disabled?: boolean;
};

export default function BucketFeatureJsonExample({
  show,
  onToggle,
  example,
  onUseExample,
  helperText,
  disabled = false,
}: BucketFeatureJsonExampleProps) {
  return (
    <div className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2 ui-caption text-[var(--ui-text-muted)]">
      <div className="flex flex-wrap items-center gap-2">
        <UiButton
          type="button"
          onClick={onToggle}
          disabled={disabled}
          variant="ghost"
          size="xs"
          className="h-auto px-1.5 py-0.5"
        >
          {show ? "Hide example" : "Show example"}
        </UiButton>
        {onUseExample && (
          <UiButton
            type="button"
            onClick={onUseExample}
            disabled={disabled}
            variant="secondary"
            size="xs"
            className="h-auto rounded-full px-2 py-0.5"
          >
            Use example
          </UiButton>
        )}
        {helperText}
      </div>
      {show && <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 px-3 py-2 ui-caption text-slate-100">{example}</pre>}
    </div>
  );
}
