import { describe, it, expect } from "vitest";
import { readablePayload } from "./tool-payload";

describe("readablePayload", () => {
  it("unwraps user_data-framed MCP content to markdown text", () => {
    const raw =
      '<user_data>{"content":[{"text":"### Page\\n- Title: Quotes","type":"text"}]}</user_data>';
    expect(readablePayload(raw)).toEqual({
      kind: "text",
      text: "### Page\n- Title: Quotes",
      markdown: true,
    });
  });

  it("parses JSON strings into values and drops _meta hints", () => {
    expect(readablePayload('{"_meta":{"tool":"x"},"path":"a.txt","size":3}')).toEqual({
      kind: "value",
      value: { path: "a.txt", size: 3 },
    });
  });

  it("keeps plain text and handles empty", () => {
    expect(readablePayload("hello {world")).toEqual({ kind: "text", text: "hello {world", markdown: false });
    expect(readablePayload(null)).toEqual({ kind: "empty" });
    expect(readablePayload("<user_data></user_data>")).toEqual({ kind: "empty" });
    expect(readablePayload({})).toEqual({ kind: "empty" });
  });

  it("passes structured input through", () => {
    expect(readablePayload({ url: "https://x" })).toEqual({ kind: "value", value: { url: "https://x" } });
  });
});
