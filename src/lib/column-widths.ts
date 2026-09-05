/**
 * Per-column widths set by dragging the header resize handles.
 *
 * Stored in the view config (not a toolbar option — the drag handle is the
 * UI) as a string array of `key=px` entries, mirroring `pinnedColors`, so the
 * widths stay readable and hand-editable inside the `.base` file.
 */

/**
 * Config key for the synthetic title ("Name") column, which has no
 * `BasesPropertyId`. Real property ids always carry a `type.` prefix, so this
 * can never collide with one.
 */
export const TITLE_COLUMN_KEY = '__title';

/** Narrowest a column may be dragged, in pixels. */
export const MIN_COLUMN_WIDTH = 60;

/** Column key (a `BasesPropertyId` or `TITLE_COLUMN_KEY`) → width in px. */
export type ColumnWidths = Map<string, number>;

/** Parse the stored `key=px` entries; malformed or too-small ones are dropped. */
export function parseColumnWidths(raw: unknown): ColumnWidths {
	const widths: ColumnWidths = new Map();
	if (!Array.isArray(raw)) return widths;
	for (const item of raw) {
		const match = String(item).match(/^(.+?)\s*[=:]\s*(\d+(?:\.\d+)?)(?:px)?$/);
		if (!match) continue;
		const key = match[1].trim();
		const px = Number(match[2]);
		if (!key || !Number.isFinite(px)) continue;
		widths.set(key, Math.max(MIN_COLUMN_WIDTH, Math.round(px)));
	}
	return widths;
}

/** Render the map back into the `key=px` strings stored in the view config. */
export function serializeColumnWidths(widths: ColumnWidths): string[] {
	return Array.from(widths, ([key, px]) => `${key}=${Math.round(px)}`);
}
