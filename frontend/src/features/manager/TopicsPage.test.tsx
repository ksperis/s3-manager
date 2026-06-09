import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TopicsPage from "./TopicsPage";

const useS3AccountContextMock = vi.fn();
const listTopicsMock = vi.fn();
const getTopicConfigurationMock = vi.fn();
const updateTopicConfigurationMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/topics", async () => {
  const actual = await vi.importActual<typeof import("../../api/topics")>("../../api/topics");
  return {
    ...actual,
    listTopics: (...args: unknown[]) => listTopicsMock(...args),
    createTopic: vi.fn(),
    deleteTopic: vi.fn(),
    getTopicConfiguration: (...args: unknown[]) => getTopicConfigurationMock(...args),
    getTopicPolicy: vi.fn(),
    updateTopicConfiguration: (...args: unknown[]) => updateTopicConfigurationMock(...args),
    updateTopicPolicy: vi.fn(),
  };
});

describe("TopicsPage", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listTopicsMock.mockReset();
    getTopicConfigurationMock.mockReset();
    updateTopicConfigurationMock.mockReset();
    useS3AccountContextMock.mockReturnValue({
      accounts: [],
      selectedS3AccountId: null,
      accountIdForApi: null,
      requiresS3AccountSelection: true,
      sessionS3AccountName: null,
      accessMode: "default",
      iamIdentity: null,
    });
    listTopicsMock.mockResolvedValue([]);
    getTopicConfigurationMock.mockResolvedValue({ configuration: {} });
    updateTopicConfigurationMock.mockImplementation(
      async (_accountId: unknown, _topicArn: unknown, configuration: Record<string, unknown>) => ({ configuration })
    );
  });

  it("shows an empty state without a page-level context strip when no account is selected", () => {
    render(
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Select an account before managing SNS topics")).toBeInTheDocument();
    expect(screen.queryByText("Execution context")).not.toBeInTheDocument();
    expect(screen.queryByText("Select an account to manage its topics.")).not.toBeInTheDocument();
  });

  it("loads normalized Ceph topic configuration into the attributes modal and saves the edited payload", async () => {
    const user = userEvent.setup();
    const topicArn = "arn:aws:sns:us-east-1:lab:topic-events";
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: 7,
          display_name: "Lab account",
          storage_endpoint_capabilities: { sns: true },
        },
      ],
      selectedS3AccountId: 7,
      accountIdForApi: 7,
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      accessMode: "default",
      iamIdentity: null,
    });
    listTopicsMock.mockResolvedValue([
      {
        name: "topic-events",
        arn: topicArn,
        subscriptions_confirmed: 1,
        subscriptions_pending: 0,
        configuration: { "verify-ssl": "false" },
      },
    ]);
    getTopicConfigurationMock.mockResolvedValue({
      configuration: {
        "push-endpoint": "https://notify.example.test/hooks/current",
        "verify-ssl": "false",
        OpaqueData: "trace=lab",
        persistent: true,
      },
    });

    render(
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("topic-events")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Attributes" }));

    const dialog = await screen.findByRole("dialog", { name: "Topic attributes · topic-events" });
    const endpointInput = within(dialog).getByPlaceholderText("https://example.com/webhook");
    await waitFor(() => expect(endpointInput).toHaveValue("https://notify.example.test/hooks/current"));
    expect(within(dialog).getByRole("checkbox", { name: "Verify SSL certificates" })).not.toBeChecked();

    const attributeKeys = within(dialog).getAllByPlaceholderText("attribute-key");
    const attributeValues = within(dialog).getAllByPlaceholderText('value or JSON ({"key":"value"})');
    expect(attributeKeys.map((input) => (input as HTMLInputElement).value)).toEqual(["OpaqueData", "persistent"]);
    expect(attributeValues.map((input) => (input as HTMLInputElement).value)).toEqual(["trace=lab", "true"]);

    await user.clear(endpointInput);
    await user.type(endpointInput, "https://notify.example.test/hooks/updated");
    await user.click(within(dialog).getByRole("button", { name: "Save attributes" }));

    await waitFor(() => expect(updateTopicConfigurationMock).toHaveBeenCalledTimes(1));
    expect(updateTopicConfigurationMock).toHaveBeenCalledWith(7, topicArn, {
      "push-endpoint": "https://notify.example.test/hooks/updated",
      "verify-ssl": false,
      OpaqueData: "trace=lab",
      persistent: "true",
    });
  });

  it("renders Ceph notification bindings under a single topic row", async () => {
    const topicArn = "arn:aws:sns:default:tenant:ceph-topic-main";
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: 7,
          display_name: "Lab account",
          storage_endpoint_capabilities: { sns: true },
        },
      ],
      selectedS3AccountId: 7,
      accountIdForApi: 7,
      requiresS3AccountSelection: false,
      sessionS3AccountName: null,
      accessMode: "default",
      iamIdentity: null,
    });
    listTopicsMock.mockResolvedValue([
      {
        name: "ceph-topic-main",
        arn: topicArn,
        is_ceph: true,
        subscriptions_confirmed: 2,
        subscriptions_pending: 0,
        subscriptions: [
          {
            name: "notif.bucket-alpha_ceph-topic-main",
            bucket: "bucket-alpha",
            endpoint_address: "https://notify.example.test/hooks/a",
            endpoint_topic: "endpoint-topic-a",
            endpoint_args: { "verify-ssl": false, time_to_live: 60 },
            persistent: true,
            metadata: { OpaqueData: "trace-a" },
          },
          {
            name: "notif.bucket-beta_ceph-topic-main",
            bucket: "bucket-beta",
            endpoint_address: "https://notify.example.test/hooks/b",
            endpoint_topic: "endpoint-topic-b",
            endpoint_args: { "verify-ssl": true },
            persistent: false,
            metadata: { OpaqueData: "trace-b" },
          },
          {
            name: "notif.unknown_ceph-topic-main",
            bucket: null,
            endpoint_address: "https://notify.example.test/hooks/hidden",
            endpoint_topic: "endpoint-topic-hidden",
            endpoint_args: { Version: "2012-10-17" },
            persistent: true,
            metadata: { OpaqueData: "hidden-trace" },
          },
        ],
      },
    ]);

    render(
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("ceph-topic-main")).toBeInTheDocument();
    expect(screen.getAllByText("ceph-topic-main")).toHaveLength(1);
    expect(screen.getByText("Notifications: 2")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed: 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending: 0")).not.toBeInTheDocument();
    const bucketAlpha = screen.getByText("Bucket: bucket-alpha");
    const bucketBeta = screen.getByText("Bucket: bucket-beta");
    expect(bucketAlpha).toBeInTheDocument();
    expect(bucketBeta).toBeInTheDocument();
    expect(bucketAlpha.tagName).toBe("LI");
    expect(bucketBeta.tagName).toBe("LI");
    expect(bucketAlpha).not.toHaveClass("rounded-md");
    expect(bucketAlpha).not.toHaveClass("border");
    expect(bucketAlpha).not.toHaveClass("bg-slate-50");
    expect(screen.queryByText("notif.bucket-alpha_ceph-topic-main")).not.toBeInTheDocument();
    expect(screen.queryByText("notif.bucket-beta_ceph-topic-main")).not.toBeInTheDocument();
    expect(screen.queryByText("notif.unknown_ceph-topic-main")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint: https://notify.example.test/hooks/a")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint topic: endpoint-topic-a")).not.toBeInTheDocument();
    expect(screen.queryByText("Persistent: true")).not.toBeInTheDocument();
    expect(screen.queryByText("verify-ssl: false · time_to_live: 60 · OpaqueData: trace-a")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint: https://notify.example.test/hooks/b")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoint: https://notify.example.test/hooks/hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("Version: 2012-10-17")).not.toBeInTheDocument();
  });
});
