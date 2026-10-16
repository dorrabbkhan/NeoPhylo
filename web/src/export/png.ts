// PNG export (plan Task 24, spec §6.6): rasterize an exported SVG string
// through an offscreen canvas at `scale`×. Browser-only — the caller is
// a download handler, so there is no jsdom-free fallback.

/** Rasterize `svg` at `scale`× its viewBox size and return a PNG blob. */
export async function exportPng(svg: string, scale: 2): Promise<Blob> {
  const [w, h] = svgViewBox(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(w * scale));
    canvas.height = Math.max(1, Math.ceil(h * scale));
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("canvas 2d context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (blob === null) throw new Error("canvas.toBlob returned null");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Width and height from the SVG's viewBox (falls back to 480×320). */
function svgViewBox(svg: string): [number, number] {
  const m = /viewBox="[^"]*\s([\d.]+)\s([\d.]+)\s*"/.exec(svg);
  if (m === null) return [480, 320];
  return [Number(m[1]), Number(m[2])];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to rasterize SVG"));
    img.src = src;
  });
}
