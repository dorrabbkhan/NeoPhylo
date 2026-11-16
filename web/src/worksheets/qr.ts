// QR encoding for worksheet links (v1.4c plan Task 11, spec §7.2):
// generated locally by the vendored uqr encoder — no QR web API and no
// remote image (the no-outside-network rule). The 10 kB-gz budget lives
// inside the lazy worksheet chunk; the whole vendored file gzips to
// ~7.8 kB even before tree-shaking.

import { encode } from "./vendor/uqr.mjs";

export interface QrMatrix {
  /** Module count per side (version × 4 + 17). */
  size: number;
  /** Row-major modules — true is a dark module. No quiet zone. */
  data: boolean[][];
}

/** Encode `text` as a QR matrix at error-correction level L, or null
 * when the link exceeds QR capacity (a >2953-byte payload — a long
 * `#x=` link — gets the text-only fallback per the plan). */
export function qrMatrix(text: string): boolean[][] | null {
  try {
    const r = encode(text, { ecc: "L", border: 0 }) as QrMatrix;
    return r.data;
  } catch {
    return null;
  }
}
