/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ListPageSection from "../list/ListPageSection";

describe("ListPageSection", () => {
  it("groups a compact list toolbar and its inventory content", () => {
    render(
      <ListPageSection
        title="Users"
        countLabel="3 entries"
        search={<input aria-label="Search users" />}
      >
        <table aria-label="Users table" />
      </ListPageSection>,
    );

    expect(screen.getByRole("region", { name: "Users" })).toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.getByText("3 entries")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Users table" })).toBeInTheDocument();
  });

  it("can retain a distinct visible section heading", () => {
    render(
      <ListPageSection title="My help requests" showHeading>
        <div>Request list</div>
      </ListPageSection>,
    );

    expect(screen.getByText("My help requests")).toBeInTheDocument();
  });
});
