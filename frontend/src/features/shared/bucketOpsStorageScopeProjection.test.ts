import { describe, expect, it } from "vitest";
import type { ExecutionContext, ExecutionContextKind } from "../../api/executionContexts";
import type { TagDefinitionSummary } from "../../api/tags";
import { buildBucketOpsStorageScopeProjection } from "./bucketOpsStorageScopeProjection";

const sharedTag: TagDefinitionSummary = {
  id: 1,
  label: "shared",
  color_key: "sky",
  scope: "standard",
};
const coldTag: TagDefinitionSummary = {
  id: 2,
  label: "cold",
  color_key: "slate",
  scope: "standard",
};
const hiddenTag: TagDefinitionSummary = {
  id: 3,
  label: "internal",
  color_key: "red",
  scope: "administrative",
};

function context(
  kind: ExecutionContextKind,
  id: string,
  displayName: string,
  endpointName: string,
  overrides: Partial<ExecutionContext> = {}
): ExecutionContext {
  return {
    kind,
    id,
    display_name: displayName,
    tags: [],
    endpoint_tags: [],
    endpoint_name: endpointName,
    endpoint_is_default: false,
    endpoint_url: `https://${endpointName.toLowerCase()}.example.test`,
    storage_endpoint_capabilities: {},
    capabilities: {
      can_manage_iam: false,
      sts_capable: false,
      admin_api_capable: false,
    },
    ...overrides,
  };
}

function buildProjection(
  overrides: Partial<Parameters<typeof buildBucketOpsStorageScopeProjection>[0]> = {}
) {
  return buildBucketOpsStorageScopeProjection({
    contexts: [],
    contextFilter: "",
    endpointFilter: "",
    selectedContextIds: [],
    selectedEndpointNames: [],
    ...overrides,
  });
}

describe("buildBucketOpsStorageScopeProjection", () => {
  it("keeps selectable contexts sorted and excludes portal accounts", () => {
    const projection = buildProjection({
      contexts: [
        context("connection", "b", "Beta", "Archive"),
        context("portal_account", "portal", "Portal", "Primary"),
        context("account", "z", "alpha", "Primary"),
        context("account", "a", "Alpha", "Primary"),
      ],
    });

    expect(projection.contextItems.map((item) => item.id)).toEqual(["a", "z", "b"]);
    expect(projection.contextLabelById).toEqual(
      new Map([
        ["a", "Alpha"],
        ["z", "alpha"],
        ["b", "Beta"],
      ])
    );
  });

  it("searches contexts by type and visible entity or endpoint tags", () => {
    const contexts = [
      context("connection", "connection", "Shared connection", "Archive", {
        tags: [sharedTag, hiddenTag],
        endpoint_tags: [coldTag],
      }),
      context("s3_user", "user", "Service identity", "Primary"),
    ];

    expect(
      buildProjection({ contexts, contextFilter: "shared" }).filteredContextItems.map(
        (item) => item.id
      )
    ).toEqual(["connection"]);
    expect(
      buildProjection({ contexts, contextFilter: "cold" }).filteredContextItems.map(
        (item) => item.id
      )
    ).toEqual(["connection"]);
    expect(
      buildProjection({ contexts, contextFilter: "s3 USER" }).filteredContextItems.map(
        (item) => item.id
      )
    ).toEqual(["user"]);
    expect(
      buildProjection({ contexts, contextFilter: "internal" }).filteredContextItems
    ).toEqual([]);
  });

  it("groups endpoints while merging context names and de-duplicating tags", () => {
    const contexts = [
      context("account", "account", "Account A", "Primary", {
        endpoint_tags: [coldTag],
      }),
      context("s3_user", "user", "S3 User B", "Primary", {
        endpoint_tags: [coldTag],
      }),
      context("connection", "connection", "Connection C", "Archive", {
        tags: [sharedTag],
      }),
    ];
    const projection = buildProjection({ contexts });

    expect(projection.endpointItems.map((item) => item.name)).toEqual([
      "Archive",
      "Primary",
    ]);
    expect(projection.endpointItems[1]?.contextNames).toEqual(["Account A", "S3 User B"]);
    expect(projection.endpointItems[1]?.tagItems.map((item) => item.label)).toEqual(["cold"]);
    expect(
      buildProjection({ contexts, endpointFilter: "s3 user" }).filteredEndpointItems.map(
        (item) => item.name
      )
    ).toEqual(["Primary"]);
    expect(
      buildProjection({ contexts, endpointFilter: "shared" }).filteredEndpointItems.map(
        (item) => item.name
      )
    ).toEqual(["Archive"]);
  });

  it("normalizes selections before deriving filtered selection states", () => {
    const contexts = [
      context("account", "account", "Account A", "Primary"),
      context("connection", "connection", "Connection B", "Archive"),
    ];
    const projection = buildProjection({
      contexts,
      contextFilter: "Account",
      endpointFilter: "Primary",
      selectedContextIds: [" account ", "", "account"],
      selectedEndpointNames: [" Primary ", "Primary"],
    });

    expect(projection.allFilteredContextsSelected).toBe(true);
    expect(projection.hasFilteredContextSelection).toBe(true);
    expect(projection.allFilteredEndpointsSelected).toBe(true);
    expect(projection.hasFilteredEndpointSelection).toBe(true);
  });

  it("does not report all selected when filters have no matches", () => {
    const projection = buildProjection({
      contexts: [context("account", "account", "Account A", "Primary")],
      contextFilter: "missing",
      endpointFilter: "missing",
      selectedContextIds: ["account"],
      selectedEndpointNames: ["Primary"],
    });

    expect(projection.allFilteredContextsSelected).toBe(false);
    expect(projection.hasFilteredContextSelection).toBe(false);
    expect(projection.allFilteredEndpointsSelected).toBe(false);
    expect(projection.hasFilteredEndpointSelection).toBe(false);
  });
});
