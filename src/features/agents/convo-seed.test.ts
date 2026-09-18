import { describe, expect, it } from "vitest";
import { nextSpeaker, titleOf, USER_SPEAKER } from "./convo-seed";

describe("titleOf", () => {
  it("keeps only the line the operator wrote", () => {
    expect(titleOf("Ship the migration\n\nThis continues…\n[alpha]: hi")).toBe(
      "Ship the migration",
    );
    expect(titleOf("Plain topic")).toBe("Plain topic");
  });
});

describe("nextSpeaker", () => {
  const p = ["alpha", "beta", "gamma"];
  const rows = (...names: string[]) => names.map((agent_name) => ({ agent_name }));

  it("rotates after the last agent, skipping operator rows", () => {
    expect(nextSpeaker(p, [])).toBe("alpha");
    expect(nextSpeaker(p, rows("alpha"))).toBe("beta");
    expect(nextSpeaker(p, rows("alpha", "beta", USER_SPEAKER))).toBe("gamma");
    expect(nextSpeaker(p, rows("gamma"))).toBe("alpha");
  });

  it("starts over when the last speaker left the roster", () => {
    expect(nextSpeaker(p, rows("delta"))).toBe("alpha");
  });
});
