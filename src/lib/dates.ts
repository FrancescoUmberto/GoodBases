/** Helpers for the ISO strings Obsidian's date / datetime properties hold. */

/**
 * Split an ISO value into its `YYYY-MM-DD` date and `HH:mm[:ss]` time
 * (either is `''` when absent). Accepts both the `T` and the space
 * separator; a timezone suffix, if any, is not carried along.
 */
export function splitDateTime(value: string): { date: string; time: string } {
	const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/.exec(value.trim());
	return { date: m?.[1] ?? '', time: m?.[2] ?? '' };
}
