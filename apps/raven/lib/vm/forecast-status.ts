// Terminal research outcomes are not completed forecasts.
export const INCOMPLETE_STATUSES = ["research_failed", "insufficient_evidence", "max_rounds"] as const;
export type IncompleteStatus = (typeof INCOMPLETE_STATUSES)[number];
export function isIncompleteStatus(status: string | undefined): status is IncompleteStatus {
  return INCOMPLETE_STATUSES.some((value) => value === status);
}
export function completedForecast(status: string | undefined): boolean {
  return status === "converged" || status === "saturated" || status === "no_new_info";
}
export function finishedJobStatus(status: string | undefined, code: number | null) {
  if (isIncompleteStatus(status)) return status;
  if (code === 2) return "unforecastable" as const;
  return code === 0 && completedForecast(status) ? ("done" as const) : ("error" as const);
}
