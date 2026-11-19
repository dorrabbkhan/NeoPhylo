// Reading-area error text (v1.4d plan Task 8): the InvalidReading
// kind carries a field + message — `link`/`read` errors are already
// complete sentences; other fields prefix the message. Every other
// kind surfaces its name. Same convention LabPage uses for
// InvalidExercise.

import type { NeoError } from "../engine/generated/NeoError";

export function readErrorMessage(e: NeoError): string {
  if (e.kind === "InvalidReading") {
    return e.field === "link" || e.field === "read"
      ? e.msg
      : `${e.field}: ${e.msg}`;
  }
  return e.kind;
}
