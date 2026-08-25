/**
 * Notion-style select editor for pill cells: a floating menu showing the
 * cell's current values (removable), a search/create input, and every distinct
 * value used for the property across the table. List properties multi-select
 * (toggle, menu stays open); scalar pill properties single-select (pick and
 * close).
 *
 * The menu is self-contained: it captures a snapshot of the known values and
 * the editing entry's `file` at construction, never holding stale `BasesEntry`
 * objects, so it survives the view's `onDataUpdated` re-renders. The owning
 * view drives lifetime — outside-click and unload both call {@link close}.
 *
 * The menu mounts into `deps.container` (the document body for table cells,
 * the modal container for the page panel) — see `SelectEditorDeps.container`.
 */
import { BasesEntry, BasesPropertyId, TFile } from 'obsidian';
import { NOTION_COLORS, applyColorVars } from '../lib/colors';
import { valueToStrings } from '../lib/values';

export interface SelectEditorDeps {
	/** The view's own window (popout-safe), used to clamp the menu on screen. */
	win: Window;
	/**
	 * Element the menu (and its color flyout) is appended to — normally the
	 * document body, but the page panel passes its modal container: Obsidian
	 * traps focus inside the open modal's `containerEl`
	 * (`Scope.setTabFocusContainerEl` + `Keymap.onFocusIn`), so a menu on the
	 * body would lose the search input's focus to the modal's first focusable
	 * element (the title) one tick after opening. Doubles as the scope for
	 * {@link SelectEditor.reanchorIfMatches}, so a table re-render can't steal
	 * the anchor of a menu opened from the panel.
	 */
	container: HTMLElement;
	/** Cell element the menu anchors beneath. */
	anchor: HTMLElement;
	/** Every entry in the current result, used to list the known values. */
	entries: BasesEntry[];
	/** The file being edited (a `TFile` is stable across data updates). */
	file: TFile;
	/** The values currently set on the file, in display form. */
	current: string[];
	/** Property being edited. */
	prop: BasesPropertyId;
	/** True for list (multi-select) properties; false for scalar (single-select). */
	isList: boolean;
	/** Color a pill element for the given value. */
	applyColor: (pill: HTMLElement, text: string) => void;
	/** Persist the chosen value (`null` deletes the property). */
	write: (value: unknown) => void;
	/** Pin a value to a specific Notion color name (e.g. `"green"`). */
	setColor: (value: string, colorName: string) => void;
	/** Invoked once when the menu closes, so the owner can drop its reference. */
	onClose: () => void;
}

export class SelectEditor {
	private readonly menu: HTMLElement;
	/** Open color-picker flyout, if any (a sibling popover on the body). */
	private colorMenu: HTMLElement | null = null;
	private closed = false;

	/** Currently selected values (display form, leading `#` stripped). */
	private selected: string[];
	/** Distinct known values for this property: lowercase key → display text. */
	private readonly known = new Map<string, string>();

	private pillsWrap!: HTMLElement;
	private optionsEl!: HTMLElement;
	private input!: HTMLInputElement;

