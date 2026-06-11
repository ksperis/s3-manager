/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { MetricsCard } from "./MetricsCard";
import PageBanner from "./PageBanner";

type MetricsUnavailableCardProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  message: ReactNode;
  tone?: "info" | "warning" | "error";
  className?: string;
};

export default function MetricsUnavailableCard({
  eyebrow,
  title,
  description,
  message,
  tone = "info",
  className,
}: MetricsUnavailableCardProps) {
  return (
    <MetricsCard eyebrow={eyebrow} title={title} description={description} className={className}>
      <PageBanner tone={tone}>{message}</PageBanner>
    </MetricsCard>
  );
}
