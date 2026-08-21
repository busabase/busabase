import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AcpSessionMeta } from "./acp-session-meta";

describe("nothing to show", () => {
  it("renders nothing when neither title nor usage is set", () => {
    const { container } = render(<AcpSessionMeta />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for explicit nulls", () => {
    const { container } = render(<AcpSessionMeta title={null} usage={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("title only", () => {
  it("shows the title with no usage suffix", () => {
    render(<AcpSessionMeta title="A conversation about tea" />);
    expect(screen.getByTestId("acp-session-title")).toHaveTextContent("A conversation about tea");
    expect(screen.queryByTestId("acp-session-usage")).not.toBeInTheDocument();
  });
});

describe("usage only", () => {
  // Real payload observed from an actual claude-agent-acp session.
  it("formats tokens with a K suffix past 1000", () => {
    render(<AcpSessionMeta usage={{ used: 27277, size: 1_000_000 }} />);
    expect(screen.getByTestId("acp-session-usage")).toHaveTextContent("27K / 1000K tokens");
  });

  it("shows raw numbers under 1000", () => {
    render(<AcpSessionMeta usage={{ used: 500, size: 800 }} />);
    expect(screen.getByTestId("acp-session-usage")).toHaveTextContent("500 / 800 tokens");
  });

  it("formats cost as real currency, not a bare dollar sign", () => {
    render(
      <AcpSessionMeta
        usage={{ used: 100, size: 1000, cost: { amount: 0.3879, currency: "USD" } }}
      />,
    );
    expect(screen.getByTestId("acp-session-usage")).toHaveTextContent("$0.39");
  });

  it("omits cost when the agent didn't report one", () => {
    render(<AcpSessionMeta usage={{ used: 100, size: 1000 }} />);
    expect(screen.getByTestId("acp-session-usage")).not.toHaveTextContent("$");
  });

  // Intl.NumberFormat throws on an unrecognized ISO 4217 code — must not crash.
  it("falls back to a plain amount + code for a currency Intl doesn't recognize", () => {
    render(
      <AcpSessionMeta
        usage={{ used: 100, size: 1000, cost: { amount: 5, currency: "NOTREAL" } }}
      />,
    );
    expect(screen.getByTestId("acp-session-usage")).toHaveTextContent("5 NOTREAL");
  });
});

describe("both", () => {
  it("joins title and usage with a separator", () => {
    render(<AcpSessionMeta title="Tea history" usage={{ used: 100, size: 1000 }} />);
    const el = screen.getByTestId("acp-session-meta");
    expect(el).toHaveTextContent("Tea history");
    expect(el).toHaveTextContent("100 / 1.0K tokens");
    expect(el.textContent).toContain("·");
  });
});
