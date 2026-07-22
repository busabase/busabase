import { expect, test } from "@playwright/test";

test("AirApp dashboard responses allow only configured Buda frame ancestors", async ({
  request,
}) => {
  const legacyResponse = await request.get("/dashboard/airapp/security-header-check", {
    maxRedirects: 0,
  });
  expect(legacyResponse.status()).toBe(308);
  expect(legacyResponse.headers()["cache-control"]).toContain("no-store");

  const response = await request.get("/dashboard/local/airapp/security-header-check");

  expect(response.ok()).toBe(true);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");

  const contentSecurityPolicy = response.headers()["content-security-policy"] ?? "";
  expect(contentSecurityPolicy).toContain("default-src 'self'");
  expect(contentSecurityPolicy).toContain("base-uri 'none'");
  expect(contentSecurityPolicy).toContain("object-src 'none'");
  expect(contentSecurityPolicy).toContain(
    "frame-ancestors https://dev.buda.im https://buda.im http://localhost:3040",
  );
  expect(contentSecurityPolicy).not.toContain("frame-ancestors *");
});
