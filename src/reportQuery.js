// [2026-09-10] Turns the filters on the Reports screen into arguments the
// DATABASE understands.
//
// Every report used to download the whole transactions table and then drop
// everything outside the chosen period in the browser. The filters were
// real, but they were applied far too late — after the data had crossed the
// network. At 2,787 rows nobody noticed; at 100,000 the screen stops
// loading, and the business is heading there in about two years.
//
// The rule followed everywhere this is used: a filter is only moved into
// the query where the SAME filter was already being applied in the browser
// straight afterwards. That way not a single figure on any report changes —
// only the amount of data fetched to produce it.
//
// One station is pushed down; several are not, because the API takes one
// location and the multi-station case still filters in the browser. That is
// fine: picking several stations is rare, and picking none means everything
// anyway.

export function queryRange({ selectedLocationIds = [], startDate = null, endDate = null } = {}) {
  const args = {};
  if (selectedLocationIds.length === 1) args.locationId = selectedLocationIds[0];
  if (startDate) args.from = startDate;
  if (endDate) args.to = endDate;
  return args;
}

// stock_adjustments takes its dates under different names, and matches them
// against a full timestamp rather than a calendar date — see
// api.getStockAdjustments.
export function queryRangeAdj({ selectedLocationIds = [], startDate = null, endDate = null } = {}) {
  const args = {};
  if (selectedLocationIds.length === 1) args.locationId = selectedLocationIds[0];
  if (startDate) args.startDate = startDate;
  if (endDate) args.endDate = endDate;
  return args;
}

// A stable dependency for a useEffect: an array prop is a new object on
// every render, so putting it in a dependency list directly would refetch
// forever.
export function rangeKey({ selectedLocationIds = [], startDate = null, endDate = null } = {}) {
  return `${[...selectedLocationIds].sort().join(",")}|${startDate || ""}|${endDate || ""}`;
}
