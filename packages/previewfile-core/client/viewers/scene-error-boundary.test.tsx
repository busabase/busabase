import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SceneErrorBoundary } from "./scene-error-boundary";

const Boom = ({ message }: { message: string }) => {
  throw new Error(message);
};

describe("SceneErrorBoundary", () => {
  it("shows its scene while nothing fails", () => {
    render(
      <SceneErrorBoundary onError={vi.fn()}>
        <p>the model</p>
      </SceneErrorBoundary>,
    );
    expect(screen.getByText("the model")).toBeTruthy();
  });

  it("hands a failure to the viewer instead of letting it reach the page", () => {
    // React logs a caught render error; this test expects one.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <SceneErrorBoundary onError={onError}>
        <Boom message="Could not load potsdamer_platz_1k.hdr: Failed to fetch" />
      </SceneErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe(
      "Could not load potsdamer_platz_1k.hdr: Failed to fetch",
    );
    expect(screen.queryByText("the model")).toBeNull();
    log.mockRestore();
  });
});
