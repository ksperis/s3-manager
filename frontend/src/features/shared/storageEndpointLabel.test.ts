import { describe, expect, it } from "vitest";

import type { S3Account } from "../../api/accounts";
import type { ExecutionContext } from "../../api/executionContexts";
import { formatAccountLabel } from "./storageEndpointLabel";

const capabilities = {
  can_manage_iam: true,
  sts_capable: true,
  admin_api_capable: true,
};

function executionContext(
  overrides: Partial<ExecutionContext>,
): ExecutionContext {
  return {
    kind: "account",
    id: "1",
    display_name: "Primary",
    tags: [],
    endpoint_tags: [],
    endpoint_name: "Default endpoint",
    endpoint_is_default: true,
    endpoint_url: "https://s3.example.test",
    storage_endpoint_capabilities: {},
    capabilities,
    ...overrides,
  };
}

function account(overrides: Partial<S3Account>): S3Account {
  return {
    id: 1,
    name: "Primary",
    tags: [],
    rgw_account_id: "RGW-PRIMARY",
    storage_endpoint_id: 1,
    storage_endpoint_name: "Default endpoint",
    storage_endpoint_url: "https://s3.example.test",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: {},
    ...overrides,
  };
}

describe("formatAccountLabel", () => {
  it("uses explicit endpoint metadata", () => {
    expect(
      formatAccountLabel(
        executionContext({
          endpoint_id: 1,
          endpoint_name: "Default endpoint",
          endpoint_is_default: true,
        }),
      ),
    ).toBe("Primary");
    expect(
      formatAccountLabel(
        executionContext({
          endpoint_id: 2,
          endpoint_name: "Archive",
          endpoint_is_default: false,
        }),
      ),
    ).toBe("Primary (Archive)");
  });

  it("uses canonical context kinds instead of ID prefixes", () => {
    expect(
      formatAccountLabel(
        executionContext({
          kind: "account",
          id: "conn-misleading",
          endpoint_is_default: true,
        }),
      ),
    ).toBe("Primary");
    expect(
      formatAccountLabel(
        executionContext({
          kind: "s3_user",
          id: "conn-misleading",
          endpoint_id: 2,
          endpoint_name: "Ceph",
          endpoint_is_default: false,
        }),
      ),
    ).toBe("Primary · S3 user (Ceph)");
  });

  it("formats a stored account with its endpoint metadata", () => {
    expect(
      formatAccountLabel(
        account({
          id: 2,
          storage_endpoint_id: 2,
          storage_endpoint_name: "Ceph",
          storage_endpoint_is_default: false,
        }),
      ),
    ).toBe("Primary (Ceph)");
  });
});
