/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  createTopic,
  deleteTopic,
  getTopicConfiguration,
  getTopicPolicy,
  listTopics,
  updateTopicConfiguration,
  updateTopicPolicy,
  Topic,
} from "../../api/topics";
import ListToolbar from "../../components/ListToolbar";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import Modal from "../../components/Modal";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmDeletion } from "../../utils/confirm";
import { useS3AccountContext } from "./S3AccountContext";

const defaultPolicyTemplate = `{
  "Version": "2012-10-17",
  "Statement": []
}`;

type AttributeDraft = {
  key: string;
  value: string;
};

const PRIMARY_ATTRIBUTE_KEYS = new Set(["push-endpoint", "verify-ssl"]);

const formatAttributeValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseAttributeValue = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: "" };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { value: JSON.parse(trimmed) };
    } catch {
      return { value: null, error: "JSON values must be valid objects or arrays." };
    }
  }
  return { value: raw };
};

const buildAttributeDrafts = (configuration: Record<string, unknown> | null | undefined): AttributeDraft[] => {
  return Object.entries(configuration ?? {})
    .filter(([key]) => !PRIMARY_ATTRIBUTE_KEYS.has(key))
    .map(([key, value]) => ({ key, value: formatAttributeValue(value) }));
};

export default function TopicsPage() {
  const {
    accounts,
    selectedS3AccountId,
    accountIdForApi,
    requiresS3AccountSelection,
    sessionS3AccountName,
    accessMode,
  } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const selectedS3Account = useMemo(() => {
    const accountKey = accountIdForApi ?? selectedS3AccountId;
    if (accountKey == null) return undefined;
    return accounts.find((account) => String(account.id) === String(accountKey));
  }, [accounts, accountIdForApi, selectedS3AccountId]);
  const endpointCaps = selectedS3Account?.storage_endpoint_capabilities ?? null;
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const accountLabel = selectedS3Account?.display_name ?? sessionS3AccountName ?? "Current account";
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyTopicArn, setPolicyTopicArn] = useState<string | null>(null);
  const [policyTopicName, setPolicyTopicName] = useState<string | null>(null);
  const [policyText, setPolicyText] = useState(defaultPolicyTemplate);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyStatus, setPolicyStatus] = useState<string | null>(null);
  const [showPolicyExample, setShowPolicyExample] = useState(false);
  const [attributesModalOpen, setAttributesModalOpen] = useState(false);
  const [attributesTopicArn, setAttributesTopicArn] = useState<string | null>(null);
  const [attributesTopicName, setAttributesTopicName] = useState<string | null>(null);
  const [pushEndpointValue, setPushEndpointValue] = useState("");
  const [verifySslValue, setVerifySslValue] = useState(true);
  const [attributeItems, setAttributeItems] = useState<AttributeDraft[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesSaving, setAttributesSaving] = useState(false);
  const [attributesError, setAttributesError] = useState<string | null>(null);
  const [attributesStatus, setAttributesStatus] = useState<string | null>(null);

  const extractError = (err: unknown): string => {
    if (axios.isAxiosError(err)) {
      return (
        (err.response?.data as { detail?: string })?.detail ||
        err.message ||
        "Unexpected error"
      );
    }
    return err instanceof Error ? err.message : "Unexpected error";
  };

  const applyAttributesConfiguration = (configuration: Record<string, unknown> | null | undefined) => {
    const config = configuration ?? {};
    const pushEndpoint =
      typeof config["push-endpoint"] === "string" ? (config["push-endpoint"] as string) : "";
    const verifySsl =
      typeof config["verify-ssl"] === "boolean" ? Boolean(config["verify-ssl"]) : true;

    setPushEndpointValue(pushEndpoint);
    setVerifySslValue(verifySsl);
    setAttributeItems(buildAttributeDrafts(config));
  };

  const fetchTopics = async (accountId: number | string | null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTopics(accountId);
      setTopics(data);
    } catch (err) {
      setTopics([]);
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (needsS3AccountSelection) {
      setTopics([]);
      setLoading(false);
      return;
    }
    fetchTopics(accountIdForApi);
  }, [accountIdForApi, needsS3AccountSelection, accessMode]);

  const openCreateModal = () => {
    setShowCreateModal(true);
    setCreateError(null);
  };

  const handleCreateTopic = async (event: FormEvent) => {
    event.preventDefault();
    if (needsS3AccountSelection) return;
    const trimmedName = newTopicName.trim();
    if (!trimmedName) {
      setCreateError("Topic name is required.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      await createTopic(accountIdForApi, {
        name: trimmedName,
      });
      setShowCreateModal(false);
      setNewTopicName("");
      setActionMessage(`Topic '${trimmedName}' created.`);
      await fetchTopics(accountIdForApi);
    } catch (err) {
      setCreateError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTopic = async (topicArn: string, name: string) => {
    if (needsS3AccountSelection) return;
    if (!confirmDeletion("topic", name)) return;
    try {
      await deleteTopic(accountIdForApi, topicArn);
      setActionMessage(`Topic '${name}' deleted.`);
      await fetchTopics(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    }
  };

  const openPolicyModal = async (topicArn: string, name: string) => {
    if (needsS3AccountSelection) return;
    setPolicyModalOpen(true);
    setPolicyTopicArn(topicArn);
    setPolicyTopicName(name);
    setPolicyText(defaultPolicyTemplate);
    setPolicyError(null);
    setPolicyStatus(null);
    setShowPolicyExample(false);
    setPolicyLoading(true);
    try {
      const data = await getTopicPolicy(accountIdForApi, topicArn);
      const policy = data.policy ?? {};
      setPolicyText(Object.keys(policy).length > 0 ? JSON.stringify(policy, null, 2) : defaultPolicyTemplate);
    } catch (err) {
      setPolicyError(extractError(err));
    } finally {
      setPolicyLoading(false);
    }
  };

  const savePolicy = async () => {
    if (needsS3AccountSelection || !policyTopicArn) return;
    let parsed: Record<string, unknown>;
    setPolicyError(null);
    setPolicyStatus(null);
    try {
      parsed = policyText.trim() ? JSON.parse(policyText) : {};
    } catch {
      setPolicyError("Policy must be valid JSON.");
      return;
    }
    setPolicySaving(true);
    try {
      await updateTopicPolicy(accountIdForApi, policyTopicArn, parsed);
      setPolicyStatus("Policy updated.");
    } catch (err) {
      setPolicyError(extractError(err));
    } finally {
      setPolicySaving(false);
    }
  };

  const closePolicyModal = () => {
    setPolicyModalOpen(false);
    setPolicyTopicArn(null);
    setPolicyTopicName(null);
    setPolicyStatus(null);
    setPolicyError(null);
    setShowPolicyExample(false);
  };

  const openAttributesModal = (topic: Topic) => {
    if (needsS3AccountSelection) return;
    setAttributesModalOpen(true);
    setAttributesTopicArn(topic.arn);
    setAttributesTopicName(topic.name);
    setAttributesError(null);
    setAttributesStatus(null);
    applyAttributesConfiguration(topic.configuration ?? {});
    setAttributesLoading(true);
    (async () => {
      try {
        const data = await getTopicConfiguration(accountIdForApi, topic.arn);
        applyAttributesConfiguration(data.configuration ?? {});
      } catch (err) {
        setAttributesError(extractError(err));
      } finally {
        setAttributesLoading(false);
      }
    })();
  };

  const saveAttributes = async () => {
    if (needsS3AccountSelection || !attributesTopicArn) return;
    setAttributesError(null);
    setAttributesStatus(null);
    const configuration: Record<string, unknown> = {};
    const trimmedEndpoint = pushEndpointValue.trim();
    if (trimmedEndpoint) {
      configuration["push-endpoint"] = trimmedEndpoint;
    }
    if (!verifySslValue) {
      configuration["verify-ssl"] = false;
    }

    const seenKeys = new Set<string>();
    for (const item of attributeItems) {
      const key = item.key.trim();
      const rawValue = item.value ?? "";
      const hasValue = rawValue.trim().length > 0;
      if (!key) {
        if (hasValue) {
          setAttributesError("Attribute name is required when a value is provided.");
          return;
        }
        continue;
      }
      if (PRIMARY_ATTRIBUTE_KEYS.has(key)) {
        setAttributesError("Use the dedicated fields for push-endpoint and verify-ssl.");
        return;
      }
      if (seenKeys.has(key)) {
        setAttributesError(`Duplicate attribute key: ${key}.`);
        return;
      }
      const parsed = parseAttributeValue(rawValue);
      if (parsed.error) {
        setAttributesError(`${parsed.error} (${key}).`);
        return;
      }
      configuration[key] = parsed.value;
      seenKeys.add(key);
    }

    setAttributesSaving(true);
    try {
      const updated = await updateTopicConfiguration(accountIdForApi, attributesTopicArn, configuration);
      const newConfig = updated.configuration ?? {};
      applyAttributesConfiguration(newConfig);
      setAttributesStatus("Attributes updated.");
      setTopics((prev) =>
        prev.map((topic) =>
          topic.arn === attributesTopicArn ? { ...topic, configuration: newConfig } : topic
        )
      );
    } catch (err) {
      setAttributesError(extractError(err));
    } finally {
      setAttributesSaving(false);
    }
  };

  const closeAttributesModal = () => {
    setAttributesModalOpen(false);
    setAttributesTopicArn(null);
    setAttributesTopicName(null);
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributesLoading(false);
    setAttributesSaving(false);
    setPushEndpointValue("");
    setVerifySslValue(true);
    setAttributeItems([]);
  };

  const handlePushEndpointChange = (value: string) => {
    setPushEndpointValue(value);
  };

  const handleVerifySslChange = (checked: boolean) => {
    setVerifySslValue(checked);
  };

  const handleAttributeKeyChange = (index: number, value: string) => {
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributeItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, key: value } : item))
    );
  };

  const handleAttributeValueChange = (index: number, value: string) => {
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributeItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, value } : item))
    );
  };

  const handleAddAttribute = () => {
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributeItems((prev) => [...prev, { key: "", value: "" }]);
  };

  const handleRemoveAttribute = (index: number) => {
    setAttributesStatus(null);
    setAttributesError(null);
    setAttributeItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const filteredTopics = useMemo(() => {
    const needle = topicFilter.trim().toLowerCase();
    if (!needle) return topics;
    return topics.filter((topic) => topic.name.toLowerCase().includes(needle) || topic.arn.toLowerCase().includes(needle));
  }, [topicFilter, topics]);
  const filteredTableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredTopics.length,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="SNS Topics"
        description="List, create, and secure account-owned SNS topics."
        breadcrumbs={[{ label: "Manager" }, { label: "Events" }, { label: "SNS Topics" }]}
        actions={
          !needsS3AccountSelection && snsFeatureEnabled
            ? [
                {
                  label: "Create topic",
                  onClick: openCreateModal,
                },
              ]
            : []
        }
      />

      {actionMessage && (
        <PageBanner tone="success" className="flex items-center justify-between">
          <span>{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="ui-caption font-semibold text-emerald-900 underline dark:text-emerald-100"
          >
            Dismiss
          </button>
        </PageBanner>
      )}

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before managing SNS topics"
          description="SNS topics are created within an execution context. Choose an account to list topics, review subscriptions, and update notification settings."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !snsFeatureEnabled ? (
        <PageEmptyState
          title="SNS topics are disabled for this endpoint"
          description="Enable the SNS capability on the selected storage endpoint before creating or managing topic-based bucket notifications."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Topics"
            description={`${accountLabel} · Topic inventory, subscriptions, attributes, and policies.`}
            countLabel={`${filteredTopics.length} result(s)`}
            search={
              <input
                type="text"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder="Search by topic name or ARN"
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-72 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            }
          />
          <div className="overflow-x-auto">
            <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Topic</th>
                  <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Subscriptions</th>
                  <th className="px-6 py-3 text-right ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredTableStatus === "loading" && <TableEmptyState colSpan={3} message="Loading topics..." />}
                {filteredTableStatus === "error" && <TableEmptyState colSpan={3} message="Unable to load topics." tone="error" />}
                {filteredTableStatus === "empty" && <TableEmptyState colSpan={3} message="No topics." />}
                {filteredTopics.map((topic) => (
                    <tr key={topic.arn} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="manager-table-cell-wide px-6 py-4">
                        <div className="flex flex-col">
                          <span className="ui-body font-semibold text-slate-900 dark:text-slate-100">{topic.name}</span>
                          <span className="ui-caption font-mono text-slate-500 dark:text-slate-400">{topic.arn}</span>
                        </div>
                      </td>
                      <td className="manager-table-cell px-6 py-4 ui-caption text-slate-600 dark:text-slate-300">
                        <div>Confirmed: {topic.subscriptions_confirmed ?? 0}</div>
                        <div>Pending: {topic.subscriptions_pending ?? 0}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            className={tableActionButtonClasses}
                            onClick={() => openAttributesModal(topic)}
                          >
                            Attributes
                          </button>
                          <button
                            type="button"
                            className={tableActionButtonClasses}
                            onClick={() => openPolicyModal(topic.arn, topic.name)}
                          >
                            Policy
                          </button>
                          <button
                            type="button"
                            className={tableDeleteActionClasses}
                            onClick={() => handleDeleteTopic(topic.arn, topic.name)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreateModal && (
        <Modal title="Create SNS topic" onClose={() => setShowCreateModal(false)}>
          <form className="space-y-4" onSubmit={handleCreateTopic}>
            <div className="space-y-1">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-100">Topic name</label>
              <input
                type="text"
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="events-topic"
              />
            </div>
            {createError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                {createError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create topic"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {attributesModalOpen && (
        <Modal title={`Topic attributes · ${attributesTopicName ?? ""}`} onClose={closeAttributesModal}>
          <div className="space-y-4">
            {attributesError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                {attributesError}
              </div>
            )}
            {attributesStatus && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                {attributesStatus}
              </div>
            )}
            <div className="space-y-1">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-100">Push endpoint URL</label>
              <input
                type="text"
                value={pushEndpointValue}
                onChange={(e) => {
                  setAttributesStatus(null);
                  setAttributesError(null);
                  handlePushEndpointChange(e.target.value);
                }}
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="https://example.com/webhook"
                disabled={attributesLoading}
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Provide the HTTPS endpoint that should receive SNS push notifications.
              </p>
            </div>
            <div className="space-y-1">
              <label className="inline-flex items-center gap-2 ui-body font-semibold text-slate-700 dark:text-slate-100">
                <input
                  type="checkbox"
                  className={uiCheckboxClass}
                  checked={verifySslValue}
                  onChange={(e) => {
                    setAttributesStatus(null);
                    setAttributesError(null);
                    handleVerifySslChange(e.target.checked);
                  }}
                  disabled={attributesLoading}
                />
                Verify SSL certificates
              </label>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Disable verification only when testing against endpoints that use self-signed certificates.
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              <div className="flex items-center justify-between">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Additional attributes
                </p>
                <button
                  type="button"
                  onClick={handleAddAttribute}
                  disabled={attributesLoading}
                  className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-600 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100"
                >
                  Add attribute
                </button>
              </div>
              {attributeItems.length === 0 ? (
                <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                  No additional attributes defined.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {attributeItems.map((item, idx) => (
                    <div key={`${item.key}-${idx}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <input
                        type="text"
                        value={item.key}
                        onChange={(e) => handleAttributeKeyChange(idx, e.target.value)}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="attribute-key"
                        disabled={attributesLoading}
                      />
                      <input
                        type="text"
                        value={item.value}
                        onChange={(e) => handleAttributeValueChange(idx, e.target.value)}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder='value or JSON ({"key":"value"})'
                        disabled={attributesLoading}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveAttribute(idx)}
                        disabled={attributesLoading}
                        className="rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-600 hover:border-rose-400 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                Paste JSON for object/array values; remove a row to clear an attribute.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeAttributesModal}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
              <button
                type="button"
                onClick={saveAttributes}
                disabled={attributesSaving || attributesLoading}
                className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {attributesSaving ? "Saving..." : "Save attributes"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {policyModalOpen && (
        <Modal title={`Topic policy · ${policyTopicName ?? ""}`} onClose={closePolicyModal}>
          <div className="space-y-3">
            {policyError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                {policyError}
              </div>
            )}
            {policyStatus && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                {policyStatus}
              </div>
            )}
            <textarea
              value={policyText}
              onChange={(e) => {
                setPolicyText(e.target.value);
                setPolicyStatus(null);
              }}
              className="h-72 w-full rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder={defaultPolicyTemplate}
              spellCheck={false}
              disabled={policyLoading}
            />
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPolicyExample((prev) => !prev)}
                  className="ui-caption font-semibold text-primary hover:text-primary-700 dark:text-primary-200 dark:hover:text-primary-100"
                >
                  {showPolicyExample ? "Hide example" : "Show example"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const topicArn = policyTopicArn ?? "arn:aws:sns:default:::topic";
                    const sample = {
                      Version: "2012-10-17",
                      Statement: [
                        {
                          Sid: "AllowBucketNotifications",
                          Effect: "Allow",
                          Principal: "*",
                          Action: "sns:Publish",
                          Resource: topicArn,
                          Condition: {
                            ArnLike: {
                              "aws:SourceArn": "arn:aws:s3:::example-bucket",
                            },
                          },
                        },
                      ],
                    };
                    setPolicyText(JSON.stringify(sample, null, 2));
                    setShowPolicyExample(true);
                    setPolicyStatus(null);
                  }}
                  className="rounded-full border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100"
                >
                  Use example
                </button>
              </div>
              {showPolicyExample && (
                <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 px-3 py-2 ui-caption text-slate-100">
{`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBucketNotifications",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "sns:Publish",
      "Resource": "${policyTopicArn ?? "arn:aws:sns:default:::topic"}",
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": "arn:aws:s3:::example-bucket"
        }
      }
    }
  ]
}`}
                </pre>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closePolicyModal}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
              <button
                type="button"
                onClick={savePolicy}
                disabled={policySaving || policyLoading}
                className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {policySaving ? "Saving..." : "Save policy"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
