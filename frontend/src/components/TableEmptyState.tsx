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
      <td colSpan={colSpan} className="px-4 py-3 ui-caption text-slate-500 dark:text-slate-300">
        {message}
      </td>
    </tr>
  );
}
