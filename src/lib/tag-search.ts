/**
 * Opening the core search pane for a tag — what clicking a tag does everywhere
 * else in Obsidian (including core Bases' own table, whose `TagValue` render
 * calls `RenderContext.renderTag`, which runs exactly this).
 */
import { App } from 'obsidian';

/** The slice of the core global-search plugin instance we use. */
interface GlobalSearchPlugin {
	openGlobalSearch(query: string): void;
}

/** Shape of `App.internalPlugins` (not part of the public API). */
interface InternalPluginHost {
	internalPlugins?: {
		getEnabledPluginById?(id: string): unknown;
	};
}

/** A tag with its leading `#` (`TagValue` keeps one; raw frontmatter may not). */
export function normalizeTag(tag: string): string {
	const bare = tag.trim().replace(/^#+/, '');
	return bare ? `#${bare}` : '';
}

/**
 * Search the vault for `tag`, revealing the core search pane. Returns false
 * when the search plugin is disabled or the internal API moved — callers keep
 * whatever they were doing instead. Core fails silently here too.
 */
export function openTagSearch(app: App, tag: string): boolean {
	const bare = normalizeTag(tag).slice(1);
	if (!bare) return false;
	const plugin = (app as unknown as InternalPluginHost).internalPlugins
		?.getEnabledPluginById?.('global-search') as GlobalSearchPlugin | undefined;
	if (typeof plugin?.openGlobalSearch !== 'function') return false;
	// Core queries without the `#` (see `renderTag` in the Bases value code).
	plugin.openGlobalSearch(`tag:${bare}`);
	return true;
}
