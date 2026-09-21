import type { AcpToolCallBlock } from "@acp-ui/core/reduce";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AcpToolCallView } from "./tool-call-view";

const block = (overrides: Partial<AcpToolCallBlock> = {}): AcpToolCallBlock => ({
  kind: "tool_call",
  id: "t1",
  title: "Read file",
  toolKind: "read",
  status: "completed",
  ...overrides,
});

describe("compact by default", () => {
  it("renders only the header when the block carries no raw input or output", () => {
    render(<AcpToolCallView block={block()} />);
    expect(screen.getByText("Read file")).toBeVisible();
    expect(screen.queryByText("Parameters")).not.toBeInTheDocument();
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("does not render empty details after ACP explicitly clears an output", async () => {
    render(<AcpToolCallView block={block({ rawOutput: null })} />);
    await userEvent.click(screen.getByText("Read file"));
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });
});

describe("expanding a completed call reveals its result (PUL-262)", () => {
  it("shows Parameters and Result after clicking the header", async () => {
    render(
      <AcpToolCallView
        block={block({ rawInput: { path: "README.md" }, rawOutput: { content: "# Hello" } })}
      />,
    );
    await userEvent.click(screen.getByText("Read file"));
    expect(screen.getByText("Parameters")).toBeVisible();
    expect(screen.getByTestId("acp-tool-input")).toHaveTextContent("README.md");
    expect(screen.getByText("Result")).toBeVisible();
    expect(screen.getByTestId("acp-tool-output")).toHaveTextContent("Hello");
  });

  it("shows only Parameters when no output has arrived yet", async () => {
    render(
      <AcpToolCallView block={block({ status: "in_progress", rawInput: { path: "a.ts" } })} />,
    );
    await userEvent.click(screen.getByText("Read file"));
    expect(screen.getByText("Parameters")).toBeVisible();
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });
});

describe("failed call shows an error instead of a result", () => {
  it("renders the raw output as Error text, not Result", async () => {
    render(
      <AcpToolCallView
        block={block({
          status: "failed",
          rawInput: { cmd: "rm -rf build" },
          rawOutput: "permission denied",
        })}
      />,
    );
    await userEvent.click(screen.getByText("Read file"));
    expect(screen.getByRole("heading", { name: "Error" })).toBeVisible();
    expect(screen.getByTestId("acp-tool-output")).toHaveTextContent("permission denied");
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("stringifies a structured error payload rather than dropping it", async () => {
    render(
      <AcpToolCallView
        block={block({ status: "failed", rawOutput: { code: "EACCES", message: "denied" } })}
      />,
    );
    await userEvent.click(screen.getByText("Read file"));
    expect(screen.getByRole("heading", { name: "Error" })).toBeVisible();
    expect(screen.getByTestId("acp-tool-output")).toHaveTextContent("EACCES");
  });
});

describe("falsy but present raw output is not dropped (KUI ToolOutput follow-up)", () => {
  it("shows a Result section for a completed call whose rawOutput is false", async () => {
    render(<AcpToolCallView block={block({ status: "completed", rawOutput: false })} />);
    await userEvent.click(screen.getByText("Read file"));
    expect(screen.getByRole("heading", { name: "Result" })).toBeVisible();
    expect(screen.getByTestId("acp-tool-output")).toHaveTextContent("false");
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("shows a Result section for a completed call whose rawOutput is 0", async () => {
    render(<AcpToolCallView block={block({ status: "completed", rawOutput: 0 })} />);
    await userEvent.click(screen.getByText("Read file"));
    expect(screen.getByRole("heading", { name: "Result" })).toBeVisible();
    expect(screen.getByTestId("acp-tool-output")).toHaveTextContent("0");
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("shows an Error section with a visible payload for a failed call whose rawOutput is an empty string", async () => {
    render(<AcpToolCallView block={block({ status: "failed", rawOutput: "" })} />);
    await userEvent.click(screen.getByText("Read file"));
    expect(screen.getByRole("heading", { name: "Error" })).toBeVisible();
    expect(screen.getByTestId("acp-tool-output")).toHaveTextContent('""');
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });
});
