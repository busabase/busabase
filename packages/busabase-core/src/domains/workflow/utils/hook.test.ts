import { describe, expect, it } from "vitest";
import { buildWorkflowHookRequest, newWorkflowHookToken, pickWorkflowHookResponse } from "./hook";

const at = new Date("2026-11-06T02:00:00Z");

describe("buildWorkflowHookRequest", () => {
  it("keeps method, query, headers, and a parsed JSON body, without credentials", () => {
    const request = buildWorkflowHookRequest({
      method: "post",
      url: "https://busabase.test/api/workflow-hooks/n/t?msg_signature=abc&nonce=1",
      headers: [
        ["Content-Type", "application/json"],
        ["Authorization", "Bearer secret"],
        ["Cookie", "session=1"],
        ["X-Hub-Signature-256", "sha256=ff"],
      ],
      bodyText: '{"text":"1"}',
      receivedAt: at,
    });
    expect(request).toEqual({
      method: "POST",
      query: { msg_signature: "abc", nonce: "1" },
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=ff" },
      body: { text: "1" },
      receivedAt: "2026-11-06T02:00:00.000Z",
    });
  });

  it("keeps text bodies as text and empty ones as null", () => {
    const text = (bodyText: string, contentType = "text/plain") =>
      buildWorkflowHookRequest({
        method: "POST",
        url: "https://busabase.test/x",
        headers: [["content-type", contentType]],
        bodyText,
        receivedAt: at,
      }).body;
    expect(text("<xml><Content>hi</Content></xml>", "text/xml")).toBe(
      "<xml><Content>hi</Content></xml>",
    );
    expect(text("")).toBeNull();
    // JSON sent without a JSON content type is still read as JSON.
    expect(text('{"a":1}')).toEqual({ a: 1 });
    expect(text("{not json")).toBe("{not json");
  });
});

describe("pickWorkflowHookResponse", () => {
  const outputs = (...responses: unknown[]) =>
    Object.fromEntries(
      responses.map((response, index) => [
        `s${index}`,
        { sequence: index, data: response === undefined ? {} : { response } },
      ]),
    );

  it("answers with the latest step that chose a response", () => {
    expect(pickWorkflowHookResponse(outputs({ a: 1 }, undefined, "later"))).toEqual({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: "later",
    });
    expect(pickWorkflowHookResponse(outputs(undefined))).toBeNull();
  });

  it("reads { status, contentType, body } and sends anything but a string as JSON", () => {
    expect(pickWorkflowHookResponse(outputs({ status: 201, body: { msgtype: "text" } }))).toEqual({
      status: 201,
      contentType: "application/json; charset=utf-8",
      body: '{"msgtype":"text"}',
    });
    expect(
      pickWorkflowHookResponse(outputs({ contentType: "text/xml", body: "<xml/>" })),
    ).toMatchObject({ contentType: "text/xml; charset=utf-8", body: "<xml/>" });
  });

  it("never answers with HTML, and ignores a status outside 200–599", () => {
    expect(
      pickWorkflowHookResponse(
        outputs({ status: 302, contentType: "text/html", body: "<script>alert(1)</script>" }),
      ),
    ).toEqual({
      status: 302,
      contentType: "text/plain; charset=utf-8",
      body: "<script>alert(1)</script>",
    });
    expect(pickWorkflowHookResponse(outputs({ status: 99, body: "x" }))?.status).toBe(200);
    expect(pickWorkflowHookResponse(outputs({ status: 700, body: "x" }))?.status).toBe(200);
  });
});

describe("newWorkflowHookToken", () => {
  it("makes long, URL-safe, different tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newWorkflowHookToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
