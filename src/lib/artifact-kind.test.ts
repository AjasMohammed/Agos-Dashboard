import { describe, expect, it } from "vitest";
import { artifactKind, isArtifact } from "./artifact-kind";
import type { FileMeta } from "@/api/models";

const file = (tags: string[]) => ({ tags }) as FileMeta;

describe("artifact tags", () => {
  it("only treats a tagged row as an artifact", () => {
    // The guard that keeps an uploaded .html off the srcDoc path.
    expect(isArtifact(file(["artifact", "kind:html"]))).toBe(true);
    expect(isArtifact(file(["kind:html"]))).toBe(false);
    expect(isArtifact({} as FileMeta)).toBe(false);
  });

  it("reads the kind tag, defaulting to markdown", () => {
    expect(artifactKind(file(["artifact", "kind:html"]))).toBe("html");
    expect(artifactKind(file(["artifact", "kind:slides"]))).toBe("slides");
    expect(artifactKind(file(["artifact", "kind:markdown"]))).toBe("markdown");
    // Unknown or absent kind must not fall through to the html branch.
    expect(artifactKind(file(["artifact", "kind:pdf"]))).toBe("markdown");
    expect(artifactKind(file(["artifact"]))).toBe("markdown");
  });
});
