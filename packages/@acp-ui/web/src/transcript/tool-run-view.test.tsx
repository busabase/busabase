import type { AcpToolCallBlock } from "@acp-ui/core/reduce";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AcpToolRunView } from "./tool-run-view";

const tool = (
  id: string,
  toolKind: AcpToolCallBlock["toolKind"] = "read",
  status: AcpToolCallBlock["status"] = "completed",
): AcpToolCallBlock => ({ kind: "tool_call", id, title: id, toolKind, status });

describe("summary title", () => {
  it("joins each non-zero category, buda's phrasing", () => {
    render(
      <AcpToolRunView blocks={[tool("t1", "read"), tool("t2", "execute"), tool("t3", "edit")]} />,
    );
    expect(screen.getByTestId("acp-tool-run")).toHaveTextContent(
      "Explored 1 file, Edited 1 file, Ran 1 command",
    );
  });

  it("pluralizes when a category has more than one", () => {
    render(<AcpToolRunView blocks={[tool("t1", "read"), tool("t2", "fetch")]} />);
    expect(screen.getByTestId("acp-tool-run")).toHaveTextContent("Explored 2 files");
  });

  it("falls back to a generic count when every tool is uncategorized", () => {
    render(<AcpToolRunView blocks={[tool("t1", "think"), tool("t2", "switch_mode")]} />);
    expect(screen.getByTestId("acp-tool-run")).toHaveTextContent("Used 2 tools");
  });

  it("accepts overridden labels", () => {
    render(
      <AcpToolRunView
        blocks={[tool("t1", "read")]}
        labels={{
          explored: (n) => `已探索 ${n} 个文件`,
          searched: (n) => `已搜索 ${n} 次`,
          edited: (n) => `已编辑 ${n} 个文件`,
          ran: (n) => `已运行 ${n} 条命令`,
          usedTools: (n) => `已使用 ${n} 个工具`,
        }}
      />,
    );
    expect(screen.getByTestId("acp-tool-run")).toHaveTextContent("已探索 1 个文件");
  });
});

describe("running state", () => {
  it("shows a spinner and is expanded by default while a tool is active", () => {
    render(<AcpToolRunView blocks={[tool("t1", "read", "in_progress")]} />);
    expect(screen.getByTestId("acp-tool-run")).toHaveAttribute("aria-expanded", "true");
  });

  it("shows a check and is collapsed by default once every tool has settled", () => {
    render(<AcpToolRunView blocks={[tool("t1", "read", "completed")]} />);
    expect(screen.getByTestId("acp-tool-run")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("expansion", () => {
  it("reveals each individual tool call when expanded", async () => {
    render(<AcpToolRunView blocks={[tool("t1", "read"), tool("t2", "execute")]} />);
    expect(screen.queryAllByTestId("acp-tool-call")).toHaveLength(0);
    await userEvent.click(screen.getByTestId("acp-tool-run"));
    expect(screen.getAllByTestId("acp-tool-call")).toHaveLength(2);
  });
});
