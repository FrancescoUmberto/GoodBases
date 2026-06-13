/**
 * Notion "select" color palette and the helpers that map pill values to colors.
 *
 * Pure module: nothing here touches Obsidian APIs, so it can be reasoned about
 * (and unit-tested) in isolation. Colors are applied to elements through
 * per-pill CSS variables that `styles.css` consumes.
 */

/** A single palette entry: light/dark background + text pairs. */
export interface NotionColor {
	name: string;
	lightBg: string;
	lightFg: string;
	darkBg: string;
	darkFg: string;
}

/** A value → pinned-color map, as produced by `parsePinnedColors`. */
export type PinnedColors = Map<string, NotionColor>;

/** Notion's "select" palette — light/dark background + text pairs. */
export const NOTION_COLORS: NotionColor[] = [
	{ name: 'gray',   lightBg: '#E3E2E0', lightFg: '#32302C', darkBg: '#5A5A5A40', darkFg: '#D4D4D4' },
	{ name: 'brown',  lightBg: '#EEE0DA', lightFg: '#442A1E', darkBg: '#603B2C66', darkFg: '#DDC2B4' },
	{ name: 'orange', lightBg: '#FADEC9', lightFg: '#49290E', darkBg: '#854C1D66', darkFg: '#F5CBA7' },
	{ name: 'yellow', lightBg: '#F9E4BC', lightFg: '#402C1B', darkBg: '#89632A66', darkFg: '#F0DCA5' },
	{ name: 'green',  lightBg: '#DBEDDB', lightFg: '#1C3829', darkBg: '#2B593F66', darkFg: '#B7DEC2' },
	{ name: 'blue',   lightBg: '#D3E5EF', lightFg: '#183347', darkBg: '#28456C66', darkFg: '#B8D2EA' },
	{ name: 'purple', lightBg: '#E8DEEE', lightFg: '#412454', darkBg: '#492F6466', darkFg: '#D5C2E5' },
	{ name: 'pink',   lightBg: '#F5E0E9', lightFg: '#4C2337', darkBg: '#69314C66', darkFg: '#E9C2D5' },
	{ name: 'red',    lightBg: '#FFE2DD', lightFg: '#5D1715', darkBg: '#6E363166', darkFg: '#F1BFBC' },
];

/** Deterministic color per tag string so pills stay stable across renders. */
export function colorFor(text: string): NotionColor {
	let h = 0;
	for (let i = 0; i < text.length; i++) {
		h = (h * 31 + text.charCodeAt(i)) >>> 0;
	}
	return NOTION_COLORS[h % NOTION_COLORS.length];
}

/** Look up a palette entry by its Notion name (e.g. `"green"`); undefined if unknown. */
export function colorByName(name: string): NotionColor | undefined {
	return NOTION_COLORS.find((c) => c.name === name);
}

/** Normalize a pill value for color lookup: drop a leading `#`, lowercase. */
function colorKey(text: string): string {
	return text.replace(/^#/, '').toLowerCase();
}

/**
 * Resolve the color for a pill value: a user-pinned override wins, otherwise
 * the deterministic hash.
 */
export function resolvePillColor(text: string, pinned: PinnedColors): NotionColor {
	const key = colorKey(text);
	return pinned.get(key) ?? colorFor(key);
}

/** Set the per-pill CSS variables on an element from an exact palette color. */
export function applyColorVars(el: HTMLElement, c: NotionColor): void {
	el.style.setProperty('--ntn-pill-bg-light', c.lightBg);
	el.style.setProperty('--ntn-pill-fg-light', c.lightFg);
	el.style.setProperty('--ntn-pill-bg-dark', c.darkBg);
	el.style.setProperty('--ntn-pill-fg-dark', c.darkFg);
}

/** Apply a resolved pill color (pinned override ?? hash) to an element. */
export function applyPillColor(pill: HTMLElement, text: string, pinned: PinnedColors): void {
	applyColorVars(pill, resolvePillColor(text, pinned));
}
