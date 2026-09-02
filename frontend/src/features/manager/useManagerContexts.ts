/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import {
  listExecutionContexts,
  type ExecutionContext,
} from "../../api/executionContexts";
import { extractApiError } from "../../utils/apiError";

export function useManagerContexts() {
  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(true);
  const [contextsError, setContextsError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setContextsLoading(true);
    setContextsError(null);
    listExecutionContexts("manager")
      .then((items) => {
        if (!canceled) setContexts(items);
      })
      .catch((error) => {
        if (!canceled) {
          setContextsError(extractApiError(error, "Request failed"));
        }
      })
      .finally(() => {
        if (!canceled) setContextsLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  const contextLabelById = useMemo(
    () =>
      new Map(
        contexts.map((context) => [context.id, context.display_name] as const)
      ),
    [contexts]
  );

  return {
    contexts,
    contextLabelById,
    contextsLoading,
    contextsError,
  };
}
