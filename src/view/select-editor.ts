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
 */
import { BasesEntry, BasesPropertyId } from 'obsidian';
import { valueToStrings } from '../lib/values';

export interface SelectEditorDeps {
	/** The view's own document (popout-safe; never bare `document`). */
	doc: Document;
	/** The view's own window (popout-safe), used to clamp the menu on screen. */
	win: Window;
	/** Cell element the menu anchors beneath. */
	anchor: HTMLElement;
	/** Every entry in the current result, used to list the known values. */
	entries: BasesEntry[];
	/** The entry being edited. */
	entry: BasesEntry;
	/** Property being edited. */
	prop: BasesPropertyId;
	/** True for list (multi-select) properties; false for scalar (single-select). */
	isList: boolean;
	/** Color a pill element for the given value. */
	applyColor: (pill: HTMLElement, text: string) => void;
	/** Persist the chosen value (`null` deletes the property). */
	write: (value: unknown) => void;
	/** Invoked once when the menu closes, so the owner can drop its reference. */
	onClose: () => void;
}

export class SelectEditor {
	private readonly menu: HTMLElement;
	private closed = false;

	/** Currently selected values (display form, leading `#` stripped). */
	private selected: string[];
	/** Distinct known values for this property: lowercase key → display text. */
	private readonly known = new Map<string, string>();

	private pillsWrap!: HTMLElement;
	private optionsEl!: HTMLElement;
	private input!: HTMLInputElement;

	constructor(private readonly deps: SelectEditorDeps) {
		const { entries, entry, prop } = deps;

		for (const e of entries) {
			for (const s of valueToStrings(e.getValue(prop))) {
				const display = s.replace(/^#/, '');
				if (display && !this.known.has(display.toLowerCase())) {
					this.known.set(display.toLowerCase(), display);
				}
			}
		}

		this.selected = valueToStrings(entry.getValue(prop)).map((s) =>
			s.replace(/^#/, ''),
		);

		this.menu = this.build();
		this.position();
	}

	/** Whether the given node lives inside the menu (outside-click detection). */
	contains(node: Node | null): boolean {
		return !!node && this.menu.contains(node);
	}

	/** Tear the menu down. Idempotent; notifies the owner via `onClose`. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.menu.remove();
		this.deps.onClose();
	}

	private build(): HTMLElement {
		const { doc, isList } = this.deps;
		const menu = doc.body.createDiv({ cls: 'ntn-root ntn-select-menu' });

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
		this.optionsEl.empty();
		const q = this.input.value.trim();
		const ql = q.toLowerCase();
		const visible = [...this.known.values()]
			.filter((o) => !ql || o.toLowerCase().includes(ql))
			.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
		for (const o of visible) {
			const row = this.optionsEl.createDiv({ cls: 'ntn-select-option' });
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

	/** Anchor below the cell, then clamp into the view's own window. */
	private position(): void {
		const { anchor, win } = this.deps;
		const rect = anchor.getBoundingClientRect();
		this.menu.style.left = `${rect.left}px`;
		this.menu.style.top = `${rect.bottom + 4}px`;
		this.menu.style.minWidth = `${Math.max(rect.width, 220)}px`;

		const mRect = this.menu.getBoundingClientRect();
		if (mRect.bottom > win.innerHeight - 8) {
			this.menu.style.top = `${Math.max(8, rect.top - mRect.height - 4)}px`;
		}
		if (mRect.right > win.innerWidth - 8) {
			this.menu.style.left = `${Math.max(8, win.innerWidth - mRect.width - 8)}px`;
		}
	}
}
