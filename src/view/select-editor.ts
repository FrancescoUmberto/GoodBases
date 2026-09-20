/**
 * Notion-style select editor for pill cells: a floating menu showing the
 * cell's current values (removable), a search/create input, and every distinct
 * value used for the property across the table. List properties multi-select
 * (toggle, menu stays open); scalar pill properties single-select (pick and
 * close).
 *
 * The menu is self-contained: it captures a snapshot of the known values at
 * construction and, like every {@link FloatingEditor}, holds only a stable
 * `TFile` — never a `BasesEntry` — so it survives the view's `onDataUpdated`
 * re-renders. The owning view drives its lifetime (outside click / Esc /
 * unload) and the menu mounts into `deps.container` (the document body for
 * table cells, the modal container for the page panel).
 */
import { BasesEntry } from 'obsidian';
import { NOTION_COLORS, applyColorVars, customColor } from '../lib/colors';
import { valueToStrings } from '../lib/values';
import { FloatingEditor, FloatingEditorDeps } from './floating-editor';

export interface SelectEditorDeps extends FloatingEditorDeps {
	/** Every entry in the current result, used to list the known values. */
	entries: BasesEntry[];
	/** The values currently set on the file, in display form. */
	current: string[];
	/** True for list (multi-select) properties; false for scalar (single-select). */
	isList: boolean;
	/** Color a pill element for the given value. */
	applyColor: (pill: HTMLElement, text: string) => void;
	/** Persist the chosen value (`null` deletes the property). */
	write: (value: unknown) => void;
	/**
	 * Pin a value to a color spec: a Notion palette name (e.g. `"green"`) or a
	 * custom hex (e.g. `"#0088ff"`).
	 */
	setColor: (value: string, color: string) => void;
}

export class SelectEditor extends FloatingEditor<SelectEditorDeps> {
	/** Open color-picker flyout, if any (a sibling popover in the container). */
	private colorMenu: HTMLElement | null = null;

	/** Currently selected values (display form, leading `#` stripped). */
	private selected: string[];
	/** Distinct known values for this property: lowercase key → display text. */
	private readonly known = new Map<string, string>();

	private pillsWrap!: HTMLElement;
	private optionsEl!: HTMLElement;
	private input!: HTMLInputElement;

	constructor(deps: SelectEditorDeps) {
		super(deps);
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
		return super.contains(node) || (this.colorMenu?.contains(node) ?? false);
	}

	protected onClosing(): void {
		this.closeColorMenu();
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

		const apply = (spec: string) => {
			this.deps.setColor(value, spec);
			// Live map is updated synchronously, so re-rendering shows the
			// new color immediately (renderOptions also closes this flyout).
			this.renderPills();
			this.renderOptions();
		};

		this.buildCustomColorSection(menu, anchorEl, apply);
		menu.createDiv({ cls: 'ntn-color-section', text: 'Notion colors' });

		for (const c of NOTION_COLORS) {
			const item = menu.createDiv({ cls: 'ntn-color-option' });
			const swatch = item.createSpan({ cls: 'ntn-color-swatch' });
			applyColorVars(swatch, c);
			item.createSpan({ cls: 'ntn-color-name', text: c.name });
			item.addEventListener('click', (evt) => {
				evt.stopPropagation();
				apply(c.name);
			});
		}

		this.clampToWindow(menu, anchorEl.getBoundingClientRect());
	}

	/**
	 * The "any color you like" half of the picker: the OS color dialog plus a
	 * hex field, both committing a `#rrggbb` spec. Seeded with the value's
	 * current color, read back from the CSS variables `applyColor` just set on
	 * the row's swatch (they hold a plain hex for every palette entry).
	 */
	private buildCustomColorSection(
		menu: HTMLElement,
		anchorEl: HTMLElement,
		apply: (spec: string) => void,
	): void {
		const currentBg = anchorEl.style.getPropertyValue('--ntn-pill-bg-light').trim();
		const seed = /^#[0-9a-f]{6}$/i.test(currentBg) ? currentBg : '#cccccc';

		menu.createDiv({ cls: 'ntn-color-section', text: 'Custom' });
		const row = menu.createDiv({ cls: 'ntn-color-custom' });

		const picker = row.createEl('input', {
			type: 'color',
			cls: 'ntn-color-input',
			attr: { 'aria-label': 'Pick a custom color' },
		});
		picker.value = seed;
		// `change` (not `input`) fires once the dialog is committed, so dragging
		// through the picker doesn't write the view config on every frame.
		picker.addEventListener('change', () => apply(picker.value));
		picker.addEventListener('click', (evt) => evt.stopPropagation());

		const hex = row.createEl('input', {
			type: 'text',
			cls: 'ntn-color-hex',
			attr: { placeholder: seed, spellcheck: 'false', 'aria-label': 'Custom color hex' },
		});
		const commitHex = () => {
			const spec = hex.value.trim();
			if (!spec) return;
			if (customColor(spec)) apply(spec);
			else hex.addClass('ntn-color-hex-invalid');
		};
		hex.addEventListener('input', () => hex.removeClass('ntn-color-hex-invalid'));
		hex.addEventListener('click', (evt) => evt.stopPropagation());
		hex.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') {
				evt.preventDefault();
				commitHex();
			} else if (evt.key === 'Escape') {
				// Consume it: bubbling would close the whole select editor (and,
				// inside the page panel, the modal too).
				evt.preventDefault();
				evt.stopPropagation();
				this.closeColorMenu();
			}
		});
	}

	/** Anchor the main menu below the cell, then clamp into the window. */
	private position(): void {
		const rect = this.deps.anchor.getBoundingClientRect();
		this.menu.setCssStyles({ minWidth: `${Math.max(rect.width, 220)}px` });
		this.clampToWindow(this.menu, rect);
	}
}
