// Shared download helper (v1.4c Task 8 fix round 1): the matrix
// session's export items live in a lazy chunk and need the same
// blob→file mechanism the menu uses, so it is a module now instead of
// a private ExportMenu function.

/** Trigger a browser download of `content` under `filename`. */
export function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
