/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { useInRouterContext } from "react-router-dom";

import Modal from "./Modal";
import PageHeader, { type PageBreadcrumb } from "./PageHeader";
import { cx, uiDividerClass, uiMutedTextClass, uiPanelClass, uiTitleTextClass } from "./ui/styles";

type WorkflowPageProps = {
  title: string;
  description?: ReactNode;
  breadcrumbs?: PageBreadcrumb[];
  inlineContent?: ReactNode;
  metaContent?: ReactNode;
  rightContent?: ReactNode;
  backLabel?: string;
  backTo?: string;
  onBack?: () => void;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  contentVariant?: "panel" | "plain";
  width?: "full" | "narrow" | "standard" | "wide";
};

const workflowWidthClasses: Record<NonNullable<WorkflowPageProps["width"]>, string> = {
  full: "w-full",
  narrow: "w-full max-w-3xl",
  standard: "w-full max-w-5xl",
  wide: "w-full max-w-7xl",
};

/**
 * Shared shell for long-running operations and forms that need page-level
 * space. Keeping the shell neutral lets every workspace preserve its own
 * vocabulary while sharing hierarchy, spacing and the return action.
 */
export default function WorkflowPage({
  title,
  description,
  breadcrumbs = [],
  inlineContent,
  metaContent,
  rightContent,
  backLabel = "Back",
  backTo,
  onBack,
  children,
  className,
  contentClassName,
  contentVariant = "panel",
  width = "full",
}: WorkflowPageProps) {
  const inRouterContext = useInRouterContext();
  let backBreadcrumbIndex = -1;
  if (onBack) {
    for (let index = breadcrumbs.length - 1; index >= 0; index -= 1) {
      if (breadcrumbs[index].to) {
        backBreadcrumbIndex = index;
        break;
      }
    }
  }
  const safeBreadcrumbs = inRouterContext
    ? breadcrumbs.map((breadcrumb, index) =>
        index === backBreadcrumbIndex
          ? {
              ...breadcrumb,
              onClick: () => {
                breadcrumb.onClick?.();
                onBack?.();
              },
            }
          : breadcrumb
      )
    : breadcrumbs.map((breadcrumb) => ({ label: breadcrumb.label }));
  const actions = backTo || onBack
    ? [{ label: backLabel, to: inRouterContext ? backTo : undefined, onClick: onBack, variant: "secondary" as const }]
    : [];

  return (
    <div
      className={cx("workflow-page space-y-4", workflowWidthClasses[width], className)}
      data-workflow-width={width}
    >
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={safeBreadcrumbs}
        inlineContent={inlineContent}
        metaContent={metaContent}
        rightContent={rightContent}
        actions={actions}
      />
      <div
        className={cx(
          contentVariant === "panel" && uiPanelClass,
          contentVariant === "panel" && "px-4 py-4 sm:px-6 sm:py-5",
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function workflowPageHostClass(active: boolean, baseClass = "space-y-4"): string {
  return cx(baseClass, active && "workflow-page-host--active [&>.workflow-page]:!mt-0");
}

type WorkflowSurfaceProps = Omit<WorkflowPageProps, "onBack" | "backTo"> & {
  presentation: "modal" | "page";
  onClose: () => void;
  modalMaxWidthClass?: string;
  modalMaxBodyHeightClass?: string;
};

/** Use only when the same bounded form can intentionally be short in one mode
 * and page-sized in another (for example endpoint tags versus full endpoint
 * configuration). */
export function WorkflowSurface({
  presentation,
  onClose,
  modalMaxWidthClass,
  modalMaxBodyHeightClass,
  ...props
}: WorkflowSurfaceProps) {
  if (presentation === "modal") {
    return (
      <Modal
        title={props.title}
        onClose={onClose}
        maxWidthClass={modalMaxWidthClass}
        maxBodyHeightClass={modalMaxBodyHeightClass}
      >
        {props.children}
      </Modal>
    );
  }
  return <WorkflowPage {...props} onBack={onClose} />;
}

type WorkflowSectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function WorkflowSection({ title, description, children, className }: WorkflowSectionProps) {
  return (
    <section className={cx("space-y-3", className)}>
      {title || description ? (
        <header className="space-y-1">
          {title ? <h2 className={cx("ui-subtitle", uiTitleTextClass)}>{title}</h2> : null}
          {description ? <p className={cx("ui-caption leading-5", uiMutedTextClass)}>{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

type WorkflowActionsProps = {
  children: ReactNode;
  className?: string;
};

export function WorkflowActions({ children, className }: WorkflowActionsProps) {
  return (
    <div className={cx("flex flex-wrap items-center justify-end gap-2 border-t pt-4", uiDividerClass, className)}>
      {children}
    </div>
  );
}

type WorkflowMetadataItem = {
  label: string;
  value: ReactNode;
  title?: string;
};

export function WorkflowMetadata({
  items,
  className,
}: {
  items: WorkflowMetadataItem[];
  className?: string;
}) {
  return (
    <dl className={cx("flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1", uiMutedTextClass, className)}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
          <dt className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">{item.label}</dt>
          <dd className="min-w-0 break-all text-xs font-semibold text-[var(--ui-text)]" title={item.title}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
