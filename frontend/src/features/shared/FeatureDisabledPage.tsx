/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";

type FeatureDisabledPageProps = {
  feature: string;
};

export default function FeatureDisabledPage({ feature }: FeatureDisabledPageProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 text-center text-white">
      <h1 className="text-3xl font-semibold">{feature} disabled</h1>
      <p className="mt-2 max-w-xl text-slate-200">
        This feature has been disabled by an administrator. Contact your admin if you need access restored.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          to="/"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm transition hover:bg-slate-100"
        >
          Back to home
        </Link>
        <Link
          to="/login"
          className="rounded-md border border-white/60 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
        >
          Switch account
        </Link>
      </div>
    </div>
  );
}
