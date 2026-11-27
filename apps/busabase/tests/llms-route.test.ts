import { expect, it } from "vitest";
import { GET } from "../src/app/llms.txt/route";

it("makes the forwarded local instance's setup the first discovery link", async () => {
  const response = await GET(
    new Request("http://internal:15419/llms.txt", {
      headers: { "x-forwarded-host": "busabase.lan", "x-forwarded-proto": "https" },
    }),
  );
  const text = await response.text();
  const firstLink = text.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");
  expect(firstLink?.[1]).toBe("https://busabase.lan/SETUP_SKILL.md");
  expect(firstLink?.index).toBeLessThan(1_000);
  expect(text).not.toContain("https://busabase.com/SETUP_SKILL.md");
});
