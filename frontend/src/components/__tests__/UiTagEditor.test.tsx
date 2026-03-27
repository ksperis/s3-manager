import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import UiTagEditor from "../UiTagEditor";
import type { UiTagDefinition } from "../../utils/uiTags";
import type { TagColorKey } from "../../api/tags";

function StatefulEditor({
  initialTags,
  catalog,
  catalogMode,
}: {
  initialTags?: UiTagDefinition[];
  catalog?: Array<{ id: number; label: string; color_key: TagColorKey }>;
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
          },
          {
            id: 2,
            label: "ops",
            color_key: "teal",
          },
        ]}
      />
    );

    await user.type(screen.getByRole("textbox", { name: "Search existing tags" }), "gol");
    await user.click(screen.getByRole("button", { name: "Add gold" }));

    const selectedBadge = screen.getByText("gold").parentElement;
    expect(selectedBadge).toHaveClass("bg-amber-50");
    expect(selectedBadge).not.toHaveClass("bg-slate-50");
  });

  it("creates a new tag with the chosen initial color", async () => {
    const user = userEvent.setup();

    render(<StatefulEditor />);

    await user.type(screen.getByRole("textbox", { name: "New tag label" }), "fresh");
    await user.click(screen.getByRole("button", { name: "Use Blue for new tag" }));
    await user.click(screen.getByRole("button", { name: "Create and add tag" }));

    const selectedBadge = screen.getByText("fresh").parentElement;
    expect(selectedBadge).toHaveClass("bg-blue-50");
    expect(selectedBadge).not.toHaveClass("bg-slate-50");
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
          },
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Change color for draft-tag" }));
    await user.click(screen.getByRole("button", { name: "Use Blue for draft-tag" }));

    const selectedBadge = screen.getByText("draft-tag").parentElement;
    expect(selectedBadge).toHaveClass("bg-blue-50");
    expect(selectedBadge).not.toHaveClass("bg-slate-50");
  });

  it("recolors an existing shared tag through the dedicated confirmation flow", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        initialTags={[
          {
            id: 1,
            label: "gold",
            color_key: "amber",
          },
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Change shared color for gold" }));
    expect(
      screen.getByText("This updates the shared tag definition for all objects in this domain.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select Blue for gold" }));
    const previewBadge = screen.getAllByText("gold")[1].parentElement;
    expect(previewBadge).toHaveClass("bg-blue-50");
    await user.click(screen.getByRole("button", { name: "Apply color change" }));

    const selectedBadge = screen.getByText("gold").parentElement;
    expect(selectedBadge).toHaveClass("bg-blue-50");
    expect(selectedBadge).not.toHaveClass("bg-amber-50");
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
          },
        ]}
      />
    );

    expect(
      screen.getByText("Reuse a private tag from your private-connection tag catalog.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change shared color for ops" }));

    expect(
      screen.getByText(
        "This updates the private tag definition for your private-connection tag catalog."
      )
    ).toBeInTheDocument();
  });
});
