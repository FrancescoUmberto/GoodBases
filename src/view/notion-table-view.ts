/**
 * The `notion-table` Bases view: renders query results as a Notion-style table
 * with hover OPEN buttons, colored pills, inline editing, and a select editor
 * for pill cells. Re-renders from scratch on every `onDataUpdated`.
 */
import {
	BasesEntry,
	BasesPropertyId,
	BasesView,
	BooleanValue,
	Notice,
	NumberValue,
	QueryController,
} from 'obsidian';
import { LOG_PREFIX, NOTION_TABLE_VIEW } from '../constants';
import { PinnedColors, applyPillColor, colorByName } from '../lib/colors';
import { PillDetection, computePillProps, parsePinnedColors } from '../lib/pills';
import { valueToStrings } from '../lib/values';
import { SelectEditor } from './select-editor';

export class NotionTableView extends BasesView {
	readonly type = NOTION_TABLE_VIEW;
	private rootEl: HTMLElement;
	/** Pill / list classification, recomputed each update. */
	private pills: PillDetection = { pillProps: new Set(), listProps: new Set() };
	/** User-pinned value → color overrides from the `pinnedColors` view option. */
	private pinnedColors: PinnedColors = new Map();
	/** The open select editor, if any (also drives outside-click detection). */
	private selectEditor: SelectEditor | null = null;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.rootEl = parentEl.createDiv({ cls: 'ntn-root' });
		this.register(() => this.closeSelectMenu());
		// rootEl.doc resolves to the view's own document, so this also works
		// when the view lives in a popout window (plain `document` would not).
		// One persistent capture-phase listener that no-ops unless a menu is open
		// — do not revert to a per-menu `document.addEventListener`.
		this.registerDomEvent(this.rootEl.doc, 'mousedown', (evt) => {
			if (this.selectEditor && !this.selectEditor.contains(evt.target as Node)) {
				this.closeSelectMenu();
			}
		}, { capture: true });
	}

	onDataUpdated(): void {
		const root = this.rootEl;
		root.empty();

		// Default-on: only an explicit `false` turns wrapping off (mirrors verticalLines).
		root.toggleClass('ntn-wrap', this.config.get('wrapCells') !== false);
		root.toggleClass('ntn-vlines', this.config.get('verticalLines') !== false);

		const props = this.config.getOrder();
		this.pills = computePillProps(props, this.data.data, this.config, this.app);
		this.pinnedColors = parsePinnedColors(this.config.get('pinnedColors'));

		const table = root.createEl('table', { cls: 'ntn-table' });

		// ---- Header ----
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		const thTitle = headRow.createEl('th', { cls: 'ntn-th ntn-col-title' });
		thTitle.createSpan({ cls: 'ntn-th-icon', text: 'Aa' });
		thTitle.createSpan({ text: 'Name' });
		for (const prop of props) {
			const th = headRow.createEl('th', { cls: 'ntn-th' });
			th.createSpan({ text: this.config.getDisplayName(prop) });
		}

		// ---- Body (group-aware) ----
		const tbody = table.createEl('tbody');
		const colCount = props.length + 1;

		for (const group of this.data.groupedData) {
			if (group.hasKey() && group.key) {
				const gRow = tbody.createEl('tr', { cls: 'ntn-group-row' });
				const gCell = gRow.createEl('td', { attr: { colspan: String(colCount) } });
				const pill = gCell.createSpan({ cls: 'ntn-pill' });
				this.applyPillColor(pill, group.key.toString());
				pill.setText(group.key.toString());
				gCell.createSpan({ cls: 'ntn-group-count', text: String(group.entries.length) });
			}
			for (const entry of group.entries) {
				this.renderRow(tbody, entry, props);
			}
		}

		// ---- "+ New" footer ----
		const newRow = root.createDiv({ cls: 'ntn-new-row' });
		newRow.createSpan({ cls: 'ntn-new-plus', text: '+' });
		newRow.createSpan({ text: 'New' });
		newRow.addEventListener('click', () => void this.createFileForView());
	}

	private renderRow(
		tbody: HTMLElement,
		entry: BasesEntry,
		props: BasesPropertyId[],
	): void {
		const tr = tbody.createEl('tr', { cls: 'ntn-row' });

		// Title cell: page icon + name + hover OPEN button
		const titleTd = tr.createEl('td', { cls: 'ntn-td ntn-col-title' });
		const titleWrap = titleTd.createDiv({ cls: 'ntn-title-wrap' });
		titleWrap.createSpan({ cls: 'ntn-page-icon', text: '📄' });
		const link = titleWrap.createSpan({
			cls: 'ntn-title-text',
			text: entry.file.basename,
		});
		link.addEventListener('click', (evt) => {
			void this.app.workspace.openLinkText(
				entry.file.path, '', evt.ctrlKey || evt.metaKey,
			);
		});
		const openBtn = titleWrap.createSpan({ cls: 'ntn-open-btn', text: 'OPEN' });
		openBtn.addEventListener('click', (evt) => {
			evt.stopPropagation();
			void this.app.workspace.openLinkText(entry.file.path, '', true);
		});

		for (const prop of props) {
			const td = tr.createEl('td', { cls: 'ntn-td' });
			this.renderCell(td, entry, prop);
		}
	}

	private renderCell(td: HTMLElement, entry: BasesEntry, prop: BasesPropertyId): void {
		const value = entry.getValue(prop);
		const editable = prop.startsWith('note.');
		const propName = prop.split('.').slice(1).join('.');

		// ---- Pills (lists, tags, user-selected select-like properties) ----
		if (this.pills.pillProps.has(prop)) {
			const wrap = td.createDiv({ cls: 'ntn-pills' });
			const items = valueToStrings(value);
			for (const item of items) {
				const pill = wrap.createSpan({ cls: 'ntn-pill' });
				this.applyPillColor(pill, item);
				pill.setText(item.replace(/^#/, ''));
			}
			if (editable && propName !== 'tags') {
				td.addClass('ntn-editable');
				td.addEventListener('click', () =>
					this.openSelectEditor(td, entry, prop, propName),
				);
			}
			return;
		}

		// ---- Checkboxes write straight back to frontmatter ----
		if (value instanceof BooleanValue) {
			const cb = td.createEl('input', { type: 'checkbox', cls: 'ntn-checkbox' });
			cb.checked = value.isTruthy();
			if (editable) {
				cb.addEventListener('change', () => {
					void this.writeProperty(entry, propName, cb.checked);
				});
			} else {
				cb.disabled = true;
			}
			return;
		}

		// ---- Plain values: native render, click-to-edit for note.* ----
		const cellEl = td.createDiv({ cls: 'ntn-cell' });
		if (value !== null) {
			value.renderTo(cellEl, this.app.renderContext);
		}
		if (editable) {
			td.addClass('ntn-editable');
			const kind = value instanceof NumberValue ? 'number' : 'text';
			td.addEventListener('click', (evt) => {
				// Don't hijack clicks on links rendered inside the cell.
				if ((evt.target as HTMLElement).closest('a')) return;
				this.editCell(td, entry, propName, value ? value.toString() : '', kind);
			});
		}
	}

	/** Swap a cell's content for an input; commit on Enter/blur, cancel on Esc. */
	private editCell(
		td: HTMLElement,
		entry: BasesEntry,
		propName: string,
		current: string,
		kind: 'text' | 'number',
	): void {
		if (td.querySelector('input.ntn-input')) return; // already editing
		td.empty();
		const input = td.createEl('input', { type: 'text', cls: 'ntn-input' });
		input.value = current;
		input.focus();
		input.select();

		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;
			const raw = input.value.trim();
			let out: unknown = raw;
			if (kind === 'number') {
				const n = Number(raw);
				out = raw === '' ? null : (Number.isNaN(n) ? raw : n);
			} else if (raw === '') {
				out = null;
			}
			void this.writeProperty(entry, propName, out);
		};

		input.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') {
				commit();
			} else if (evt.key === 'Escape') {
				committed = true; // suppress blur commit
				this.onDataUpdated(); // re-render, discarding the edit
			}
		});
		input.addEventListener('blur', commit);
	}

	private async writeProperty(entry: BasesEntry, propName: string, value: unknown): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(entry.file, (fm: Record<string, unknown>) => {
				if (value === null) {
					delete fm[propName];
				} else {
					fm[propName] = value;
				}
			});
			// Bases reacts to the metadata change and calls onDataUpdated for us.
		} catch (e) {
			console.error(`${LOG_PREFIX} failed to write property`, propName, e);
			new Notice(`Couldn't update "${propName}".`);
			this.onDataUpdated();
		}
	}

	/** Color a pill element using this view's pinned-color overrides. */
	private applyPillColor(pill: HTMLElement, text: string): void {
		applyPillColor(pill, text, this.pinnedColors);
	}

	/** Open the Notion-style select editor for a pill cell. */
	private openSelectEditor(
		td: HTMLElement,
		entry: BasesEntry,
		prop: BasesPropertyId,
		propName: string,
	): void {
		this.closeSelectMenu();
		this.selectEditor = new SelectEditor({
			doc: this.rootEl.doc,
			win: this.rootEl.win,
			anchor: td,
			entries: this.data.data,
			entry,
			prop,
			isList: this.pills.listProps.has(prop),
			applyColor: (pill, text) => this.applyPillColor(pill, text),
			write: (value) => void this.writeProperty(entry, propName, value),
			setColor: (value, colorName) => this.setPinnedColor(value, colorName),
			onClose: () => { this.selectEditor = null; },
		});
	}

	/**
	 * Pin a value to a specific Notion color. Updates the live map for instant
	 * feedback in the open editor, then persists into the `pinnedColors` view
	 * option (replacing any prior entry for the same value) so it survives
	 * reloads and is editable from the view settings too.
	 */
	private setPinnedColor(value: string, colorName: string): void {
		const color = colorByName(colorName);
		if (!color) return;
		const bare = value.replace(/^#/, '');
		const key = bare.toLowerCase();
		this.pinnedColors.set(key, color);

		const raw = this.config.get('pinnedColors');
		const list = Array.isArray(raw) ? raw.map((s) => String(s)) : [];
		const kept = list.filter((item) => {
			const m = item.match(/^(.+?)\s*[=:]\s*(.+)$/);
			return m ? m[1].trim().replace(/^#/, '').toLowerCase() !== key : true;
		});
		kept.push(`${bare}=${colorName}`);
		this.config.set('pinnedColors', kept);
	}

	private closeSelectMenu(): void {
		this.selectEditor?.close();
		this.selectEditor = null;
	}
}
