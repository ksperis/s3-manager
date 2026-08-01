/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useMemo, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import type { IAMGroup } from "../../api/managerIamGroups";
import type { IamPolicy } from "../../api/managerIamPolicies";
import {
  createManagedIAMPrivateAccess,
  createManagedRGWUserPrivateAccess,
  type ManagedInlinePolicy,
} from "../../api/managedPrivateAccess";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import S3ConnectionAccessFields from "../shared/S3ConnectionAccessFields";
import { extractApiError } from "../../utils/apiError";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";

type Props = {
  variant: "iam" | "rgw_user";
  accountId: S3AccountSelector;
  groups?: IAMGroup[];
  policies?: IamPolicy[];
  onClose: () => void;
  onCreated: (connectionName: string) => void;
};

export default function CreateManagedPrivateAccessModal({
  variant,
  accountId,
  groups = [],
  policies = [],
  onClose,
  onCreated,
}: Props) {
  const [connectionName, setConnectionName] = useState("My private access");
  const [accessBrowser, setAccessBrowser] = useState(true);
  const [accessManager, setAccessManager] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [inlinePolicies, setInlinePolicies] = useState<ManagedInlinePolicy[]>([]);
  const [inlineName, setInlineName] = useState("");
  const [inlineDocument, setInlineDocument] = useState('{\n  "Version": "2012-10-17",\n  "Statement": []\n}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = variant === "iam" ? "Create my private access" : "Create my private RGW access";
  const selectedInlineNames = useMemo(() => new Set(inlinePolicies.map((policy) => policy.name)), [inlinePolicies]);

  const addInlinePolicy = () => {
    const name = inlineName.trim();
    if (!name) {
      setError("Inline policy name is required.");
      return;
    }
    if (selectedInlineNames.has(name)) {
      setError("Inline policy names must be unique.");
      return;
    }
    try {
      const parsed = JSON.parse(inlineDocument) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid");
      }
      setInlinePolicies((current) => [...current, { name, document: parsed as Record<string, unknown> }]);
      setInlineName("");
      setError(null);
    } catch {
      setError("Inline policy document must be a JSON object.");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessBrowser && !accessManager) {
      setError("Enable Browser, Manager, or both.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base = {
        connection_name: connectionName.trim(),
        access_browser: accessBrowser,
        access_manager: accessManager,
      };
      const result = variant === "iam"
        ? await createManagedIAMPrivateAccess(accountId, {
            ...base,
            groups: selectedGroups,
            managed_policies: selectedPolicies,
            inline_policies: inlinePolicies,
          })
        : await createManagedRGWUserPrivateAccess(accountId, base);
      notifyExecutionContextsRefresh();
      onCreated(result.connection.name);
      onClose();
    } catch (err) {
      setError(extractApiError(err, "Unable to create managed private access."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} maxWidthClass="max-w-3xl" maxBodyHeightClass="max-h-[80vh]">
      <form className="space-y-4" onSubmit={submit}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        <PageBanner tone="info">
          S3-Manager creates a dedicated identity and private connection on the server. The generated secret is never sent to this browser.
        </PageBanner>
        <label className="block space-y-1">
          <span className="ui-body font-semibold text-[var(--ui-text)]">Connection name</span>
          <input
            aria-label="Connection name"
            value={connectionName}
            onChange={(event) => setConnectionName(event.target.value)}
            className="ui-control w-full px-3 py-2 ui-body"
            required
          />
        </label>

        {variant === "iam" && (
          <>
            <section className="space-y-2">
              <h4 className="ui-body font-semibold text-[var(--ui-text)]">IAM groups</h4>
              <div className="flex flex-wrap gap-3">
                {groups.length === 0 && <span className="ui-caption text-[var(--ui-text-muted)]">No groups available.</span>}
                {groups.map((group) => (
                  <UiCheckboxField
                    key={group.name}
                    checked={selectedGroups.includes(group.name)}
                    onChange={(event) => setSelectedGroups((current) => event.target.checked
                      ? [...current, group.name]
                      : current.filter((name) => name !== group.name))}
                  >
                    {group.name}
                  </UiCheckboxField>
                ))}
              </div>
            </section>
            <section className="space-y-2">
              <h4 className="ui-body font-semibold text-[var(--ui-text)]">Managed policies</h4>
              <div className="flex flex-wrap gap-3">
                {policies.length === 0 && <span className="ui-caption text-[var(--ui-text-muted)]">No policies available.</span>}
                {policies.map((policy) => (
                  <UiCheckboxField
                    key={policy.arn}
                    checked={selectedPolicies.includes(policy.arn)}
                    onChange={(event) => setSelectedPolicies((current) => event.target.checked
                      ? [...current, policy.arn]
                      : current.filter((arn) => arn !== policy.arn))}
                    labelProps={{ title: policy.arn }}
                  >
                    {policy.name}
                  </UiCheckboxField>
                ))}
              </div>
            </section>
            <section className="space-y-2 rounded-lg border border-[color:var(--ui-border)] p-3">
              <h4 className="ui-body font-semibold text-[var(--ui-text)]">Inline policies</h4>
              {inlinePolicies.map((policy) => (
                <div key={policy.name} className="flex items-center justify-between gap-3 ui-caption">
                  <span>{policy.name}</span>
                  <UiButton type="button" variant="ghost" size="xs" onClick={() => setInlinePolicies((current) => current.filter((item) => item.name !== policy.name))}>
                    Remove
                  </UiButton>
                </div>
              ))}
              <input
                aria-label="Inline policy name"
                placeholder="Inline policy name"
                value={inlineName}
                onChange={(event) => setInlineName(event.target.value)}
                className="ui-control w-full px-3 py-2 ui-body"
              />
              <textarea
                aria-label="Inline policy document"
                value={inlineDocument}
                onChange={(event) => setInlineDocument(event.target.value)}
                rows={6}
                className="ui-control w-full px-3 py-2 font-mono ui-caption"
              />
              <UiButton type="button" variant="secondary" size="xs" onClick={addInlinePolicy}>
                Add inline policy
              </UiButton>
            </section>
          </>
        )}

        <S3ConnectionAccessFields
          variant="panel"
          accessBrowser={accessBrowser}
          accessManager={accessManager}
          onAccessBrowserChange={setAccessBrowser}
          onAccessManagerChange={setAccessManager}
          hint="Browser is selected by default. At least one workspace must remain enabled."
        />
        <div className="flex justify-end gap-2">
          <UiButton type="button" variant="secondary" onClick={onClose}>Cancel</UiButton>
          <UiButton type="submit" disabled={busy || !connectionName.trim()}>
            {busy ? "Creating…" : "Create my private access"}
          </UiButton>
        </div>
      </form>
    </Modal>
  );
}
