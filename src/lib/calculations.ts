/**
 * Notion's "Calculate" footer, mapped onto Bases summaries.
 *
 * Core Bases already has per-view summaries — `summaries: { prop: key }` in
 * the view config, evaluated by `BasesQueryResult.getSummaryValue` — with a
 * fixed set of built-in functions per value type (Obsidian 1.12.4: Number
 * has Average/Min/Max/Sum/Range/Median/Stddev, Date has Earliest/Latest/
 * Range, Boolean has Checked/Unchecked, and every type has Empty/Filled/
 * Unique). Notion's Calculate list is mostly that same set under other
 * names, so each Notion label maps onto a core key where one exists and the
 * choice round-trips with the core table's own summary row. The few Notion
 * calculations core has no function for — Count all and the percentages —
 * are derived here from the core ones and stored under the view's own
 * `calculations` config key instead (see `parseCalculations`).
 */
import { BasesEntry, BasesPropertyId, BooleanValue, DateValue, NullValue, NumberValue, Value } from 'obsidian';

/** The value type a column's calculations are chosen for. */
export type CalcKind = 'any' | 'number' | 'date' | 'boolean';

export interface CalcOption {
	/** A core summary key (`Sum`) or one of the local keys computed by us. */
	key: string;
	/** Notion's name for it. */
	label: string;
	/** True when core has no summary function and the value is derived locally. */
	local: boolean;
}

/** Local (non-core) calculations: label, plus the core count they divide by the row count. */
const LOCAL: Record<string, { label: string; of?: string }> = {
	count: { label: 'Count all' },
	percentEmpty: { label: 'Percent empty', of: 'Empty' },
	percentFilled: { label: 'Percent not empty', of: 'Filled' },
	percentChecked: { label: 'Percent checked', of: 'Checked' },
	percentUnchecked: { label: 'Percent unchecked', of: 'Unchecked' },
};

/** Core keys → Notion labels; `Range` reads differently for dates. */
const CORE_LABELS: Record<string, string> = {
	Unique: 'Count unique values',
	Empty: 'Count empty',
	Filled: 'Count not empty',
	Sum: 'Sum',
	Average: 'Average',
	Median: 'Median',
	Min: 'Min',
	Max: 'Max',
	Range: 'Range',
	Stddev: 'Standard deviation',
	Earliest: 'Earliest date',
	Latest: 'Latest date',
	Checked: 'Checked',
	Unchecked: 'Unchecked',
};

/** Menu order per kind, following Notion's list (the shared block first). */
const ORDER: Record<CalcKind, string[]> = {
	any: ['count', 'Unique', 'Empty', 'Filled', 'percentEmpty', 'percentFilled'],
	number: ['Sum', 'Average', 'Median', 'Min', 'Max', 'Range', 'Stddev'],
	date: ['Earliest', 'Latest', 'Range'],
	boolean: ['Checked', 'Unchecked', 'percentChecked', 'percentUnchecked'],
};

export function isLocalCalc(key: string): boolean {
	return Object.prototype.hasOwnProperty.call(LOCAL, key);
}

/** The core count a local percentage is a share of (`null` for Count all). */
export function localCalcBase(key: string): string | null {
	return LOCAL[key]?.of ?? null;
}

/** Which calculations apply to a column, from a sample of its values. */
export function calcKind(sample: Value | null): CalcKind {
	if (sample instanceof NumberValue) return 'number';
	if (sample instanceof DateValue) return 'date';
	if (sample instanceof BooleanValue) return 'boolean';
	return 'any';
}

/** First non-empty value of the property, which decides the column's kind. */
export function sampleValue(entries: BasesEntry[], prop: BasesPropertyId): Value | null {
	for (const entry of entries) {
		const value = entry.getValue(prop);
		if (value !== null && !(value instanceof NullValue)) return value;
	}
	return null;
}

/** The menu's options for a column of the given kind, in Notion's order. */
export function calcOptions(kind: CalcKind): CalcOption[] {
	const keys = kind === 'any' ? ORDER.any : [...ORDER.any, ...ORDER[kind]];
	return keys.map((key) => ({ key, label: calcLabel(key, kind), local: isLocalCalc(key) }));
}

/** Notion's label for a key; a custom summary formula shows under its own name. */
export function calcLabel(key: string, kind: CalcKind): string {
	if (isLocalCalc(key)) return LOCAL[key].label;
	if (key === 'Range' && kind === 'date') return 'Date range';
	return CORE_LABELS[key] ?? key;
}

/** `33.3%` — one decimal, no trailing `.0`; an empty table is 0%. */
export function formatPercent(part: number, total: number): string {
	if (total <= 0) return '0%';
	const pct = Math.round((part / total) * 1000) / 10;
	return `${pct}%`;
}

/** Property id → local calculation key (only the non-core ones live here). */
export type Calculations = Map<string, string>;

/** Parse the stored `prop=key` entries; unknown keys are dropped. */
export function parseCalculations(raw: unknown): Calculations {
	const calcs: Calculations = new Map();
	if (!Array.isArray(raw)) return calcs;
	for (const item of raw) {
		const match = String(item).match(/^(.+?)\s*=\s*(\w+)$/);
		if (!match) continue;
		const prop = match[1].trim();
		const key = match[2];
		if (prop && isLocalCalc(key)) calcs.set(prop, key);
	}
	return calcs;
}

/** Render the map back into the `prop=key` strings stored in the view config. */
export function serializeCalculations(calcs: Calculations): string[] {
	return Array.from(calcs, ([prop, key]) => `${prop}=${key}`);
}
