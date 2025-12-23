/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { S3Account } from "../../api/accounts";
import { S3AccountSelector } from "../../api/accountParams";
import { fetchManagerContext, type ManagerAccessMode } from "../../api/managerContext";
import { listManagerS3Accounts } from "../../api/managerS3Accounts";

type S3AccountContextType = {
  accounts: S3Account[];
  selectedS3AccountId: string | null;
  setSelectedS3AccountId: (id: string | null) => void;
  requiresS3AccountSelection: boolean;
  hasS3AccountContext: boolean;
  accountIdForApi: S3AccountSelector;
  sessionS3AccountName: string | null;
  selectedS3AccountType: string | null;
  accessError?: string | null;
  iamIdentity: string | null;
  accessMode: ManagerAccessMode | null;
  setAccessMode: (mode: ManagerAccessMode) => void;
  canSwitchAccess: boolean;
};

const S3AccountContext = createContext<S3AccountContextType>({
  accounts: [],
  selectedS3AccountId: null,
  setSelectedS3AccountId: () => {},
  requiresS3AccountSelection: true,
  hasS3AccountContext: false,
  accountIdForApi: null,
  sessionS3AccountName: null,
  selectedS3AccountType: null,
  accessError: null,
  iamIdentity: null,
  accessMode: null,
  setAccessMode: () => {},
  canSwitchAccess: false,
});

type SessionInfo = {
  isSession: boolean;
  accountName: string | null;
};

function deriveS3AccountType(account: S3Account | null | undefined): string | null {
  if (!account) return null;
  return account.rgw_account_id ? "tenant" : "s3_user";
}

function readSessionInfo(): SessionInfo {
  if (typeof window === "undefined") {
    return { isSession: false, accountName: null };
  }
  const raw = localStorage.getItem("user");
  if (!raw) {
    return { isSession: false, accountName: null };
  }
  try {
    const parsed = JSON.parse(raw) as { authType?: string | null; accountName?: string | null; accountId?: string | null };
    const isSession = parsed.authType === "rgw_session";
    const accountName = parsed.accountName ?? parsed.accountId ?? null;
    return { isSession, accountName };
  } catch {
    return { isSession: false, accountName: null };
  }
}

export function S3AccountProvider({ children }: { children: ReactNode }) {
  const sessionInfo = useMemo(() => readSessionInfo(), []);
  const requiresS3AccountSelection = !sessionInfo.isSession;
  const [accounts, setS3Accounts] = useState<S3Account[]>([]);
  const [selectedS3AccountId, setSelectedS3AccountId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [iamIdentity, setIamIdentity] = useState<string | null>(null);
  const [accessMode, setAccessModeState] = useState<ManagerAccessMode | null>(null);
  const [canSwitchAccess, setCanSwitchAccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      setAccessError(null);
      try {
        const data = await listManagerS3Accounts();
        setS3Accounts(data);
        if (requiresS3AccountSelection) {
          const stored = localStorage.getItem("selectedS3AccountId");
          if (stored && data.some((a) => a.id === stored)) {
            setSelectedS3AccountId(stored);
            return;
          }
          if (data.length > 0) {
            const nextId = String(data[0].id);
            setSelectedS3AccountId(nextId);
            localStorage.setItem("selectedS3AccountId", nextId);
          }
        } else {
          setSelectedS3AccountId(null);
          localStorage.removeItem("selectedS3AccountId");
        }
      } catch (err) {
        setS3Accounts([]);
        setAccessError("Access to manager is denied for this user.");
      }
    };
    load();
  }, [requiresS3AccountSelection]);

  const updateSelected = (id: string | null) => {
    setSelectedS3AccountId(id);
    if (!requiresS3AccountSelection) {
      return;
    }
    if (id === null) {
      localStorage.removeItem("selectedS3AccountId");
    } else {
      localStorage.setItem("selectedS3AccountId", id);
    }
  };

  const setAccessMode = (mode: ManagerAccessMode) => {
    if (!selectedS3AccountId) return;
    localStorage.setItem(`managerAccessMode:${selectedS3AccountId}`, mode);
    setAccessModeState(mode);
  };

  const selectedS3Account = useMemo(
    () => accounts.find((account) => account.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );

  const hasS3AccountContext = requiresS3AccountSelection ? selectedS3AccountId !== null && selectedS3Account !== undefined : true;
  const accountIdForApi: S3AccountSelector = requiresS3AccountSelection ? selectedS3AccountId : null;
  const selectedS3AccountType = deriveS3AccountType(selectedS3Account);

  useEffect(() => {
    if (!selectedS3AccountId) {
      setAccessModeState(null);
      return;
    }
    const stored = localStorage.getItem(`managerAccessMode:${selectedS3AccountId}`);
    if (stored === "admin" || stored === "portal") {
      setAccessModeState(stored);
    } else {
      setAccessModeState(null);
    }
  }, [selectedS3AccountId]);

  useEffect(() => {
    if (!hasS3AccountContext) {
      setIamIdentity(null);
      setCanSwitchAccess(false);
      return;
    }
    let isMounted = true;
    fetchManagerContext(accountIdForApi)
      .then((data) => {
        if (!isMounted) return;
        setIamIdentity(data.iam_identity ?? null);
        setCanSwitchAccess(Boolean(data.can_switch_access));
        setAccessModeState(data.access_mode);
        if (selectedS3AccountId && (data.access_mode === "admin" || data.access_mode === "portal")) {
          localStorage.setItem(`managerAccessMode:${selectedS3AccountId}`, data.access_mode);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setIamIdentity(null);
        setCanSwitchAccess(false);
      });
    return () => {
      isMounted = false;
    };
  }, [accountIdForApi, hasS3AccountContext, accessMode, selectedS3AccountId]);

  return (
    <S3AccountContext.Provider
      value={{
        accounts,
        selectedS3AccountId,
        setSelectedS3AccountId: updateSelected,
        requiresS3AccountSelection,
        hasS3AccountContext,
        accountIdForApi,
        sessionS3AccountName: sessionInfo.accountName,
        selectedS3AccountType,
        accessError,
        iamIdentity,
        accessMode,
        setAccessMode,
        canSwitchAccess,
      }}
    >
      {children}
    </S3AccountContext.Provider>
  );
}

export function useS3AccountContext() {
  return useContext(S3AccountContext);
}
