/**
 * Notion-style date editor for date cells: a floating calendar with a typed
 * date field on top, a month grid below it, and Today / Clear actions. For
 * date-and-time properties a time selector sits next to the date field.
 *
 * The written value is the ISO string Obsidian's own date properties use:
 * `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` with a time. Date-only editors
 * pick-and-close; with a time the editor stays open after a day pick (the
 * write lands immediately) so the clock can be set too — Enter, Esc or an
 * outside click close it.
 *
 * Month and weekday labels come from Obsidian's `moment` locale, so the grid
 * starts the week on the user's day and speaks their language.
 */
import { DateValue, moment, setIcon } from 'obsidian';
import { splitDateTime } from '../lib/dates';
import { FloatingEditor, FloatingEditorDeps } from './floating-editor';

export interface DateEditorDeps extends FloatingEditorDeps {
	/** The value as written in the note (`''` when unset). */
	current: string;
	/** Show the time selector (a `datetime` property, or a value with a time). */
	withTime: boolean;
	/** Persist the chosen value (`null` deletes the property). */
	write: (value: string | null) => void;
}

/** `YYYY-MM-DD` from local calendar fields. */
function ymd(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class DateEditor extends FloatingEditor<DateEditorDeps> {
	private dateInput!: HTMLInputElement;
	private timeInput: HTMLInputElement | null = null;
	private gridEl!: HTMLElement;
	private titleEl!: HTMLElement;
	/** The month on display (day 1, local time). */
	private viewMonth: Date;
	/** The `YYYY-MM-DD` of the current value, `''` when unset. */
	private date: string;
	/** The `HH:mm[:ss]` of the current value, `''` when it has none. */
	private time: string;
	/** What the note holds right now (updated after each write). */
	private written: string;

	constructor(deps: DateEditorDeps) {
		super(deps);
		this.written = deps.current.trim();
		({ date: this.date, time: this.time } = splitDateTime(this.written));
		// Bases prints times with seconds (`14:30:00`); Obsidian's properties
		// store `HH:mm`, so drop a zero seconds field rather than write it back.
		this.time = this.time.replace(/^(\d{2}:\d{2}):00$/, '$1');
		const today = new Date();
		this.viewMonth = this.date
			? new Date(Number(this.date.slice(0, 4)), Number(this.date.slice(5, 7)) - 1, 1)
			: new Date(today.getFullYear(), today.getMonth(), 1);

		this.menu = this.build();
		this.clampToWindow(this.menu, deps.anchor.getBoundingClientRect());
	}

	private build(): HTMLElement {
		const menu = this.deps.container.createDiv({ cls: 'ntn-root ntn-date-menu' });

		// ---- Typed fields: the date (and time), editable like Notion's ----
		const fields = menu.createDiv({ cls: 'ntn-date-fields' });
		this.dateInput = fields.createEl('input', {
			type: 'text',
			cls: 'ntn-date-field',
			attr: { placeholder: 'YYYY-MM-DD', spellcheck: 'false' },
		});
		// Without a time selector the field carries the whole value, so a
		// datetime written by hand stays visible and editable as-is.
		this.dateInput.value = this.deps.withTime ? this.date : this.written;
		this.dateInput.addEventListener('input', () =>
			this.dateInput.removeClass('ntn-date-field-invalid'));
		this.dateInput.addEventListener('keydown', (evt) => this.onKeydown(evt, () => this.commitTyped()));

		if (this.deps.withTime) {
			// A native time control: hour/minute segments with arrow keys and
			// the picker, which is the "selector" Obsidian's own datetime
			// properties use too.
			this.timeInput = fields.createEl('input', {
				type: 'time',
				cls: 'ntn-date-time',
				attr: { step: '60', 'aria-label': 'Time' },
			});
			this.timeInput.value = this.time;
			// `change` fires once a segment edit is complete; write right away
			// so the clock lands even if the editor is closed by a click.
			this.timeInput.addEventListener('change', () => {
				this.time = this.timeInput?.value ?? '';
				if (this.date) this.save();
			});
			this.timeInput.addEventListener('keydown', (evt) => this.onKeydown(evt, () => {
				this.time = this.timeInput?.value ?? '';
				this.commitTyped();
			}));
		}

		// ---- Month header with prev / next ----
		const head = menu.createDiv({ cls: 'ntn-date-head' });
		const prev = head.createDiv({ cls: 'ntn-date-nav', attr: { 'aria-label': 'Previous month' } });
		setIcon(prev, 'chevron-left');
		this.titleEl = head.createDiv({ cls: 'ntn-date-title' });
		const next = head.createDiv({ cls: 'ntn-date-nav', attr: { 'aria-label': 'Next month' } });
		setIcon(next, 'chevron-right');
		prev.addEventListener('click', () => this.shiftMonth(-1));
		next.addEventListener('click', () => this.shiftMonth(1));

		this.gridEl = menu.createDiv({ cls: 'ntn-date-grid' });
		this.renderGrid();

		// ---- Actions ----
		const actions = menu.createDiv({ cls: 'ntn-date-actions' });
		const today = actions.createDiv({ cls: 'ntn-date-action', text: 'Today' });
		today.addEventListener('click', () => this.pick(ymd(new Date())));
		const clear = actions.createDiv({ cls: 'ntn-date-action', text: 'Clear' });
		clear.addEventListener('click', () => {
			this.save(null);
			this.close();
		});

		this.dateInput.focus();
		this.dateInput.select();
		return menu;
	}

	private shiftMonth(delta: number): void {
		this.viewMonth = new Date(this.viewMonth.getFullYear(), this.viewMonth.getMonth() + delta, 1);
		this.renderGrid();
	}

	/** Six weeks of days for the month on display, padded with its neighbours. */
	private renderGrid(): void {
		const locale = moment.localeData();
		const year = this.viewMonth.getFullYear();
		const month = this.viewMonth.getMonth();
		this.titleEl.setText(`${moment.months()[month]} ${year}`);
		this.gridEl.empty();
		// Weekday initials in locale order (`true` shifts them to the locale's
		// first day of the week).
		for (const name of moment.weekdaysMin(true)) {
			this.gridEl.createDiv({ cls: 'ntn-date-weekday', text: name });
		}

		const lead = (this.viewMonth.getDay() - locale.firstDayOfWeek() + 7) % 7;
		const todayKey = ymd(new Date());
		// Always 6 rows so the popover keeps one height across months.
		for (let i = 0; i < 42; i++) {
			const day = new Date(year, month, 1 - lead + i);
			const key = ymd(day);
			const cell = this.gridEl.createDiv({ cls: 'ntn-date-day', text: String(day.getDate()) });
			if (day.getMonth() !== month) cell.addClass('ntn-date-outside');
			if (key === todayKey) cell.addClass('ntn-date-today');
			if (key === this.date) cell.addClass('ntn-date-selected');
			cell.addEventListener('click', () => this.pick(key));
		}
	}

	/**
	 * A day was chosen. Date-only editors write and close; with a time
	 * selector the write lands now and the editor stays open for the clock.
	 */
	private pick(date: string): void {
		this.date = date;
		this.save();
		if (!this.deps.withTime) {
			this.close();
			return;
		}
		this.dateInput.value = date;
		this.viewMonth = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1);
		this.renderGrid();
		this.timeInput?.focus();
	}

	/** The typed field(s) were confirmed with Enter: validate, write, close. */
	private commitTyped(): void {
		const raw = this.dateInput.value.trim();
		if (!raw) {
			this.save(null);
			this.close();
			return;
		}
		// The same rule Bases uses to read a frontmatter string as a date,
		// so what commits here renders as a date in the table.
		if (!DateValue.parseFromString(raw)) {
			this.dateInput.addClass('ntn-date-field-invalid');
			return;
		}
		const typed = splitDateTime(raw);
		this.date = typed.date;
		// A full datetime typed into the date field carries its own time.
		if (typed.time || !this.deps.withTime) this.time = typed.time;
		this.save();
		this.close();
	}

	/** The value as it should be written: date, plus `T` + time when set. */
	private compose(): string {
		return this.date + (this.time ? `T${this.time}` : '');
	}

	/** Write the composed (or given) value unless the note already holds it. */
	private save(value: string | null = this.compose()): void {
		const next = value ?? '';
		if (next === this.written) return;
		this.written = next;
		this.deps.write(value);
	}

	private onKeydown(evt: KeyboardEvent, onEnter: () => void): void {
		if (evt.key === 'Escape') {
			// Consume the key: inside the page panel, a bubbling Esc would
			// close the whole modal along with the editor.
			evt.preventDefault();
			evt.stopPropagation();
			this.close();
		} else if (evt.key === 'Enter') {
			evt.preventDefault();
			onEnter();
		}
	}
}
