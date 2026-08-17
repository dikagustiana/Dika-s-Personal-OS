/**
 * Lab display configuration. ONE VALUE, deliberately in code rather than a
 * settings table: the IDR figure on the run log is a reading aid, not a
 * ledger — the stored truth is cost_usd, and a stale display rate misleads
 * by percents while a wrong stored cost misleads forever. Update the rate
 * here when it drifts; the log's tooltip states the rate used.
 */

/** USD→IDR display rate. Set 2026-08-17; round figure on purpose. */
export const USD_TO_IDR_DISPLAY_RATE = 16_500;
