import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketReplicationController } from "../useBucketReplicationController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketReplication: vi.fn(),
  deleteCephAdminBucketReplication: vi.fn(),
  getBucketReplication: vi.fn(),
  getCephAdminBucketReplication: vi.fn(),
  putBucketReplication: vi.fn(),
  putCephAdminBucketReplication: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  deleteBucketReplication: (...args: unknown[]) =>
    apiMocks.deleteBucketReplication(...args),
  getBucketReplication: (...args: unknown[]) =>
    apiMocks.getBucketReplication(...args),
  putBucketReplication: (...args: unknown[]) =>
    apiMocks.putBucketReplication(...args),
}));

vi.mock("../../../../api/cephAdmin", () => ({
  deleteCephAdminBucketReplication: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketReplication(...args),
  getCephAdminBucketReplication: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketReplication(...args),
  putCephAdminBucketReplication: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketReplication(...args),
}));

function renderReplication(
  overrides: Partial<Parameters<typeof useBucketReplicationController>[0]> = {},
) {
  return renderHook(() =>
    useBucketReplicationController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const graphicalConfiguration = {
  Role: "arn:aws:iam::123456789012:role/replication-role",
  Rules: [
    {
      ID: "archive",
      Status: "Enabled",
      Priority: 4,
      Filter: { Prefix: "logs/" },
      Destination: { Bucket: "arn:aws:s3:::archive" },
      DeleteMarkerReplication: { Status: "Disabled" },
    },
  ],
};

describe("useBucketReplicationController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a Manager configuration and warns about advanced fields", async () => {
    const advancedConfiguration = {
      ...graphicalConfiguration,
      Rules: [
        {
          ...graphicalConfiguration.Rules[0],
          Destination: {
            ...graphicalConfiguration.Rules[0].Destination,
            StorageClass: "STANDARD_IA",
          },
        },
      ],
    };
    apiMocks.getBucketReplication.mockResolvedValue({
      configuration: advancedConfiguration,
    });
    const { result } = renderReplication();

    await act(async () => result.current.load());

    expect(apiMocks.getBucketReplication).toHaveBeenCalledWith(
      "acc-1",
      "reports",
    );
    expect(result.current.configured).toBe(true);
    expect(result.current.role).toBe(graphicalConfiguration.Role);
    expect(result.current.rules[0]).toMatchObject({
      deleteMarkerStatus: "Disabled",
      destinationBucket: "arn:aws:s3:::archive",
      id: "archive",
      prefix: "logs/",
      priority: "4",
      status: "Enabled",
    });
    expect(result.current.warning).toContain("not covered by graphical mode");
    expect(result.current.dirty).toBe(false);
  });

  it("builds and saves a graphical Manager configuration", async () => {
    apiMocks.putBucketReplication.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, configuration: unknown) =>
        Promise.resolve({ configuration }),
    );
    const { result } = renderReplication();
    const ruleId = result.current.rules[0].uiId;

    act(() => {
      result.current.updateRole(
        " arn:aws:iam::123456789012:role/replication-role ",
      );
      result.current.updateRule(ruleId, {
        deleteMarkerStatus: "Enabled",
        destinationBucket: " arn:aws:s3:::archive ",
        id: " archive ",
        prefix: " logs/ ",
        priority: "4",
      });
    });
    expect(result.current.dirty).toBe(true);

    await act(async () => result.current.save());

    expect(apiMocks.putBucketReplication).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      {
        Role: "arn:aws:iam::123456789012:role/replication-role",
        Rules: [
          {
            DeleteMarkerReplication: { Status: "Enabled" },
            Destination: { Bucket: "arn:aws:s3:::archive" },
            Filter: { Prefix: "logs/" },
            ID: "archive",
            Priority: 4,
            Status: "Enabled",
          },
        ],
      },
    );
    expect(result.current.status).toBe("Replication configuration updated.");
    expect(result.current.warning).toBeNull();
    expect(result.current.dirty).toBe(false);
  });

  it("rejects invalid JSON and unsupported destination zones", async () => {
    const { result } = renderReplication();

    act(() => {
      result.current.updateMode("json");
      result.current.updateText("{");
    });
    await act(async () => result.current.save());
    expect(result.current.error).toBe(
      "Replication configuration JSON is invalid.",
    );

    act(() => {
      result.current.updateText(
        JSON.stringify({
          Rules: [
            {
              Destination: {
                Bucket: "arn:aws:s3:::archive",
                Zone: "zone-a",
              },
            },
          ],
        }),
      );
    });
    await act(async () => result.current.save());

    expect(result.current.error).toBe(
      "Destination.Zone is not supported in V1.",
    );
    expect(apiMocks.putBucketReplication).not.toHaveBeenCalled();
  });

  it("loads and clears a Ceph Admin configuration", async () => {
    apiMocks.getCephAdminBucketReplication.mockResolvedValue({
      configuration: graphicalConfiguration,
    });
    apiMocks.deleteCephAdminBucketReplication.mockResolvedValue(undefined);
    const { result } = renderReplication({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    expect(apiMocks.getCephAdminBucketReplication).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.configured).toBe(true);

    await act(async () => result.current.clear());

    expect(apiMocks.deleteCephAdminBucketReplication).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.configured).toBe(false);
    expect(result.current.status).toBe("Replication configuration cleared.");
    expect(result.current.dirty).toBe(false);
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const disabled = renderReplication({ enabled: false });
    const missingEndpoint = renderReplication({
      cephAdmin: true,
      endpointId: null,
    });

    await act(async () => disabled.result.current.load());
    await act(async () => disabled.result.current.save());
    await act(async () => disabled.result.current.clear());
    await act(async () => missingEndpoint.result.current.load());
    await act(async () => missingEndpoint.result.current.save());
    await act(async () => missingEndpoint.result.current.clear());

    expect(apiMocks.getBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.putBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.getCephAdminBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.putCephAdminBucketReplication).not.toHaveBeenCalled();
    expect(apiMocks.deleteCephAdminBucketReplication).not.toHaveBeenCalled();
  });
});
