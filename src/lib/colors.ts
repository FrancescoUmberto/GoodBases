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

interface RGB {
	r: number;
	g: number;
	b: number;
}

/** Parse `#rgb` / `#rrggbb` (the `#` optional); undefined when it isn't a hex. */
function parseHex(spec: string): RGB | undefined {
	const m = spec.trim().replace(/^#/, '');
	if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(m)) return undefined;
	const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
	return {
		r: parseInt(full.slice(0, 2), 16),
		g: parseInt(full.slice(2, 4), 16),
		b: parseInt(full.slice(4, 6), 16),
	};
}

function rgbToHex({ r, g, b }: RGB): string {
	const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Hue in [0,360), saturation and lightness in [0,1]. */
function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
	const rn = r / 255, gn = g / 255, bn = b / 255;
	const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	const d = max - min;
	if (!d) return { h: 0, s: 0, l };
	const s = d / (1 - Math.abs(2 * l - 1));
	let h: number;
	if (max === rn) h = ((gn - bn) / d) % 6;
	else if (max === gn) h = (bn - rn) / d + 2;
	else h = (rn - gn) / d + 4;
	return { h: (h * 60 + 360) % 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): RGB {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] =
		h < 60 ? [c, x, 0] :
		h < 120 ? [x, c, 0] :
		h < 180 ? [0, c, x] :
		h < 240 ? [0, x, c] :
		h < 300 ? [x, 0, c] :
		[c, 0, x];
	return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: RGB): number {
	const lin = (v: number) => {
		const s = v / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors (1–21). */
function contrast(a: RGB, b: RGB): number {
	const la = luminance(a), lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Pick readable pill text for an arbitrary background: a same-hue tint (very
 * dark or very light, whichever side has more room) when it clears the WCAG AA
 * 4.5:1 bar, otherwise plain near-black / white. Keeps custom pills looking
 * like Notion's tinted-text palette without ever going unreadable.
 */
function readableOn(bg: RGB): string {
	const goDark = contrast(bg, { r: 0, g: 0, b: 0 }) >= contrast(bg, { r: 255, g: 255, b: 255 });
	const { h, s } = rgbToHsl(bg);
	const tinted = hslToRgb(h, Math.min(s, 0.85), goDark ? 0.2 : 0.94);
	if (contrast(bg, tinted) >= 4.5) return rgbToHex(tinted);
	return goDark ? '#1A1A1A' : '#FFFFFF';
}

/**
 * Build a palette entry from any hex color the user picked. The chosen color is
 * the pill background in BOTH themes (what you pick is what you get); only the
 * text color is derived, for contrast.
 */
export function customColor(spec: string): NotionColor | undefined {
	const rgb = parseHex(spec);
	if (!rgb) return undefined;
	const bg = rgbToHex(rgb);
	const fg = readableOn(rgb);
	return { name: bg, lightBg: bg, lightFg: fg, darkBg: bg, darkFg: fg };
}

/**
 * Resolve a color spec as written by the user: one of the nine Notion names
 * (`green`) or a custom hex (`#0088ff`, `0088ff`, `#08f`).
 */
export function parseColorSpec(spec: string): NotionColor | undefined {
	const s = spec.trim();
	return colorByName(s.toLowerCase()) ?? customColor(s);
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
	el.setCssProps({
		'--ntn-pill-bg-light': c.lightBg,
		'--ntn-pill-fg-light': c.lightFg,
		'--ntn-pill-bg-dark': c.darkBg,
		'--ntn-pill-fg-dark': c.darkFg,
	});
}

/** Apply a resolved pill color (pinned override ?? hash) to an element. */
export function applyPillColor(pill: HTMLElement, text: string, pinned: PinnedColors): void {
	applyColorVars(pill, resolvePillColor(text, pinned));
}
