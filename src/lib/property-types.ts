/**
 * Vault-level property types. Obsidian keeps a per-vault registry of what
 * widget each frontmatter property edits with (text, date, multitext, …);
 * it is reachable through the undocumented-but-stable
 * `app.metadataTypeManager.getPropertyInfo`, guarded here so a moved API
 * degrades to "unknown" rather than throwing.
 */
import { App } from 'obsidian';

/**
 * The widget a property is registered with (`date`, `datetime`, `multitext`,
 * `tags`, `text`, …), or undefined when the registry can't be reached.
 * Properties never assigned a type come back as `text`.
 */
export function propertyWidget(app: App, name: string): string | undefined {
	const mtm = (app as unknown as {
		metadataTypeManager?: { getPropertyInfo?: (name: string) => unknown };
	}).metadataTypeManager;
	const info = mtm?.getPropertyInfo?.(name) as
		| { type?: string; widget?: string }
		| string
		| undefined;
	return typeof info === 'string' ? info : info?.widget ?? info?.type;
}

/** Whether a property is registered as a date or a date-with-time. */
export function isDateWidget(widget: string | undefined): boolean {
	return widget === 'date' || widget === 'datetime';
}
