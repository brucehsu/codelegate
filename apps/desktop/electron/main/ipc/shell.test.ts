import { describe, expect, it, vi } from "vitest";

import { isAllowedExternalUrl, openExternalUrl } from "./shell";

describe("isAllowedExternalUrl", () => {
  it("allows web and mail links", () => {
    for (const url of [
      "https://codelegate.dev",
      "http://localhost:5173/x?y=1#z",
      "mailto:bruce@example.com",
      "HTTPS://EXAMPLE.COM",
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(true);
    }
  });

  it("refuses everything else", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vscode://file/etc/passwd",
      "app://codelegate/index.html",
      "not a url",
      "",
      "   ",
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(false);
    }
  });

  it("refuses non-string input", () => {
    expect(isAllowedExternalUrl(undefined)).toBe(false);
    expect(isAllowedExternalUrl(null)).toBe(false);
    expect(isAllowedExternalUrl(42)).toBe(false);
  });
});

describe("openExternalUrl", () => {
  it("hands allowed URLs to the opener", async () => {
    const opener = vi.fn(async () => undefined);
    await openExternalUrl("https://codelegate.dev", opener);
    expect(opener).toHaveBeenCalledWith("https://codelegate.dev");
  });

  it("never reaches the opener for a refused URL", async () => {
    const opener = vi.fn(async () => undefined);
    await expect(openExternalUrl("file:///etc/passwd", opener)).rejects.toThrow(/Refusing to open/u);
    expect(opener).not.toHaveBeenCalled();
  });
});
