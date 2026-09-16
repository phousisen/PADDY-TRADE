import { useEffect, useState } from "react";
import { onShouldRefetch } from "./sessionWatch.js";

// A number that goes up when the app has come back and it is worth asking
// the database again.
//
// [2026-09-16] SISEN's parents' phones: "sometimes the data is all 0 that
// they need to log out and log back in to see it back. its never auto."
//
// A screen puts this in its effect's dependency list and nothing else
// changes — the same fetch it already had simply runs again. There is no new
// loading path to get wrong, and a page that does not use it behaves exactly
// as it did before.
//
// The decision about WHEN it is worth asking lives in sessionWatch.js, which
// is pure and tested; this is only the wire into React.
export function useRefetchSignal() {
  const [n, setN] = useState(0);
  useEffect(() => onShouldRefetch(() => setN((x) => x + 1)), []);
  return n;
}