	constructor(private readonly deps: SelectEditorDeps) {
		const { entries, current, prop } = deps;

		for (const e of entries) {
			for (const s of valueToStrings(e.getValue(prop))) {
				const display = s.replace(/^#/, '');
				if (display && !this.known.has(display.toLowerCase())) {
					this.known.set(display.toLowerCase(), display);
				}
			}
		}

		this.selected = current.map((s) => s.replace(/^#/, ''));

		this.menu = this.build();
		this.position();
	}

	/** Whether the given node lives inside the menu or its color flyout. */
	contains(node: Node | null): boolean {
		if (!node) return false;
		return this.menu.contains(node) || (this.colorMenu?.contains(node) ?? false);
	}

	/** The cell element this menu is anchored to (drives click-to-toggle). */
	get anchorEl(): HTMLElement {
		return this.deps.anchor;
	}

	/**
	 * Re-point the menu at a freshly rendered cell for the same file +
	 * property. `onDataUpdated` replaces every `td`, so without this the
	 * anchor would dangle on a detached node and click-to-toggle (which
	 * compares against the live cell) would miss. Returns whether it matched.
	 */
	reanchorIfMatches(td: HTMLElement, filePath: string, prop: BasesPropertyId): boolean {
		if (this.closed) return false;
		if (this.deps.prop !== prop || this.deps.file.path !== filePath) return false;
		// Only elements from the same surface the menu belongs to: a table
		// re-render must not re-point a menu opened from the page panel.
		if (!this.deps.container.contains(td)) return false;
		this.deps.anchor = td;
		return true;
	}

	/** Tear the menu down. Idempotent; notifies the owner via `onClose`. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.closeColorMenu();
		this.menu.remove();
		this.deps.onClose();
	}

	private closeColorMenu(): void {
		this.colorMenu?.remove();
		this.colorMenu = null;
	}

	private build(): HTMLElement {
		const { container, isList } = this.deps;
		const menu = container.createDiv({ cls: 'ntn-root ntn-select-menu' });

		const currentEl = menu.createDiv({ cls: 'ntn-select-current' });
		this.pillsWrap = currentEl.createDiv({ cls: 'ntn-select-pills' });
		this.input = currentEl.createEl('input', {
			type: 'text',
			cls: 'ntn-select-input',
			attr: { placeholder: 'Search or create…', spellcheck: 'false' },
		});
		menu.createDiv({
			cls: 'ntn-select-hint',
			text: isList ? 'Select options or create one' : 'Select an option or create one',
		});
		this.optionsEl = menu.createDiv({ cls: 'ntn-select-options' });

		this.input.addEventListener('input', () => this.renderOptions());
		this.input.addEventListener('keydown', (evt) => this.onKeydown(evt));

		this.renderPills();
		this.renderOptions();
		this.input.focus();

		return menu;
	}

	/** Empty selection deletes the property (`write` treats `null` as delete). */
	private write(): void {
		const out: unknown = this.deps.isList
			? (this.selected.length ? this.selected : null)
			: (this.selected[0] ?? null);
		this.deps.write(out);
	}

	private renderPills(): void {
		this.pillsWrap.empty();
		for (const v of this.selected) {
			const pill = this.pillsWrap.createSpan({ cls: 'ntn-pill' });
			this.deps.applyColor(pill, v);
			pill.createSpan({ text: v });
			const x = pill.createSpan({ cls: 'ntn-pill-remove', text: '✕' });
			x.addEventListener('click', (evt) => {
				evt.stopPropagation();
				this.selected = this.selected.filter((s) => s !== v);
				this.write();
				this.renderPills();
				this.renderOptions();
			});
		}
	}

	private pick(v: string): void {
		if (this.deps.isList) {
			const has = this.selected.some((s) => s.toLowerCase() === v.toLowerCase());
			this.selected = has
				? this.selected.filter((s) => s.toLowerCase() !== v.toLowerCase())
				: [...this.selected, v];
			if (!this.known.has(v.toLowerCase())) this.known.set(v.toLowerCase(), v);
			this.write();
			this.input.value = '';
			this.renderPills();
			this.renderOptions();
			this.input.focus();
		} else {
			this.selected = [v];
			this.write();
			this.close();
		}
	}

	private renderOptions(): void {
		this.closeColorMenu();
		this.optionsEl.empty();
		const q = this.input.value.trim();
		const ql = q.toLowerCase();
		const visible = [...this.known.values()]
			.filter((o) => !ql || o.toLowerCase().includes(ql))
			.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
		for (const o of visible) {
			const row = this.optionsEl.createDiv({ cls: 'ntn-select-option' });
			// A colored square (left of the label) showing the value's current
			// color; click to change it.
			const colorBtn = row.createSpan({
				cls: 'ntn-select-color-btn',
				attr: { 'aria-label': 'Change color' },
			});
			this.deps.applyColor(colorBtn, o);
			colorBtn.addEventListener('click', (evt) => {
				evt.stopPropagation();
				this.openColorMenu(colorBtn, o);
			});
			const pill = row.createSpan({ cls: 'ntn-pill' });
			this.deps.applyColor(pill, o);
			pill.setText(o);
			if (this.selected.some((s) => s.toLowerCase() === o.toLowerCase())) {
				row.createSpan({ cls: 'ntn-select-check', text: '✓' });
			}
			row.addEventListener('click', () => this.pick(o));
		}
		if (q && !this.known.has(ql)) {
			const row = this.optionsEl.createDiv({ cls: 'ntn-select-option' });
			row.createSpan({ cls: 'ntn-select-create', text: 'Create' });
			const pill = row.createSpan({ cls: 'ntn-pill' });
			this.deps.applyColor(pill, q);
			pill.setText(q);
			row.addEventListener('click', () => this.pick(q));
		}
		if (!visible.length && !q) {
			this.optionsEl.createDiv({
				cls: 'ntn-select-empty',
				text: 'No options yet — type to create one',
			});
		}
	}

	private onKeydown(evt: KeyboardEvent): void {
		if (evt.key === 'Escape') {
			// Consume the key: inside the page panel, a bubbling Esc would
			// close the whole modal along with the menu.
			evt.preventDefault();
			evt.stopPropagation();
			this.close();
		} else if (evt.key === 'Enter') {
			const q = this.input.value.trim();
			if (q) this.pick(this.known.get(q.toLowerCase()) ?? q);
			else this.close();
		} else if (
			evt.key === 'Backspace' &&
			this.input.value === '' &&
			this.deps.isList &&
			this.selected.length
		) {
			this.selected = this.selected.slice(0, -1);
			this.write();
			this.renderPills();
			this.renderOptions();
		}
	}

	/** Open the color picker for a value, anchored to its row button. */
	private openColorMenu(anchorEl: HTMLElement, value: string): void {
		this.closeColorMenu();
		const menu = this.deps.container.createDiv({ cls: 'ntn-root ntn-color-menu' });
		this.colorMenu = menu;

		for (const c of NOTION_COLORS) {
			const item = menu.createDiv({ cls: 'ntn-color-option' });
			const swatch = item.createSpan({ cls: 'ntn-color-swatch' });
			applyColorVars(swatch, c);
			item.createSpan({ cls: 'ntn-color-name', text: c.name });
			item.addEventListener('click', (evt) => {
				evt.stopPropagation();
				this.deps.setColor(value, c.name);
				// Live map is updated synchronously, so re-rendering shows the
				// new color immediately (renderOptions also closes this flyout).
				this.renderPills();
				this.renderOptions();
			});
		}

		this.clampToWindow(menu, anchorEl.getBoundingClientRect());
	}

	/** Anchor the main menu below the cell, then clamp into the window. */
	private position(): void {
		const rect = this.deps.anchor.getBoundingClientRect();
		this.menu.setCssStyles({ minWidth: `${Math.max(rect.width, 220)}px` });
		this.clampToWindow(this.menu, rect);
	}

	/** Place a popover just below `anchorRect`, nudged to stay on screen. */
	private clampToWindow(el: HTMLElement, anchorRect: DOMRect): void {
		const { win } = this.deps;
		el.setCssStyles({
			left: `${anchorRect.left}px`,
			top: `${anchorRect.bottom + 4}px`,
		});

		const rect = el.getBoundingClientRect();
		if (rect.bottom > win.innerHeight - 8) {
			el.setCssStyles({ top: `${Math.max(8, anchorRect.top - rect.height - 4)}px` });
		}
		if (rect.right > win.innerWidth - 8) {
			el.setCssStyles({ left: `${Math.max(8, win.innerWidth - rect.width - 8)}px` });
		}
	}
}
