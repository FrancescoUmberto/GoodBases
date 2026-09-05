/** The view-settings options GoodBases adds to the Bases toolbar. */
import { BasesAllOptions, BasesViewConfig } from 'obsidian';

/**
 * Build the option descriptors Obsidian renders in the view's settings.
 * Read the values back at render time with `this.config.get(key)`.
 */
export function buildViewOptions(_config: BasesViewConfig): BasesAllOptions[] {
	return [
		{
			type: 'toggle',
			key: 'wrapCells',
			displayName: 'Wrap all content',
			default: true,
		},
		{
			type: 'toggle',
			key: 'verticalLines',
			displayName: 'Show vertical lines',
			default: true,
		},
		{
			type: 'dropdown',
			key: 'openMode',
			displayName: 'Open notes in',
			default: 'tab',
			options: {
				tab: 'New tab',
				panel: 'Page panel',
			},
		},
		{
			type: 'dropdown',
			key: 'titleIcon',
			displayName: 'Name column icon',
			default: 'page',
			options: {
				page: 'Page icon 📄',
				theme: "Obsidian's file icon",
				custom: 'Custom (set below)',
				none: 'Hidden',
			},
		},
		{
			type: 'text',
			key: 'titleIconCustom',
			displayName: 'Custom Name column icon — an emoji, or a Lucide icon name like file-text',
		},
		{
			type: 'multitext',
			key: 'pillProperties',
			displayName: 'Properties to show as colored pills',
		},
		{
			type: 'multitext',
			key: 'pinnedColors',
			displayName: 'Pinned pill colors (value=color — a name: gray, brown, orange, yellow, green, blue, purple, pink, red — or a hex like #0088ff)',
		},
	];
}
