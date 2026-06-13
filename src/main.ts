/**
 * GoodBases plugin entry point. Registers the single `notion-table` Bases view;
 * all rendering and editing lives in `./view`, and reusable, Obsidian-agnostic
 * helpers live in `./lib`.
 */
import { Notice, Plugin } from 'obsidian';
import { NOTION_TABLE_VIEW } from './constants';
import { buildViewOptions } from './view-options';
import { NotionTableView } from './view/notion-table-view';

export default class NotionBasesPlugin extends Plugin {
	async onload() {
		if (typeof this.registerBasesView !== 'function') {
			new Notice('GoodBases: requires Obsidian 1.10.0+ (registerBasesView API missing).', 8000);
			return;
		}
		const ok = this.registerBasesView(NOTION_TABLE_VIEW, {
			name: 'Notion-style table',
			icon: 'lucide-table-2',
			factory: (controller, containerEl) =>
				new NotionTableView(controller, containerEl),
			options: buildViewOptions,
		});
		if (!ok) {
			new Notice('GoodBases: view registration failed. Is the Bases core plugin enabled?', 8000);
		}
	}
}
