import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import type { ColumnId } from "./bucketOpsListState";
import {
  buildBucketOpsDataColumns,
  buildBucketOpsTableColumns,
} from "./bucketOpsTableColumns";

const bucket: CephAdminBucket = {
  name: "archive",
  context_kind: "connection",
  context_name: "Archive connection",
  owner: "owner-a",
  used_bytes: 5_120,
  quota_max_size_bytes: 10_240,
  object_count: 4,
  quota_max_objects: 8,
  tags: [],
  column_details: {
    object_lock_mode: "GOVERNANCE",
  },
};

function createRenderers() {
  return {
    renderFeatureChip: vi.fn(() => "feature-chip"),
    renderOwnerCell: vi.fn(() => "owner-cell"),
    renderS3Tags: vi.fn(() => "s3-tags"),
    renderUiTags: vi.fn(() => "ui-tags"),
  };
}

function buildColumns(
  visibleColumns: ColumnId[],
  renderers = createRenderers(),
) {
  return {
    columns: buildBucketOpsDataColumns({
      featureColumns: [
        { id: "versioning", key: "versioning", label: "Versioning" },
      ],
      ...renderers,
      visibleColumns,
    }),
    renderers,
  };
}

describe("buildBucketOpsDataColumns", () => {
  it("keeps the canonical data-column order regardless of picker order", () => {
    const { columns } = buildColumns([
      "quota_status",
      "object_lock_mode",
      "versioning",
      "tags",
      "used_bytes",
      "owner",
      "ui_tags",
      "context_kind",
    ]);

    expect(columns.map(({ id }) => id)).toEqual([
      "context_kind",
      "ui_tags",
      "owner",
      "used_bytes",
      "tags",
      "versioning",
      "object_lock_mode",
      "quota_status",
    ]);
    expect(columns.find(({ id }) => id === "tags")?.expensive).toBe(true);
    expect(columns.find(({ id }) => id === "used_bytes")?.field).toBe(
      "used_bytes",
    );
  });

  it("formats data values and detail cells through the canonical presenters", () => {
    const { columns } = buildColumns([
      "context_kind",
      "used_bytes",
      "quota_usage_size_percent",
      "object_lock_mode",
      "quota_status",
    ]);
    const byId = new Map(columns.map((column) => [column.id, column]));

    expect(byId.get("context_kind")?.render(bucket)).toBe("Connection");
    expect(byId.get("used_bytes")?.render(bucket)).toBe("5.0 KB");
    expect(byId.get("quota_usage_size_percent")?.render(bucket)).toBe(
      "50.0%",
    );

    render(
      <>
        {byId.get("object_lock_mode")?.render(bucket)}
        {byId.get("quota_status")?.render(bucket)}
      </>,
    );
    expect(screen.getByTitle("GOVERNANCE")).toHaveTextContent("GOVERNANCE");
    expect(screen.getByTitle("Quota: Configured")).toHaveTextContent(
      "Configured",
    );
  });

  it("delegates interactive data cells without changing their arguments", () => {
    const { columns, renderers } = buildColumns([
      "ui_tags",
      "owner",
      "tags",
      "versioning",
    ]);

    render(
      <>
        {columns.map((column) => (
          <span key={column.id}>{column.render(bucket)}</span>
        ))}
      </>,
    );

    expect(renderers.renderUiTags).toHaveBeenCalledWith(bucket);
    expect(renderers.renderOwnerCell).toHaveBeenCalledWith(bucket);
    expect(renderers.renderS3Tags).toHaveBeenCalledWith(bucket);
    expect(renderers.renderFeatureChip).toHaveBeenCalledWith(
      "versioning",
      bucket,
    );
  });
});

describe("buildBucketOpsTableColumns", () => {
  it("wraps data columns in the canonical edge columns", () => {
    const renderers = createRenderers();
    const renderActions = vi.fn(() => "actions");
    const renderName = vi.fn(() => "name");
    const renderSelection = vi.fn(() => "selection");
    const columns = buildBucketOpsTableColumns({
      featureColumns: [],
      ...renderers,
      renderActions,
      renderName,
      renderSelection,
      selectionHeader: "select-all",
      visibleColumns: ["context_name"],
    });

    expect(columns.map(({ id }) => id)).toEqual([
      "select",
      "name",
      "context_name",
      "actions",
    ]);
    expect(columns[0]).toEqual(
      expect.objectContaining({ header: "select-all", align: "left" }),
    );
    expect(columns.at(-1)).toEqual(
      expect.objectContaining({
        align: "right",
        cellClassName: "!py-1.5",
        headerClassName: "w-16",
      }),
    );

    columns[0].render(bucket);
    columns[1].render(bucket);
    columns.at(-1)?.render(bucket);
    expect(renderSelection).toHaveBeenCalledWith(bucket);
    expect(renderName).toHaveBeenCalledWith(bucket);
    expect(renderActions).toHaveBeenCalledWith(bucket);
  });
});
