import { describe, expect, it } from "vitest";
import { loginUrl, safeNext } from "@/lib/app";

const HOSTILE = [
  "//evil.com",
  "/\\evil.com",
  "https://evil.com",
  "http:evil.com",
  "javascript:alert(1)",
  "/..//evil.com",
  "/.//evil.com",
  "/a/..//evil.com",
  "/%2e%2e//evil.com",
  "/.%2e//evil.com",
  "/a/b/../..//evil.com",
  "/\tevil",
  "evil.com",
  "",
];

describe("safeNext", () => {
  it.each(HOSTILE)("rejects %j", (x) => {
    expect(safeNext(x)).toBe("/");
    expect(safeNext(x, "/fallback")).toBe("/fallback");
  });

  it.each(HOSTILE)("never returns a protocol-relative or absolute URL for %j", (x) => {
    const out = safeNext(x, "/");
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
    expect(out.startsWith("/\\")).toBe(false);
  });

  it("keeps ordinary relative paths, queries and hashes", () => {
    expect(safeNext("/join/ABCD1234")).toBe("/join/ABCD1234");
    expect(safeNext("/settings/backfill?onboarding=1")).toBe("/settings/backfill?onboarding=1");
    expect(safeNext("/country/LA#eaten")).toBe("/country/LA#eaten");
    expect(safeNext("/a/../country/LA")).toBe("/country/LA");
  });

  it("treats null and undefined as the fallback", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined, "/x")).toBe("/x");
  });

  it.each([...HOSTILE, "/join/ABCD1234", "/a/../b", "/x?y=1#z", "/%2e%2e/a"])(
    "is idempotent for %j",
    (x) => {
      expect(safeNext(safeNext(x))).toBe(safeNext(x));
    },
  );
});

describe("loginUrl", () => {
  it("omits next for the home page and encodes it otherwise", () => {
    expect(loginUrl("/")).toBe("/login");
    expect(loginUrl("/..//evil.com")).toBe("/login");
    expect(loginUrl("/join/ABCD1234")).toBe("/login?next=%2Fjoin%2FABCD1234");
  });
});
