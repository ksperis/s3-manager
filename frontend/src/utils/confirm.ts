/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export function confirmDeletion(entity: string, name: string): boolean {
  return window.confirm(`Delete ${entity} '${name}'?`);
}

export function confirmAction(message: string): boolean {
  return window.confirm(message);
}
