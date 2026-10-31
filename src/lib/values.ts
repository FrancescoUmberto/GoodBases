/** Helpers for turning Bases `Value`s into the plain strings the table renders. */
import { ListValue, NullValue, TagValue, Value } from 'obsidian';

/** One rendered item of a value, with the bit of type info pills care about. */
export interface ValueItem {
	/** The display string; a tag keeps the leading `#` its value carries. */
	text: string;
	/** True when this came from a Bases `TagValue`, i.e. it is a real tag. */
	isTag: boolean;
}

/**
 * Flatten a Bases value to display items. A `ListValue` yields one item per
 * non-empty element; a scalar yields a single item; `null` and an empty
 * Bases `NullValue` yield `[]` (so empty cells never render a "null" pill).
 */
export function valueToItems(value: Value | null): ValueItem[] {
	if (value === null || value instanceof NullValue) return [];
	if (value instanceof ListValue) {
		const out: ValueItem[] = [];
		for (let i = 0; i < value.length(); i++) {
			const item = value.get(i);
			if (item === null || item instanceof NullValue) continue;
			const s = item.toString();
			if (s) out.push({ text: s, isTag: item instanceof TagValue });
		}
		return out;
	}
	const s = value.toString();
	return s ? [{ text: s, isTag: value instanceof TagValue }] : [];
}

/**
 * Flatten a Bases value to display strings. A `ListValue` yields one string per
 * non-empty item; a scalar yields a single-element array; `null` yields `[]`.
 */
export function valueToStrings(value: Value | null): string[] {
	return valueToItems(value).map((item) => item.text);
}
