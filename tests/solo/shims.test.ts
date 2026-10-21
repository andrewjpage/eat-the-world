import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import dynamic from "../../solo/src/shims/dynamic";
import Link from "../../solo/src/shims/link";
import { pathFromHash, searchFromHash, toHref } from "../../solo/src/shims/navigation";

describe("toHref", () => {
  it("turns an app path into a hash route", () => {
    expect(toHref("/country/FR")).toBe("#/country/FR");
    expect(toHref("/")).toBe("#/");
    expect(toHref("/check-in?restaurant=abc")).toBe("#/check-in?restaurant=abc");
  });

  it("leaves external and in-page links alone", () => {
    expect(toHref("https://wa.me/1")).toBe("https://wa.me/1");
    expect(toHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(toHref("#x")).toBe("#x");
  });
});

describe("pathFromHash", () => {
  it("reads the route path out of the hash", () => {
    expect(pathFromHash("#/country/FR?x=1")).toBe("/country/FR");
    expect(pathFromHash("#/")).toBe("/");
  });

  it("falls back to the root", () => {
    expect(pathFromHash("")).toBe("/");
    expect(pathFromHash("#")).toBe("/");
  });
});

describe("searchFromHash", () => {
  it("reads the query out of the hash", () => {
    expect(searchFromHash("#/check-in?restaurant=abc").get("restaurant")).toBe("abc");
  });

  it("is empty when the hash has no query", () => {
    expect([...searchFromHash("#/country/FR")]).toEqual([]);
    expect([...searchFromHash("")]).toEqual([]);
  });
});

describe("Link", () => {
  it("renders an anchor to the hash route and keeps Next-only props off the DOM", () => {
    const html = renderToStaticMarkup(
      createElement(
        Link,
        { href: "/country/FR", prefetch: false, scroll: false, replace: true, className: "chip" },
        "France",
      ),
    );
    expect(html).toBe('<a class="chip" href="#/country/FR">France</a>');
  });

  it("leaves an external link pointing outside the app", () => {
    const html = renderToStaticMarkup(createElement(Link, { href: "https://wa.me/1" }, "Chat"));
    expect(html).toBe('<a href="https://wa.me/1">Chat</a>');
  });
});

describe("dynamic", () => {
  it("shows the loading fallback until the component has loaded", () => {
    const Lazy = dynamic(() => new Promise<never>(() => {}), {
      ssr: false,
      loading: () => createElement("p", null, "Unrolling the map…"),
    });
    expect(renderToStaticMarkup(createElement(Lazy))).toContain("Unrolling the map…");
  });
});
