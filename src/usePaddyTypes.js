// The React side of the paddy type list — kept apart from paddyTypes.js so
// that file stays pure and testable in node. See paddyTypes.js for why the
// list moved out of the source code in the first place.

import { useEffect, useState } from "react";
import { api } from "./api.js";
import { getCachedProducts, setCachedProducts } from "./offlineQueue.js";
import { paddyTypeNames } from "./paddyTypes.js";

/**
 * The paddy types to offer, and whether the server has answered yet.
 *
 * `types`  — names, ready to render. Starts from this device's cached copy so
 *            the dropdown is never empty while the network is thinking, then
 *            updates in place when the real list lands.
 * `loaded` — true once the server has answered OR failed. Only used to decide
 *            whether to show "still loading" next to an empty list; the field
 *            is never blocked on it, because a station with a slow connection
 *            must still be able to finish a ticket.
 */
export function usePaddyTypes() {
  const [types, setTypes] = useState(() => paddyTypeNames(getCachedProducts()));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getProducts()
      .then((rows) => {
        if (!alive) return;
        if (Array.isArray(rows) && rows.length) {
          // Refresh this device's offline copy at the same time — the
          // dropdown and the offline resolver then agree on what exists.
          setCachedProducts(rows);
          setTypes(paddyTypeNames(rows));
        }
        setLoaded(true);
      })
      .catch(() => {
        // Offline, or the request failed. The cached list above still
        // stands; never clear it, and never fall back to a list in code.
        if (alive) setLoaded(true);
      });
    return () => { alive = false; };
  }, []);

  return { types, loaded };
}
