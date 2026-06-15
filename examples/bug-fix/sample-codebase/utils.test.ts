import { describe, expect, it } from "vitest";
import { buildDigest } from "./api.js";
import { formatPreview, takeFirst } from "./utils.js";

describe("takeFirst", () => {
  it("returns the requested number of items", () => {
    expect(takeFirst(["alpha", "beta", "gamma"], 2)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("returns an empty list for non-positive limits", () => {
    expect(takeFirst(["alpha"], 0)).toEqual([]);
  });
});

describe("buildDigest", () => {
  it("uses a three-item preview", () => {
    const digest = buildDigest(["alpha", "beta", "gamma", "delta"]);

    expect(digest.preview).toEqual(["alpha", "beta", "gamma"]);
    expect(digest.headline).toBe("alpha, beta, gamma");
  });
});

describe("formatPreview", () => {
  it("prints an empty preview clearly", () => {
    expect(formatPreview([])).toBe("No events");
  });
});
