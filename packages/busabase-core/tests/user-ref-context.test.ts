import { afterEach, describe, expect, it } from "vitest";
import { resolveUserRefs, runWithBusabaseContext } from "../src/context";

describe("resolveUserRefs", () => {
  afterEach(() => {
    delete process.env.BUSABASE_LOCAL_USER_NAME;
  });

  it("uses the open-source local user name only when the host injects it", async () => {
    const users = await runWithBusabaseContext({ localUserName: "Ada Lovelace" }, () =>
      resolveUserRefs(["local-admin", "local-user", "local-producer"]),
    );

    expect(users.get("local-admin")?.name).toBe("Ada Lovelace");
    expect(users.get("local-user")?.name).toBe("Ada Lovelace");
    expect(users.get("local-producer")?.name).toBe("Local Producer");
  });

  it("does not override a host resolver such as Busabase Cloud", async () => {
    const users = await runWithBusabaseContext(
      {
        localUserName: "Local Machine",
        resolveUsers: async () =>
          new Map([
            [
              "local-admin",
              {
                id: "local-admin",
                name: "Registered Cloud User",
                email: "cloud@example.com",
                image: null,
                role: "owner",
              },
            ],
          ]),
      },
      () => resolveUserRefs(["local-admin"]),
    );

    expect(users.get("local-admin")?.name).toBe("Registered Cloud User");
    expect(users.get("local-admin")?.email).toBe("cloud@example.com");
  });
});
