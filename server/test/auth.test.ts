import { beforeAll, describe, expect, it } from "vitest";

process.env.FIRSTFAN_DB = ":memory:";
process.env.SIM_SEED = "auth-test";

const { migrate } = await import("../src/db/migrate.ts");
const { createUser } = await import("../src/domain/users.ts");
const {
  createSession,
  destroySession,
  hashPassword,
  login,
  resolveSession,
  verifyPassword,
} = await import("../src/domain/auth.ts");

beforeAll(() => {
  migrate();
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("hunter22-secure");
    expect(stored.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("hunter22-secure", stored)).toBe(true);
    expect(verifyPassword("hunter22-secur3", stored)).toBe(false);
  });

  it("salts: same password twice → different hashes", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });
});

describe("sessions + login", () => {
  it("signup → session token resolves to the user; logout kills it", () => {
    const user = createUser({
      handle: "maya",
      email: "maya@t.dev",
      passwordHash: hashPassword("mayapassword"),
    });
    const token = createSession(user.id);
    expect(resolveSession(token)?.handle).toBe("maya");
    destroySession(token);
    expect(resolveSession(token)).toBeNull();
  });

  it("login works with handle or email; wrong password rejected", () => {
    expect(login("maya", "mayapassword").user.handle).toBe("maya");
    expect(login("MAYA@T.DEV", "mayapassword").user.handle).toBe("maya");
    expect(() => login("maya", "not-her-password")).toThrowError(/Wrong password/);
    expect(() => login("nobody", "whatever-123")).toThrowError(/No account/);
  });

  it("a legacy account (no password) is claimed by its first login", () => {
    createUser({ handle: "legacy", email: "legacy@t.dev" }); // pre-auth account
    expect(login("legacy", "first-login-sets-this").user.handle).toBe("legacy");
    // now the password is set — a different one no longer works
    expect(() => login("legacy", "something-else-8")).toThrowError(/Wrong password/);
    expect(login("legacy", "first-login-sets-this").user.handle).toBe("legacy");
  });

  it("garbage tokens resolve to nothing", () => {
    expect(resolveSession("not-a-real-token")).toBeNull();
  });
});
