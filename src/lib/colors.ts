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

/**
 * Notion's official color palette (light/dark background + text pairs), from
 * https://docs.super.so/notion-colors. Backgrounds and text differ per theme.
 */
export const NOTION_COLORS: NotionColor[] = [
	{ name: 'gray',   lightBg: '#EBECED', lightFg: '#9B9A97', darkBg: '#454B4E', darkFg: 'rgba(151,154,155,0.95)' },
	{ name: 'brown',  lightBg: '#E9E5E3', lightFg: '#64473A', darkBg: '#434040', darkFg: '#937264' },
	{ name: 'orange', lightBg: '#FAEBDD', lightFg: '#D9730D', darkBg: '#594A3A', darkFg: '#FFA344' },
	{ name: 'yellow', lightBg: '#FBF3DB', lightFg: '#DFAB01', darkBg: '#59563B', darkFg: '#FFDC49' },
	{ name: 'green',  lightBg: '#DDEDEA', lightFg: '#0F7B6C', darkBg: '#354C4B', darkFg: '#4DAB9A' },
	{ name: 'blue',   lightBg: '#DDEBF1', lightFg: '#0B6E99', darkBg: '#364954', darkFg: '#529CCA' },
	{ name: 'purple', lightBg: '#EAE4F2', lightFg: '#6940A5', darkBg: '#443F57', darkFg: '#9A6DD7' },
	{ name: 'pink',   lightBg: '#F4DFEB', lightFg: '#AD1A72', darkBg: '#533B4C', darkFg: '#E255A1' },
	{ name: 'red',    lightBg: '#FBE4E4', lightFg: '#E03E3E', darkBg: '#594141', darkFg: '#FF7369' },
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
