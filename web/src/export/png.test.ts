import { afterEach, describe, expect, it, vi } from "vitest";

import { exportPng } from "./png";

// jsdom has no canvas or real image loading; both are stubbed so the test
// only checks the pipeline: SVG → image → canvas → PNG blob.
function stubCanvas() {
  const ctx = { drawImage: vi.fn(), fillRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (cb: BlobCallback) => cb(new Blob(["png-bytes"], { type: "image/png" })),
  );
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 100;
    naturalHeight = 50;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exportPng", () => {
  it("returns an image/png blob with content", async () => {
    stubCanvas();
    const blob = await exportPng(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>',
      2,
    );
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });
});
