import { describe, expect, it } from "vitest";
import { previewKind } from "./preview-kind";
import type { FileMeta } from "@/api/models";

const f = (mime: string, name = "f") => ({ mime, name, original_name: name }) as FileMeta;

describe("previewKind", () => {
  it("maps the mime types the panel can render", () => {
    expect(previewKind(f("application/pdf"))).toBe("pdf");
    expect(previewKind(f("image/png"))).toBe("image");
    expect(previewKind(f("text/plain"))).toBe("text");
    expect(previewKind(f("application/json"))).toBe("text");
    expect(previewKind(f("text/markdown"))).toBe("markdown");
    expect(previewKind(f("text/plain", "notes.md"))).toBe("markdown");
  });

  it("falls back to the extension for octet-stream, then to none", () => {
    expect(previewKind(f("application/octet-stream", "run.log"))).toBe("text");
    expect(previewKind(f("application/octet-stream", "a.bin"))).toBe("none");
    expect(previewKind(f("application/zip", "x.zip"))).toBe("none");
  });

  it("never claims html as renderable markup", () => {
    // text/html previews as source; there is no html kind at all.
    expect(previewKind(f("text/html", "x.html"))).toBe("text");
  });
});
