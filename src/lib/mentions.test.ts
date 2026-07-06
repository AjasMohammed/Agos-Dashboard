import { describe, expect, it } from "vitest";
import { mentionAt, matchFiles } from "./mentions";
import type { FileMeta } from "@/api/models";

function file(over: Partial<FileMeta>): FileMeta {
  return {
    id: "id",
    name: "report.pdf",
    original_name: "report.pdf",
    mime: "application/pdf",
    size: 100,
    scope: "global",
    tags: [],
    uploaded_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("mentionAt", () => {
  it("detects an @token at the caret (start of text and after whitespace)", () => {
    expect(mentionAt("@rep", 4)).toEqual({ start: 0, query: "rep" });
    expect(mentionAt("summarize @audit-log.txt", 24)).toEqual({ start: 10, query: "audit-log.txt" });
    expect(mentionAt("read @", 6)).toEqual({ start: 5, query: "" });
  });

  it("ignores @ inside a word (emails) and text after the caret", () => {
    expect(mentionAt("mail me@example.com", 19)).toBeNull();
    // Caret before the @ token → no active mention.
    expect(mentionAt("hello @report", 5)).toBeNull();
  });

  it("ends the token at characters outside [\\w.-]", () => {
    expect(mentionAt("@report done", 12)).toBeNull();
    expect(mentionAt("@report, next", 8)).toBeNull();
  });
});

describe("matchFiles", () => {
  const files = [
    file({ id: "1", name: "notes.md", original_name: "My Notes.md" }),
    file({ id: "2", name: "report.pdf" }),
    file({ id: "3", name: "audit-report.csv" }),
  ];

  it("matches case-insensitively on name and original name", () => {
    expect(matchFiles(files, "NOTES").map((f) => f.id)).toEqual(["1"]);
    expect(matchFiles(files, "my no").map((f) => f.id)).toEqual(["1"]);
  });

  it("ranks prefix matches before substring matches", () => {
    expect(matchFiles(files, "report").map((f) => f.id)).toEqual(["2", "3"]);
  });

  it("returns everything (capped) for an empty query", () => {
    expect(matchFiles(files, "")).toHaveLength(3);
    const many = Array.from({ length: 20 }, (_, i) => file({ id: String(i), name: `f${i}.txt` }));
    expect(matchFiles(many, "")).toHaveLength(8);
  });
});
