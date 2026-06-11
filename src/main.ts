import {
	BasesEntry,
	BasesPropertyId,
	BasesView,
	BasesViewConfig,
	BooleanValue,
	ListValue,
	Notice,
	NumberValue,
	Plugin,
	QueryController,
	Value,
} from 'obsidian';

export const NOTION_TABLE_VIEW = 'notion-table';

/** Notion's "select" palette — light/dark background + text pairs. */
const NOTION_COLORS = [
	{ name: 'gray',   lightBg: '#E3E2E0', lightFg: '#32302C', darkBg: '#5A5A5A40', darkFg: '#D4D4D4' },
	{ name: 'brown',  lightBg: '#EEE0DA', lightFg: '#442A1E', darkBg: '#603B2C66', darkFg: '#DDC2B4' },
	{ name: 'orange', lightBg: '#FADEC9', lightFg: '#49290E', darkBg: '#854C1D66', darkFg: '#F5CBA7' },
	{ name: 'yellow', lightBg: '#F9E4BC', lightFg: '#402C1B', darkBg: '#89632A66', darkFg: '#F0DCA5' },
	{ name: 'green',  lightBg: '#DBEDDB', lightFg: '#1C3829', darkBg: '#2B593F66', darkFg: '#B7DEC2' },
	{ name: 'blue',   lightBg: '#D3E5EF', lightFg: '#183347', darkBg: '#28456C66', darkFg: '#B8D2EA' },
	{ name: 'purple', lightBg: '#E8DEEE', lightFg: '#412454', darkBg: '#492F6466', darkFg: '#D5C2E5' },
	{ name: 'pink',   lightBg: '#F5E0E9', lightFg: '#4C2337', darkBg: '#69314C66', darkFg: '#E9C2D5' },
	{ name: 'red',    lightBg: '#FFE2DD', lightFg: '#5D1715', darkBg: '#6E363166', darkFg: '#F1BFBC' },
];

/** Deterministic color per tag string so pills stay stable across renders. */
function colorFor(text: string): typeof NOTION_COLORS[number] {
	let h = 0;
	for (let i = 0; i < text.length; i++) {
		h = (h * 31 + text.charCodeAt(i)) >>> 0;
	}
	return NOTION_COLORS[h % NOTION_COLORS.length];
}

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
			options: (_config: BasesViewConfig) => [
				{
					type: 'toggle',
					key: 'wrapCells',
					displayName: 'Wrap cell content',
					default: false,
				},
				{
					type: 'toggle',
					key: 'verticalLines',
					displayName: 'Show vertical lines',
					default: true,
				},
				{
					type: 'multitext',
					key: 'pillProperties',
					displayName: 'Properties to show as colored pills',
				},
				{
					type: 'multitext',
					key: 'pinnedColors',
					displayName: 'Pinned pill colors (value=color: gray, brown, orange, yellow, green, blue, purple, pink, red)',
				},
			],
		});
		if (!ok) {
			new Notice('GoodBases: view registration failed. Is the Bases core plugin enabled?', 8000);
		}
	}
}

