/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type TableEmptyStateProps = {
  colSpan?: number;
  message?: string;
};

export default function TableEmptyState({ colSpan = 1, message = "No data available." }: TableEmptyStateProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
        {message}
      </td>
    </tr>
  );
}
