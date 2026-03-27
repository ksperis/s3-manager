import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import UiTagEditor from "../UiTagEditor";
import type { UiTagDefinition } from "../../utils/uiTags";
import type { TagColorKey, TagScope } from "../../api/tags";

function StatefulEditor({
  initialTags,
  catalog,
  catalogMode,
}: {
  initialTags?: UiTagDefinition[];
  catalog?: Array<{ id: number; label: string; color_key: TagColorKey; scope: TagScope }>;
  catalogMode?: "shared" | "private";
}) {
  const [tags, setTags] = useState<UiTagDefinition[]>(initialTags ?? []);
  return <UiTagEditor tags={tags} catalog={catalog} catalogMode={catalogMode} onChange={setTags} />;
}

describe("UiTagEditor", () => {
  it("adds an existing catalog tag from the dedicated section", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        catalog={[
          {
            id: 1,
            label: "gold",
            color_key: "amber",
            scope: "standard",
          },
          {
            id: 2,
            label: "ops",
            color_key: "teal",
            scope: "administrative",
          },
        ]}
      />
    );

    await user.type(screen.getByRole("textbox", { name: "Search existing tags" }), "gol");
    await user.click(screen.getByRole("button", { name: "Add gold" }));

    const selectedBadge = screen.getByText("gold").parentElement;
    expect(selectedBadge).toHaveClass("bg-amber-50");
    expect(selectedBadge).not.toHaveClass("bg-slate-50");
    expect(screen.getAllByText("Standard").length).toBeGreaterThan(0);
  });

  it("creates a new tag with the chosen initial color", async () => {
    const user = userEvent.setup();

    render(<StatefulEditor />);

    await user.type(screen.getByRole("textbox", { name: "New tag label" }), "fresh");
    await user.click(screen.getByRole("button", { name: "Use Blue for new tag" }));
    await user.click(screen.getByRole("button", { name: "Use Administrative scope for new tag" }));
    await user.click(screen.getByRole("button", { name: "Create and add tag" }));

    const selectedBadge = screen.getByText("fresh").parentElement;
    expect(selectedBadge).toHaveClass("bg-blue-50");
    expect(selectedBadge).not.toHaveClass("bg-slate-50");
    expect(screen.getAllByText("Administrative").length).toBeGreaterThan(0);
  });

  it("blocks creating a tag when the label already exists in the catalog", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        catalog={[
          {
            id: 1,
            label: "gold",
            color_key: "amber",
            scope: "standard",
          },
        ]}
      />
    );

    await user.type(screen.getByRole("textbox", { name: "New tag label" }), "gold");

    expect(screen.getByText("This tag already exists. Add it from Add existing tag.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create and add tag" })).toBeDisabled();
  });

  it("changes the color of a local unsaved tag immediately", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        initialTags={[
          {
            label: "draft-tag",
            color_key: "neutral",
            scope: "standard",
          },
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit settings for draft-tag" }));
    await user.click(screen.getByRole("button", { name: "Use Blue for draft-tag" }));
    await user.click(screen.getByRole("button", { name: "Use Administrative scope for draft-tag" }));

    const selectedBadge = screen.getAllByText("draft-tag")[0].parentElement;
    expect(selectedBadge).toHaveClass("bg-blue-50");
    expect(selectedBadge).not.toHaveClass("bg-slate-50");
    expect(screen.getAllByText("Administrative").length).toBeGreaterThan(0);
  });

  it("edits the color and scope of an existing shared tag through the dedicated confirmation flow", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        initialTags={[
          {
            id: 1,
            label: "gold",
            color_key: "amber",
            scope: "standard",
          },
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit shared settings for gold" }));
    expect(
      screen.getByText("This updates the shared tag definition for all objects in this domain.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select Blue for gold" }));
    await user.click(screen.getByRole("button", { name: "Select Administrative scope for gold" }));
    const previewBadge = screen.getAllByText("gold")[1].parentElement;
    expect(previewBadge).toHaveClass("bg-blue-50");
    await user.click(screen.getByRole("button", { name: "Apply shared changes" }));

    const selectedBadge = screen.getByText("gold").parentElement;
    expect(selectedBadge).toHaveClass("bg-blue-50");
    expect(selectedBadge).not.toHaveClass("bg-amber-50");
    expect(screen.getAllByText("Administrative").length).toBeGreaterThan(0);
  });

  it("uses the private wording for private tag catalogs", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        catalogMode="private"
        initialTags={[
          {
            id: 1,
            label: "ops",
            color_key: "teal",
            scope: "standard",
          },
        ]}
      />
    );

    expect(
      screen.getByText("Reuse a private tag from your private-connection tag catalog.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit shared settings for ops" }));

    expect(
      screen.getByText(
        "This updates the private tag definition for your private-connection tag catalog."
      )
    ).toBeInTheDocument();
  });
});
