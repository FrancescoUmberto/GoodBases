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
	Platform,
	QueryController,
	TFile,
	setIcon,
} from 'obsidian';
import { LOG_PREFIX, NOTION_TABLE_VIEW } from '../constants';
import {
	ColumnWidths,
	MIN_COLUMN_WIDTH,
	TITLE_COLUMN_KEY,
	parseColumnWidths,
	serializeColumnWidths,
} from '../lib/column-widths';
import { PinnedColors, applyPillColor, parseColorSpec } from '../lib/colors';
import { PillDetection, computePillProps, parsePinnedColors } from '../lib/pills';
import { valueToStrings } from '../lib/values';
import { NotePageModal, OpenSelectOpts } from './note-modal';
import { SelectEditor } from './select-editor';

/**
 * Internal shape of the core toolbar's new-item menu (`QueryController.
 * newItemMenu` — not in the public API). Guarded at runtime before use.
 */
interface CoreNewItemMenu {
	open(name?: string, frontmatterProcessor?: (fm: Record<string, unknown>) => void): Promise<void>;
	close(): void;
}

export class NotionTableView extends BasesView {
	readonly type = NOTION_TABLE_VIEW;
	private rootEl: HTMLElement;
	/** The controller this view was created for (holds the core toolbar). */
	private readonly queryCtrl: QueryController;
	/** True while the toolbar's New button is rerouted to the page panel. */
	private newButtonPatched = false;
	/** Pill / list classification, recomputed each update. */
	private pills: PillDetection = { pillProps: new Set(), listProps: new Set() };
	/** User-pinned value → color overrides from the `pinnedColors` view option. */
	private pinnedColors: PinnedColors = new Map();
	/** Column key → user-dragged width; unlisted columns size themselves. */
	private columnWidths: ColumnWidths = new Map();
	/** How the Name column's icons render (the `titleIcon` view option). */
	private titleIcon = { mode: 'page', custom: '' };
	/** The open select editor, if any (also drives outside-click detection). */
	private selectEditor: SelectEditor | null = null;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.queryCtrl = controller;
		this.rootEl = parentEl.createDiv({ cls: 'ntn-root' });
		this.register(() => this.closeSelectMenu());
		// rootEl.doc resolves to the view's own document, so this also works
		// when the view lives in a popout window (plain `document` would not).
		// One persistent capture-phase listener that no-ops unless a menu is open
		// — do not revert to a per-menu `document.addEventListener`.
		this.registerDomEvent(this.rootEl.doc, 'mousedown', (evt) => {
			if (!this.selectEditor) return;
			const target = evt.target as Node;
			if (this.selectEditor.contains(target)) return;
			// A click on the anchoring cell is left to that cell's own click
			// handler, which toggles the menu shut (see openSelectEditor).
			// Closing here too would let the click re-open it instead.
			if (this.selectEditor.anchorEl.contains(target)) return;
			this.closeSelectMenu();
		}, { capture: true });
		this.patchToolbarNew();
	}

	onDataUpdated(): void {
		// The toolbar may not have existed at construction time; retry until
		// the patch lands (no-op once it has).
		this.patchToolbarNew();
		const root = this.rootEl;
		root.empty();

		// Default-on: only an explicit `false` turns wrapping off (mirrors verticalLines).
		root.toggleClass('ntn-wrap', this.config.get('wrapCells') !== false);
		root.toggleClass('ntn-vlines', this.config.get('verticalLines') !== false);

		const props = this.config.getOrder();
		this.pills = computePillProps(props, this.data.data, this.config, this.app);
		this.pinnedColors = parsePinnedColors(this.config.get('pinnedColors'));
		this.columnWidths = parseColumnWidths(this.config.get('columnWidths'));
		this.titleIcon = {
			mode: String(this.config.get('titleIcon') ?? 'page'),
			custom: String(this.config.get('titleIconCustom') ?? '').trim(),
		};

		const table = root.createEl('table', { cls: 'ntn-table' });

		// ---- Header ----
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		const thTitle = headRow.createEl('th', { cls: 'ntn-th ntn-col-title' });
		// "Hidden" clears the whole Name column of iconography — the header's
		// Notion type glyph as well as the per-row page icons.
		if (this.titleIcon.mode !== 'none') {
			thTitle.createSpan({ cls: 'ntn-th-icon', text: 'Aa' });
		}
		thTitle.createSpan({ text: 'Name' });
		this.setupColumn(thTitle, TITLE_COLUMN_KEY, 0);
		props.forEach((prop, i) => {
			const th = headRow.createEl('th', { cls: 'ntn-th' });
			th.createSpan({ text: this.config.getDisplayName(prop) });
			// The title column occupies index 0, so property i sits at i + 1.
			this.setupColumn(th, prop, i + 1);
		});

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
		newRow.addEventListener('click', () => void this.createAndOpenPage());
	}

	private renderRow(
		tbody: HTMLElement,
		entry: BasesEntry,
		props: BasesPropertyId[],
	): void {
		const tr = tbody.createEl('tr', { cls: 'ntn-row' });

		// Title cell: page icon + name + hover OPEN button
		const titleTd = tr.createEl('td', { cls: 'ntn-td ntn-col-title' });
		this.applyColumnWidth(titleTd, TITLE_COLUMN_KEY);
		const titleWrap = titleTd.createDiv({ cls: 'ntn-title-wrap' });
		this.renderTitleIcon(titleWrap);
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
			// The `openMode` view option picks between a new tab (default)
			// and the Notion-style page panel.
			if (this.config.get('openMode') === 'panel') {
				this.openPagePanel(entry.file);
			} else {
				void this.app.workspace.openLinkText(entry.file.path, '', true);
			}
		});

		for (const prop of props) {
			const td = tr.createEl('td', { cls: 'ntn-td' });
			this.applyColumnWidth(td, prop);
			this.renderCell(td, entry, prop);
		}
	}

	/**
	 * Pin a cell to its column's dragged width. A column's width is the max
	 * over all its cells, so the constraint has to land on every `th`/`td` of
	 * the column, not just the header. `min-width` is part of it because the
	 * stylesheet pins the title column at 280px, and `max-width` because the
	 * table stays in `table-layout: auto` (switching to `fixed` would undo the
	 * `width: max-content` narrow-container fix — see bug history #4).
	 */
	private applyColumnWidth(cell: HTMLElement, key: string): void {
		const width = this.columnWidths.get(key);
		if (width === undefined) return;
		const px = `${width}px`;
		cell.setCssStyles({ width: px, minWidth: px, maxWidth: px });
	}

	/**
	 * The icon at the head of each Name cell. Notion's page emoji is the
	 * default, but it is a fixed glyph that can sit badly against a theme —
	 * so the `titleIcon` view option also offers Obsidian's own file icon
	 * (which takes the theme's color), any emoji or Lucide icon the user
	 * names, or no icon at all.
	 */
	private renderTitleIcon(wrap: HTMLElement): void {
		const { mode, custom } = this.titleIcon;
		if (mode === 'none') return;
		const el = wrap.createSpan({ cls: 'ntn-page-icon' });
		if (mode === 'theme') {
			this.setLucideIcon(el, 'file-text');
			return;
		}
		if (mode === 'custom' && custom) {
			// A bare lowercase word is a Lucide icon name; anything else — an
			// emoji, a letter, a symbol — is rendered as the text it is.
			const named = /^[a-z][a-z0-9-]*$/.test(custom);
			if (named && this.setLucideIcon(el, custom)) return;
			el.setText(custom);
			return;
		}
		// Both 'page' and a 'custom' with nothing filled in yet.
		el.addClass('ntn-page-icon-emoji');
		el.setText('📄');
	}

	/**
	 * Draw a Lucide icon into the span. Returns false — leaving the span
	 * untouched — when the name isn't a real icon, since `setIcon` fails
	 * silently and would otherwise leave an empty gap before the title.
	 */
	private setLucideIcon(el: HTMLElement, name: string): boolean {
		el.addClass('ntn-page-icon-lucide');
		setIcon(el, name);
		if (el.firstElementChild) return true;
		el.removeClass('ntn-page-icon-lucide');
		return false;
	}

	/** Apply a header cell's stored width and give it a drag-to-resize handle. */
	private setupColumn(th: HTMLElement, key: string, colIndex: number): void {
		this.applyColumnWidth(th, key);
		const handle = th.createDiv({ cls: 'ntn-col-resize' });

		handle.addEventListener('pointerdown', (evt: PointerEvent) => {
			// Keep the press off the header itself (and out of any text selection).
			evt.preventDefault();
			evt.stopPropagation();
			const startX = evt.clientX;
			const startWidth = th.getBoundingClientRect().width;
			const cells = this.columnCells(th, colIndex);
			let width = startWidth;
			// A click that never moves must not pin the column at its current
			// width — and must not write to the config, whose re-render would
			// replace this handle before the double-click reset could fire.
			let moved = false;

			// Capturing on the handle routes the rest of the gesture here, so
			// there are no document-level listeners to unregister on unload.
			handle.setPointerCapture(evt.pointerId);
			handle.addClass('ntn-col-resize-active');
			this.rootEl.addClass('ntn-resizing');

			const onMove = (e: PointerEvent) => {
				if (e.clientX === startX) return;
				moved = true;
				// No upper bound: a column may outgrow the pane and push the
				// table into .ntn-root's horizontal scroll, like Notion.
				width = Math.max(MIN_COLUMN_WIDTH, startWidth + e.clientX - startX);
				const px = `${Math.round(width)}px`;
				// Resize live off the DOM; the config write (and the re-render
				// it triggers) waits until the drag ends.
				for (const cell of cells) {
					cell.setCssStyles({ width: px, minWidth: px, maxWidth: px });
				}
			};
			const onEnd = () => {
				handle.removeEventListener('pointermove', onMove);
				handle.removeEventListener('pointerup', onEnd);
				handle.removeEventListener('pointercancel', onEnd);
				handle.removeClass('ntn-col-resize-active');
				this.rootEl.removeClass('ntn-resizing');
				if (moved) this.saveColumnWidth(key, Math.round(width));
			};
			handle.addEventListener('pointermove', onMove);
			handle.addEventListener('pointerup', onEnd);
			handle.addEventListener('pointercancel', onEnd);
		});

		// Notion's reset gesture: double-click a handle to size to content.
		handle.addEventListener('dblclick', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.saveColumnWidth(key, null);
			// Re-render to drop the inline widths this column's cells carry.
			this.onDataUpdated();
		});
	}

	/**
	 * Every `td` of one column, plus its header. Group rows hold a single
	 * `colspan` cell, so only `.ntn-row`s carry a td at this index.
	 */
	private columnCells(th: HTMLElement, colIndex: number): HTMLElement[] {
		const cells: HTMLElement[] = [th];
		const table = th.closest('table');
		if (!table) return cells;
		const tds = table.querySelectorAll<HTMLElement>(
			`tr.ntn-row > td:nth-child(${colIndex + 1})`,
		);
		tds.forEach((td) => cells.push(td));
		return cells;
	}

	/** Persist (or clear, with `null`) one column's width in the view config. */
	private saveColumnWidth(key: string, width: number | null): void {
		if (width === null) {
			this.columnWidths.delete(key);
		} else {
			this.columnWidths.set(key, width);
		}
		this.config.set('columnWidths', serializeColumnWidths(this.columnWidths));
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
				// Keep an open menu pointed at this re-rendered cell so
				// click-to-toggle keeps working after a write re-renders the table.
				this.selectEditor?.reanchorIfMatches(td, entry.file.path, prop);
			}
			return;
		}

		// ---- Checkboxes write straight back to frontmatter ----
		if (value instanceof BooleanValue) {
			const cb = td.createEl('input', { type: 'checkbox', cls: 'ntn-checkbox' });
			cb.checked = value.isTruthy();
			if (editable) {
				cb.addEventListener('change', () => {
					void this.writeProperty(entry.file, propName, cb.checked);
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
		if (td.querySelector('.ntn-input')) return; // already editing
		// Size the editor to the cell as it currently renders, rather than a
		// fixed size — measure before emptying (which would collapse the cell).
		const rect = td.getBoundingClientRect();
		// A cell taller than a single line (wrapped long text) needs a textarea
		// so the text wraps and stays visible; a single-line <input> would just
		// scroll it horizontally. Numbers always use a single-line input.
		const multiline = kind === 'text' && rect.height > 40;
		// The input goes INSIDE the cell's own padding, and .ntn-input is
		// border-box — so it has to be sized to the cell's CONTENT box. Using
		// the full border-box size made the column (and row) jump wider by the
		// padding for as long as the editor was open.
		const style = td.win.getComputedStyle(td);
		const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
		const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
		td.empty();
		const input = multiline
			? td.createEl('textarea', { cls: 'ntn-input ntn-textarea' })
			: td.createEl('input', { type: 'text', cls: 'ntn-input' });
		input.setCssStyles({
			width: `${Math.max(0, rect.width - padX)}px`,
			height: `${Math.max(0, rect.height - padY)}px`,
		});
		input.value = current;
		input.focus();
		input.select();

		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;
			const raw = input.value.trim();
			// Unchanged value: no write fires, so Bases won't re-render — discard
			// the input ourselves, otherwise the edit box lingers in the cell.
			if (raw === current) {
				this.onDataUpdated();
				return;
			}
			let out: unknown = raw;
			if (kind === 'number') {
				const n = Number(raw);
				out = raw === '' ? null : (Number.isNaN(n) ? raw : n);
			} else if (raw === '') {
				out = null;
			}
			// Close the editor now rather than waiting for the write to land:
			// processFrontMatter hits disk and Bases only re-renders once the
			// metadata cache catches up, which leaves the input sitting in the
			// cell for a visible beat. The optimistic text is replaced by the
			// properly rendered value on the re-render that follows (or by the
			// truth from disk, if the write fails).
			td.empty();
			td.createDiv({ cls: 'ntn-cell', text: raw });
			void this.writeProperty(entry.file, propName, out);
		};

		input.addEventListener('keydown', (ev: Event) => {
			const evt = ev as KeyboardEvent;
			if (evt.key === 'Enter' && !evt.shiftKey) {
				// Shift+Enter inserts a newline in the textarea; plain Enter commits.
				evt.preventDefault();
				commit();
			} else if (evt.key === 'Escape') {
				committed = true; // suppress blur commit
				this.onDataUpdated(); // re-render, discarding the edit
			}
		});
		input.addEventListener('blur', commit);
	}

	private async writeProperty(file: TFile, propName: string, value: unknown): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
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

	/**
	 * Reroute the core toolbar's New button to the page panel while this
	 * view is active. The button lives on the query controller, outside this
	 * view's DOM, so its menu's `open` is shadowed on the instance and
	 * restored on unload. `newItemMenu` is internal API — if it ever moves,
	 * the guard below simply leaves the core behavior untouched (and the
	 * footer "+ New" falls back to its own capture flow).
	 */
	private patchToolbarNew(): void {
		if (this.newButtonPatched) return;
		const menu = (this.queryCtrl as unknown as { newItemMenu?: CoreNewItemMenu })
			.newItemMenu;
		if (!menu || typeof menu.open !== 'function' || typeof menu.close !== 'function') {
			return;
		}

		const orig = menu.open.bind(menu);
		const patched = async (
			name?: string,
			fmProc?: (fm: Record<string, unknown>) => void,
		): Promise<void> => {
			// Phones already get a full-screen tab from the core flow.
			if (Platform.isPhone) return orig(name, fmProc);
			let created: TFile | undefined;
			const ref = this.app.vault.on('create', (file) => {
				if (file instanceof TFile) created = file;
			});
			// Keep the core popover invisible for the instant it exists.
			const body = this.rootEl.doc.body;
			body.addClass('ntn-hide-new-popover');
			try {
				// The core flow still creates the file (folder + filter
				// frontmatter) and opens its popover, hidden by the class above.
				await orig(name, fmProc);
			} finally {
				this.app.vault.offref(ref);
				menu.close(); // tear down the hidden popover
				body.removeClass('ntn-hide-new-popover');
			}
			if (created) this.openPagePanel(created);
		};

		menu.open = patched;
		this.newButtonPatched = true;
		this.register(() => {
			// The bound original behaves identically for any later caller.
			menu.open = orig;
			this.newButtonPatched = false;
		});
	}

	/**
	 * "+ New" flow: create the note through the core Bases flow — so it lands
	 * in the configured folder and gets the frontmatter implied by the view's
	 * filters — then edit it in the centered Notion-style page panel instead
	 * of the small popover Obsidian anchors to the toolbar's New button.
	 */
	private async createAndOpenPage(): Promise<void> {
		// On phones the core flow already opens the note in a full-screen
		// tab; with the toolbar patch in place, createFileForView routes
		// through the patched menu, which opens the panel for us.
		if (Platform.isPhone || this.newButtonPatched) {
			await this.createFileForView();
			return;
		}
		// createFileForView resolves with void, so capture the file it
		// creates through the vault's create event.
		let created: TFile | undefined;
		const ref = this.app.vault.on('create', (file) => {
			if (file instanceof TFile) created = file;
		});
		try {
			await this.createFileForView();
		} finally {
			this.app.vault.offref(ref);
		}
		if (!created) return;

		// Dismiss the toolbar-anchored popover the core flow opened; the core
		// new-item menu closes itself on any click outside the popover.
		const doc = this.rootEl.doc;
		if (doc.querySelector('.bases-new-item-popover')) doc.body.click();

		this.openPagePanel(created);
	}

	/** Open a note centered in the Notion-style page panel. */
	private openPagePanel(file: TFile): void {
		new NotePageModal(this.app, file, {
			applyColor: (pill, text) => this.applyPillColor(pill, text),
			write: (f, propName, value) => this.writeProperty(f, propName, value),
			isPillProp: (name) =>
				this.pills.pillProps.has(`note.${name}` as BasesPropertyId),
			isListProp: (name) =>
				this.pills.listProps.has(`note.${name}` as BasesPropertyId),
			openSelect: (opts) => this.openSelectAt(opts),
			reanchorSelect: (anchor, filePath, propName) =>
				void this.selectEditor?.reanchorIfMatches(
					anchor, filePath, `note.${propName}` as BasesPropertyId,
				),
			closeSelect: () => this.closeSelectMenu(),
		}).open();
	}

	/** Color a pill element using this view's pinned-color overrides. */
	private applyPillColor(pill: HTMLElement, text: string): void {
		applyPillColor(pill, text, this.pinnedColors);
	}

	/** Open the Notion-style select editor for a pill cell of the table. */
	private openSelectEditor(
		td: HTMLElement,
		entry: BasesEntry,
		prop: BasesPropertyId,
		propName: string,
	): void {
		this.openSelectAt({
			anchor: td,
			file: entry.file,
			propName,
			current: valueToStrings(entry.getValue(prop)),
			isList: this.pills.listProps.has(prop),
		});
	}

	/**
	 * Open the select editor anchored anywhere — a table cell or a property
	 * row of the page panel. Known values always come from the live query
	 * result; lifetime stays with the view (outside-click / Esc / unload).
	 */
	private openSelectAt(opts: OpenSelectOpts): void {
		// Clicking the element whose menu is already open toggles it shut.
		if (this.selectEditor?.anchorEl === opts.anchor) {
			this.closeSelectMenu();
			return;
		}
		this.closeSelectMenu();
		const prop = `note.${opts.propName}` as BasesPropertyId;
		this.selectEditor = new SelectEditor({
			win: this.rootEl.win,
			container: opts.container ?? this.rootEl.doc.body,
			anchor: opts.anchor,
			entries: this.data.data,
			file: opts.file,
			current: opts.current,
			prop,
			isList: opts.isList,
			applyColor: (pill, text) => this.applyPillColor(pill, text),
			write: (value) =>
				void this.writeProperty(opts.file, opts.propName, value)
					.then(() => opts.onWrite?.()),
			setColor: (value, color) => this.setPinnedColor(value, color),
			onClose: () => { this.selectEditor = null; },
		});
	}

	/**
	 * Pin a value to a color — a Notion palette name or any custom hex. Updates
	 * the live map for instant feedback in the open editor, then persists into
	 * the `pinnedColors` view option (replacing any prior entry for the same
	 * value) so it survives reloads and is editable from the view settings too.
	 * The stored spec is the resolved color's canonical name (`green`, or a
	 * normalized `#rrggbb`).
	 */
	private setPinnedColor(value: string, spec: string): void {
		const color = parseColorSpec(spec);
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
		kept.push(`${bare}=${color.name}`);
		this.config.set('pinnedColors', kept);
	}

	private closeSelectMenu(): void {
		this.selectEditor?.close();
		this.selectEditor = null;
	}
}
