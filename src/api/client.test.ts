import { describe, it, expect } from "vitest";
import { unwrap, unwrapList, ApiError } from "./client";

describe("unwrap", () => {
  it("returns the inner envelope data on success", () => {
    const result = {
      data: { data: { id: "1", name: "alpha" } },
      response: new Response(null, { status: 200 }),
    };
    expect(unwrap(result)).toEqual({ id: "1", name: "alpha" });
  });

  it("throws an ApiError built from the { code, message, status } body", () => {
    const result = {
      error: { code: "NOT_FOUND", message: "missing", status: 404 },
      response: new Response(null, { status: 404 }),
    };
    expect(() => unwrap(result)).toThrowError(ApiError);
    try {
      unwrap(result);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(404);
      expect((e as ApiError).code).toBe("NOT_FOUND");
      expect((e as ApiError).message).toBe("missing");
    }
  });

  it("falls back to the HTTP status when the error body is empty", () => {
    const result = { error: {}, response: new Response(null, { status: 500 }) };
    try {
      unwrap(result);
    } catch (e) {
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).code).toBe("UNKNOWN");
    }
  });
});

describe("unwrapList", () => {
  it("returns items + total from the list envelope", () => {
    const result = {
      data: { data: [{ id: "a" }, { id: "b" }], meta: { total: 2 } },
      response: new Response(null, { status: 200 }),
    };
    expect(unwrapList(result)).toEqual({ items: [{ id: "a" }, { id: "b" }], total: 2 });
  });

  it("defaults total to the item count when meta is absent", () => {
    const result = {
      data: { data: [{ id: "a" }] },
      response: new Response(null, { status: 200 }),
    };
    expect(unwrapList(result)).toEqual({ items: [{ id: "a" }], total: 1 });
  });
});
