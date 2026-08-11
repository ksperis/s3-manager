/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useMemo, useRef, useState } from "react";

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
import UiDetails from "../../components/ui/UiDetails";
import { cx, uiMutedTextClass, uiPanelMutedClass } from "../../components/ui/styles";
import S3ConnectionAccessFields from "../shared/S3ConnectionAccessFields";
import { extractApiError } from "../../utils/apiError";
import { notifyExecutionContextsRefresh } from "../../utils/executionContextRefresh";

const AMAZON_S3_FULL_ACCESS_POLICY_ARN = "arn:aws:iam::aws:policy/AmazonS3FullAccess";

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
  const connectionNameRef = useRef<HTMLInputElement | null>(null);
  const [connectionName, setConnectionName] = useState("My private access");
  const [accessBrowser, setAccessBrowser] = useState(true);
  const [accessManager, setAccessManager] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>(
    variant === "iam" ? [AMAZON_S3_FULL_ACCESS_POLICY_ARN] : []
  );
  const [inlinePolicies, setInlinePolicies] = useState<ManagedInlinePolicy[]>([]);
  const [inlineName, setInlineName] = useState("");
  const [inlineDocument, setInlineDocument] = useState('{\n  "Version": "2012-10-17",\n  "Statement": []\n}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = variant === "iam" ? "Create my private access" : "Create my private RGW access";
  const selectedInlineNames = useMemo(() => new Set(inlinePolicies.map((policy) => policy.name)), [inlinePolicies]);
  const availablePolicies = useMemo(
    () => policies.some((policy) => policy.arn === AMAZON_S3_FULL_ACCESS_POLICY_ARN)
      ? policies
      : [
          { name: "AmazonS3FullAccess", arn: AMAZON_S3_FULL_ACCESS_POLICY_ARN },
          ...policies,
        ],
    [policies]
  );
  const usesDefaultConfiguration = accessBrowser
    && !accessManager
    && (
      variant === "rgw_user"
      || (
        selectedGroups.length === 0
        && selectedPolicies.length === 1
        && selectedPolicies[0] === AMAZON_S3_FULL_ACCESS_POLICY_ARN
        && inlinePolicies.length === 0
      )
    );

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
    <Modal
      title={title}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      maxBodyHeightClass="max-h-[80vh]"
      initialFocusRef={connectionNameRef}
    >
      <form className="space-y-4" onSubmit={submit}>
        {error && <PageBanner tone="error">{error}</PageBanner>}
        <PageBanner tone="info">
          {variant === "iam"
            ? usesDefaultConfiguration
              ? "S3-Manager creates a dedicated IAM user with AmazonS3FullAccess and a private connection for Browser. The generated secret is stored only on the server and is never sent to this browser."
              : "S3-Manager creates a dedicated IAM user and private connection using the advanced configuration below. The generated secret is stored only on the server and is never sent to this browser."
            : usesDefaultConfiguration
              ? "S3-Manager creates a new access key for this RGW user and stores it in a private connection for Browser. The generated secret is stored only on the server and is never sent to this browser."
              : "S3-Manager creates a new access key for this RGW user and stores it in a private connection using the advanced configuration below. The generated secret is stored only on the server and is never sent to this browser."}
        </PageBanner>
        <label className="block space-y-1">
          <span className="ui-body font-semibold text-[var(--ui-text)]">Connection name</span>
          <input
            ref={connectionNameRef}
            aria-label="Connection name"
            value={connectionName}
            onChange={(event) => setConnectionName(event.target.value)}
            className="ui-control w-full px-3 py-2 ui-body"
            required
          />
        </label>

        <UiDetails className={cx("group", uiPanelMutedClass)}>
          <summary className="cursor-pointer px-3 py-3 ui-body font-semibold text-[var(--ui-text)]">
            Advanced configuration
            {!usesDefaultConfiguration && (
              <span className={cx("ml-2 ui-caption font-normal", uiMutedTextClass)}>Customized</span>
            )}
          </summary>
          <div className="space-y-4 border-t border-[color:var(--ui-border-soft)] px-3 py-3">
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
                    {availablePolicies.map((policy) => (
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
              accessBrowser={accessBrowser}
              accessManager={accessManager}
              onAccessBrowserChange={setAccessBrowser}
              onAccessManagerChange={setAccessManager}
              hint="Browser is selected by default. At least one workspace must remain enabled."
            />
          </div>
        </UiDetails>
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
