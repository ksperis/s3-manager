/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import FullPageStatus from "../../components/FullPageStatus";

type FeatureDisabledPageProps = {
  feature: string;
};

export default function FeatureDisabledPage({ feature }: FeatureDisabledPageProps) {
  return (
    <FullPageStatus
      title={`${feature} disabled`}
      description="This feature has been disabled by an administrator. Contact your admin if you need access restored."
      primaryAction={{ label: "Back to home", to: "/", variant: "primary" }}
      secondaryAction={{ label: "Switch account", to: "/login" }}
    />
  );
}
