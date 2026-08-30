import { describe, it, expect } from "vitest";
import { stripMarkdown } from "./preview-text";

describe("stripMarkdown", () => {
  it("drops inline emphasis and code", () => {
    expect(stripMarkdown("Here is **bold**, _em_ and `code`.")).toBe("Here is bold, em and code.");
    expect(stripMarkdown("~~gone~~ __strong__")).toBe("gone strong");
  });

  it("drops headings, quotes, list markers and rules", () => {
    expect(stripMarkdown("# Title\n\n> quoted\n- item\n1. one\n---\ntail")).toBe(
      "Title quoted item one tail",
    );
  });

  it("keeps link and image text, drops urls and fences", () => {
    expect(stripMarkdown("see [docs](https://x.y) ![alt](i.png)")).toBe("see docs alt");
    expect(stripMarkdown("```ts\nlet a = 1;\n```")).toBe("let a = 1;");
  });

  it("handles empty input and plain text", () => {
    expect(stripMarkdown(null)).toBe("");
    expect(stripMarkdown("plain 2 * 3 = 6")).toBe("plain 2 * 3 = 6");
  });
});
