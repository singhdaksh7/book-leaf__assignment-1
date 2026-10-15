/** `@db.Date` columns come back as UTC-midnight Dates; serialise without any local-timezone conversion. */
export const toDateOnly = (value: Date): string => value.toISOString().slice(0, 10);
export const toDateOnlyOrNull = (value: Date | null): string | null => (value === null ? null : toDateOnly(value));
export const toTimestamp = (value: Date): string => value.toISOString();