export class NotionTableView extends BasesView {
	readonly type = NOTION_TABLE_VIEW;
	private rootEl: HTMLElement;
	/** Properties that should render as Notion pills (computed each update). */
	private pillProps: Set<BasesPropertyId> = new Set();
	/** Pill properties whose values are lists (multi-select) vs scalars (single-select). */
	private listProps: Set<BasesPropertyId> = new Set();
	/** User-pinned value → color overrides from the `pinnedColors` view option. */
	private pinnedColors: Map<string, typeof NOTION_COLORS[number]> = new Map();
	/** Tears down the floating select menu, if one is open. */
	private menuCleanup: (() => void) | null = null;
	/** The open select menu's element, for outside-click detection. */
	private menuEl: HTMLElement | null = null;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.rootEl = parentEl.createDiv({ cls: 'ntn-root' });
		this.register(() => this.closeSelectMenu());
		// rootEl.doc resolves to the view's own document, so this also works
		// when the view lives in a popout window (plain `document` would not).
		this.registerDomEvent(this.rootEl.doc, 'mousedown', (evt) => {
			if (this.menuEl && !this.menuEl.contains(evt.target as Node)) {
				this.closeSelectMenu();
			}
		}, { capture: true });
	}

	onDataUpdated(): void {
		const root = this.rootEl;
		root.empty();

		root.toggleClass('ntn-wrap', this.config.get('wrapCells') === true);
		root.toggleClass('ntn-vlines', this.config.get('verticalLines') !== false);

		const props = this.config.getOrder();
		this.computePillProps(props);
		this.computePinnedColors();

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

	/**
	 * A property renders as pills when its vault-level type is a list type
	 * (multitext/tags/aliases), when ANY entry holds a list for it (so
	 * mixed string/list frontmatter stays consistent), when it's the tags
	 * property, or when the user listed it in the view options.
	 * List-typed pill properties also land in `listProps` so the select
	 * editor knows multi vs single.
	 */
	private computePillProps(props: BasesPropertyId[]): void {
		this.pillProps.clear();
		this.listProps.clear();
		const userListed = this.config.get('pillProperties');
		const userSet = new Set(
			Array.isArray(userListed)
				? userListed.map((s) => String(s).toLowerCase().trim())
				: [],
		);
		// Vault-wide property types (undocumented but stable API): a property
		// registered as multitext/tags/aliases is a list even when every
		// visible row happens to hold a bare string.
		const mtm = (this.app as unknown as {
			metadataTypeManager?: { getPropertyInfo?: (name: string) => unknown };
		}).metadataTypeManager;
		for (const prop of props) {
			const bare = prop.split('.').slice(1).join('.').toLowerCase();
			const display = this.config.getDisplayName(prop).toLowerCase();
			const info = mtm?.getPropertyInfo?.(bare) as
				| { type?: string; widget?: string }
				| string
				| undefined;
			const metaType =
				typeof info === 'string' ? info : info?.widget ?? info?.type;
			let isList =
				metaType === 'multitext' || metaType === 'tags' || metaType === 'aliases';
			if (!isList) {
				for (const entry of this.data.data) {
					if (entry.getValue(prop) instanceof ListValue) {
						isList = true;
						break;
					}
				}
			}
			if (isList) this.listProps.add(prop);
			if (isList || bare === 'tags' || userSet.has(bare) || userSet.has(display)) {
				this.pillProps.add(prop);
			}
		}
	}

	/** Parse the `pinnedColors` view option ("value=color" entries). */
	private computePinnedColors(): void {
		this.pinnedColors.clear();
		const raw = this.config.get('pinnedColors');
		if (!Array.isArray(raw)) return;
		for (const item of raw) {
			const m = String(item).match(/^(.+?)\s*[=:]\s*(.+)$/);
			if (!m) continue;
			const value = m[1].trim().replace(/^#/, '').toLowerCase();
			const colorName = m[2].trim().toLowerCase();
			const color = NOTION_COLORS.find((c) => c.name === colorName);
			if (value && color) this.pinnedColors.set(value, color);
		}
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
		if (this.pillProps.has(prop)) {
			const wrap = td.createDiv({ cls: 'ntn-pills' });
			const items = this.valueToStrings(value);
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
			console.error('[good-bases] failed to write property', propName, e);
			new Notice(`Couldn't update "${propName}".`);
			this.onDataUpdated();
		}
	}

	private valueToStrings(value: Value | null): string[] {
		if (value === null) return [];
		if (value instanceof ListValue) {
			const out: string[] = [];
			for (let i = 0; i < value.length(); i++) {
				const s = value.get(i).toString();
				if (s) out.push(s);
			}
			return out;
		}
		const s = value.toString();
		return s ? [s] : [];
	}

	private applyPillColor(pill: HTMLElement, text: string): void {
		const key = text.replace(/^#/, '').toLowerCase();
		const c = this.pinnedColors.get(key) ?? colorFor(key);
		pill.style.setProperty('--ntn-pill-bg-light', c.lightBg);
		pill.style.setProperty('--ntn-pill-fg-light', c.lightFg);
		pill.style.setProperty('--ntn-pill-bg-dark', c.darkBg);
		pill.style.setProperty('--ntn-pill-fg-dark', c.darkFg);
	}

	/**
	 * Notion-style select editor for pill cells: a floating menu showing the
	 * cell's current values (removable), a search/create input, and every
	 * distinct value used for this property across the table. List
	 * properties multi-select (toggle, menu stays open); scalar pill
	 * properties single-select (pick and close).
	 */
	private openSelectEditor(
		td: HTMLElement,
		entry: BasesEntry,
		prop: BasesPropertyId,
		propName: string,
	): void {
		this.closeSelectMenu();
		const isList = this.listProps.has(prop);

		// All distinct values for this property across the current results.
		const known = new Map<string, string>(); // lowercase key → display text
		for (const e of this.data.data) {
			for (const s of this.valueToStrings(e.getValue(prop))) {
				const display = s.replace(/^#/, '');
				if (display && !known.has(display.toLowerCase())) {
					known.set(display.toLowerCase(), display);
				}
			}
		}

		let selected = this.valueToStrings(entry.getValue(prop)).map((s) =>
			s.replace(/^#/, ''),
		);

		const menu = this.rootEl.doc.body.createDiv({ cls: 'ntn-root ntn-select-menu' });
		const rect = td.getBoundingClientRect();
		menu.style.left = `${rect.left}px`;
		menu.style.top = `${rect.bottom + 4}px`;
		menu.style.minWidth = `${Math.max(rect.width, 220)}px`;

		const currentEl = menu.createDiv({ cls: 'ntn-select-current' });
		const pillsWrap = currentEl.createDiv({ cls: 'ntn-select-pills' });
		const input = currentEl.createEl('input', {
			type: 'text',
			cls: 'ntn-select-input',
			attr: { placeholder: 'Search or create…', spellcheck: 'false' },
		});
		menu.createDiv({
			cls: 'ntn-select-hint',
			text: isList ? 'Select options or create one' : 'Select an option or create one',
		});
		const optionsEl = menu.createDiv({ cls: 'ntn-select-options' });

		const write = () => {
			// Empty selection deletes the property (writeProperty treats null as delete).
			const out: unknown = isList
				? (selected.length ? selected : null)
				: (selected[0] ?? null);
			void this.writeProperty(entry, propName, out);
		};

		const renderPills = () => {
			pillsWrap.empty();
			for (const v of selected) {
				const pill = pillsWrap.createSpan({ cls: 'ntn-pill' });
				this.applyPillColor(pill, v);
				pill.createSpan({ text: v });
				const x = pill.createSpan({ cls: 'ntn-pill-remove', text: '✕' });
				x.addEventListener('click', (evt) => {
					evt.stopPropagation();
					selected = selected.filter((s) => s !== v);
					write();
					renderPills();
					renderOptions();
				});
			}
		};

		const pick = (v: string) => {
			if (isList) {
				const has = selected.some((s) => s.toLowerCase() === v.toLowerCase());
				selected = has
					? selected.filter((s) => s.toLowerCase() !== v.toLowerCase())
					: [...selected, v];
				if (!known.has(v.toLowerCase())) known.set(v.toLowerCase(), v);
				write();
				input.value = '';
				renderPills();
				renderOptions();
				input.focus();
			} else {
				selected = [v];
				write();
				this.closeSelectMenu();
			}
		};

		const renderOptions = () => {
			optionsEl.empty();
			const q = input.value.trim();
			const ql = q.toLowerCase();
			const visible = [...known.values()]
				.filter((o) => !ql || o.toLowerCase().includes(ql))
				.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
			for (const o of visible) {
				const row = optionsEl.createDiv({ cls: 'ntn-select-option' });
				const pill = row.createSpan({ cls: 'ntn-pill' });
				this.applyPillColor(pill, o);
				pill.setText(o);
				if (selected.some((s) => s.toLowerCase() === o.toLowerCase())) {
					row.createSpan({ cls: 'ntn-select-check', text: '✓' });
				}
				row.addEventListener('click', () => pick(o));
			}
			if (q && !known.has(ql)) {
				const row = optionsEl.createDiv({ cls: 'ntn-select-option' });
				row.createSpan({ cls: 'ntn-select-create', text: 'Create' });
				const pill = row.createSpan({ cls: 'ntn-pill' });
				this.applyPillColor(pill, q);
				pill.setText(q);
				row.addEventListener('click', () => pick(q));
			}
			if (!visible.length && !q) {
				optionsEl.createDiv({
					cls: 'ntn-select-empty',
					text: 'No options yet — type to create one',
				});
			}
		};

		input.addEventListener('input', renderOptions);
		input.addEventListener('keydown', (evt) => {
			if (evt.key === 'Escape') {
				this.closeSelectMenu();
			} else if (evt.key === 'Enter') {
				const q = input.value.trim();
				if (q) pick(known.get(q.toLowerCase()) ?? q);
				else this.closeSelectMenu();
			} else if (evt.key === 'Backspace' && input.value === '' && isList && selected.length) {
				selected = selected.slice(0, -1);
				write();
				renderPills();
				renderOptions();
			}
		});

		this.menuEl = menu;
		this.menuCleanup = () => {
			this.menuEl = null;
			menu.remove();
		};

		renderPills();
		renderOptions();
		input.focus();

		// Keep the menu on screen (in the view's own window, popouts included).
		const win = this.rootEl.win;
		const mRect = menu.getBoundingClientRect();
		if (mRect.bottom > win.innerHeight - 8) {
			menu.style.top = `${Math.max(8, rect.top - mRect.height - 4)}px`;
		}
		if (mRect.right > win.innerWidth - 8) {
			menu.style.left = `${Math.max(8, win.innerWidth - mRect.width - 8)}px`;
		}
	}

	private closeSelectMenu(): void {
		if (this.menuCleanup) {
			this.menuCleanup();
			this.menuCleanup = null;
		}
	}
}
