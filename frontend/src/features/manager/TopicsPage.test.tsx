import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TopicsPage from "./TopicsPage";

const useS3AccountContextMock = vi.fn();
const listTopicsMock = vi.fn();

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
    getTopicConfiguration: vi.fn(),
    getTopicPolicy: vi.fn(),
    updateTopicConfiguration: vi.fn(),
    updateTopicPolicy: vi.fn(),
  };
});

describe("TopicsPage", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listTopicsMock.mockReset();
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
  });

  it("shows execution context and an empty state when no account is selected", () => {
    render(
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Execution context")).toBeInTheDocument();
    expect(screen.getByText("Select an account before managing SNS topics")).toBeInTheDocument();
    expect(screen.queryByText("Select an account to manage its topics.")).not.toBeInTheDocument();
  });
});
