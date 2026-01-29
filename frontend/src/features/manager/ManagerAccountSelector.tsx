/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ExecutionContext } from "../../api/executionContexts";

type Props = {
  accounts: ExecutionContext[];
  selectedS3AccountId: string | null;
  onChange: (id: string | null) => void;
};

function isS3UserId(id: string | null): boolean {
  if (!id) return false;
  return id.startsWith("s3u-") || (!id.startsWith("s3u-") && !id.match(/^\d+$/));
}

export default function ManagerS3AccountSelector({ accounts, selectedS3AccountId, onChange }: Props) {
  const isS3Selection = isS3UserId(selectedS3AccountId);
  return (
    <div className="flex items-center gap-2">
      <label className="ui-body font-medium text-slate-700 dark:text-slate-200">
        {isS3Selection ? "User" : "S3Account"}
      </label>
      <select
        className="rounded-md border border-slate-200 bg-white px-3 py-2 ui-body text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        value={selectedS3AccountId ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Select account</option>
        {accounts.map((acc) => (
          <option key={acc.id} value={acc.id}>
            {acc.display_name}
          </option>
        ))}
      </select>
    </div>
  );
}
