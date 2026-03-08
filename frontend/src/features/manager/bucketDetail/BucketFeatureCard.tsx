/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import UiCard from "../../../components/ui/UiCard";
import { cx, uiFeatureCardStateClasses } from "../../../components/ui/styles";
import type { BucketFeatureCardMode, BucketFeatureVisualState } from "./bucketFeatureState";

const bucketFeatureCardBaseClass =
  "border-slate-300/90 bg-slate-50/70 shadow-sm dark:border-slate-500/80 dark:bg-slate-800/80";

type BucketFeatureCardProps = {
  title: string;
  description: string;
  mode: BucketFeatureCardMode;
  visualState: BucketFeatureVisualState;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
};

export default function BucketFeatureCard({
  title,
  description,
  mode,
  visualState,
  actions,
  children,
  className,
  bodyClassName,
  testId,
}: BucketFeatureCardProps) {
  return (
    <UiCard
      title={title}
      description={description}
      actions={actions}
      className={cx(bucketFeatureCardBaseClass, uiFeatureCardStateClasses[visualState], className)}
      bodyClassName={bodyClassName}
    >
      <section data-testid={testId} data-feature-state={visualState} data-feature-mode={mode}>
        {children}
      </section>
    </UiCard>
  );
}
