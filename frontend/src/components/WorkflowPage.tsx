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
  backLabel?: string;
  backTo?: string;
  onBack?: () => void;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  contentVariant?: "panel" | "plain";
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
  backLabel = "Back",
  backTo,
  onBack,
  children,
  className,
  contentClassName,
  contentVariant = "panel",
}: WorkflowPageProps) {
  const inRouterContext = useInRouterContext();
  const safeBreadcrumbs = inRouterContext
    ? breadcrumbs
    : breadcrumbs.map((breadcrumb) => ({ label: breadcrumb.label }));
  const actions = backTo || onBack
    ? [{ label: backLabel, to: inRouterContext ? backTo : undefined, onClick: onBack, variant: "secondary" as const }]
    : [];

  return (
    <div className={cx("workflow-page space-y-4", className)}>
      <PageHeader title={title} description={description} breadcrumbs={safeBreadcrumbs} actions={actions} />
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
  return cx(baseClass, active && "workflow-page-host--active");
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
