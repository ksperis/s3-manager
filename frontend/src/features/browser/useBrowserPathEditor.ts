/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  listBrowserObjects,
  type BrowserRequestOptions,
} from "../../api/browser";
import {
  buildPathSuggestionEntries,
  mergePathSuggestions,
  normalizePathDraftValue,
  resolvePathDraftContext,
  type PathSuggestion,
} from "./browserPathSuggestions";
import { normalizePrefix } from "./browserUtils";

const PATH_SUGGESTIONS_DEBOUNCE_MS = 200;
const PATH_SUGGESTIONS_API_LIMIT = 50;

type UseBrowserPathEditorOptions = {
  accountId: S3AccountSelector;
  bucketName: string;
  enabled: boolean;
  history: string[];
  localPrefixes: string[];
  onCommit: (prefix: string) => void;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
};

export function useBrowserPathEditor({
  accountId,
  bucketName,
  enabled,
  history,
  localPrefixes,
  onCommit,
  prefix,
  requestOptions,
}: UseBrowserPathEditorOptions) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const activeSuggestion = useMemo(
    () =>
      activeSuggestionIndex >= 0 &&
      activeSuggestionIndex < suggestions.length
        ? suggestions[activeSuggestionIndex]
        : null,
    [activeSuggestionIndex, suggestions],
  );

  const cancelPendingSuggestions = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    requestIdRef.current += 1;
  }, []);

  const clearSuggestions = useCallback(() => {
    cancelPendingSuggestions();
    setSuggestions([]);
    setSuggestionsLoading(false);
    setActiveSuggestionIndex(-1);
  }, [cancelPendingSuggestions]);

  const startEditing = useCallback(() => {
    if (!bucketName) return;
    setValue(prefix);
    setActiveSuggestionIndex(-1);
    setEditing(true);
  }, [bucketName, prefix]);

  const commitPrefix = useCallback(
    (nextPrefix: string) => {
      clearSuggestions();
      setValue(nextPrefix);
      setEditing(false);
      if (nextPrefix !== prefix) {
        onCommit(nextPrefix);
      }
    },
    [clearSuggestions, onCommit, prefix],
  );

  const commit = useCallback(() => {
    const trimmed = normalizePathDraftValue(value);
    commitPrefix(trimmed ? normalizePrefix(trimmed) : "");
  }, [commitPrefix, value]);

  const cancel = useCallback(() => {
    clearSuggestions();
    setValue(prefix);
    setEditing(false);
  }, [clearSuggestions, prefix]);

  const applySuggestion = useCallback(
    (suggestion: PathSuggestion, options?: { commit?: boolean }) => {
      const nextPrefix = suggestion.value
        ? normalizePrefix(suggestion.value)
        : "";
      setValue(nextPrefix);
      setActiveSuggestionIndex(-1);
      if (options?.commit) {
        commitPrefix(nextPrefix);
      }
    },
    [commitPrefix],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        if (suggestions.length === 0) return;
        event.preventDefault();
        setActiveSuggestionIndex((current) =>
          current < suggestions.length - 1 ? current + 1 : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        if (suggestions.length === 0) return;
        event.preventDefault();
        setActiveSuggestionIndex((current) =>
          current > 0 ? current - 1 : suggestions.length - 1,
        );
        return;
      }
      if (event.key === "Tab" && activeSuggestion) {
        event.preventDefault();
        applySuggestion(activeSuggestion);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (activeSuggestion) {
          applySuggestion(activeSuggestion, { commit: true });
          return;
        }
        commit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    },
    [activeSuggestion, applySuggestion, cancel, commit, suggestions.length],
  );

  useEffect(() => {
    clearSuggestions();
    setValue(prefix);
    setEditing(false);
  }, [accountId, bucketName, clearSuggestions, prefix]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing || !bucketName || !enabled) {
      clearSuggestions();
      return;
    }

    const { parentPrefix, fragment } = resolvePathDraftContext(value);
    const localCandidates =
      parentPrefix === normalizePrefix(prefix) ? localPrefixes : [];
    const localSuggestions = buildPathSuggestionEntries(
      localCandidates,
      parentPrefix,
      fragment,
      "local",
    );
    const historySuggestions = buildPathSuggestionEntries(
      history,
      parentPrefix,
      fragment,
      "history",
    );
    const localOnlySuggestions = mergePathSuggestions(
      fragment,
      historySuggestions,
      localSuggestions,
    );
    setSuggestions(localOnlySuggestions);
    setActiveSuggestionIndex(-1);

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSuggestionsLoading(true);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      listBrowserObjects(accountId, bucketName, {
        prefix: parentPrefix,
        query: fragment || undefined,
        type: "folder",
        maxKeys: PATH_SUGGESTIONS_API_LIMIT,
        ...requestOptions,
      })
        .then((data) => {
          if (requestIdRef.current !== requestId) return;
          const remoteSuggestions = buildPathSuggestionEntries(
            data.prefixes || [],
            parentPrefix,
            fragment,
            "remote",
          );
          setSuggestions(
            mergePathSuggestions(
              fragment,
              historySuggestions,
              localSuggestions,
              remoteSuggestions,
            ),
          );
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setSuggestions(localOnlySuggestions);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) {
            setSuggestionsLoading(false);
          }
        });
    }, PATH_SUGGESTIONS_DEBOUNCE_MS);

    return () => {
      cancelPendingSuggestions();
    };
  }, [
    accountId,
    bucketName,
    cancelPendingSuggestions,
    clearSuggestions,
    editing,
    enabled,
    history,
    localPrefixes,
    prefix,
    requestOptions,
    value,
  ]);

  useEffect(() => {
    if (suggestions.length === 0 && activeSuggestionIndex !== -1) {
      setActiveSuggestionIndex(-1);
      return;
    }
    if (activeSuggestionIndex >= suggestions.length) {
      setActiveSuggestionIndex(suggestions.length - 1);
    }
  }, [activeSuggestionIndex, suggestions.length]);

  return {
    activeSuggestionIndex,
    applySuggestion,
    cancel,
    commit,
    editing,
    handleKeyDown,
    inputRef,
    setActiveSuggestionIndex,
    setValue,
    startEditing,
    suggestions,
    suggestionsLoading,
    value,
  };
}
