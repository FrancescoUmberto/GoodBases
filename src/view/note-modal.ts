/**
 * Notion-style page panel: a centered modal that edits a note in place —
 * an editable title (renames the file) above the note's properties and an
 * editable body. Used by the table's "+ New" row so a freshly created note
 * opens like Notion's page peek instead of a toolbar-anchored popover.
 *
 * Property rows are editable with the same model as the table: pill
 * properties open the view-managed select editor, dates the calendar editor,
 * booleans toggle in place, plain values swap in an inline input. All writes
 * go through the view (so error handling and pinned colors stay in one
 * place); after each write the rows re-render from the file on disk.
 */
import {
	App,
	Component,
	DateValue,
	Keymap,
	MarkdownRenderer,
	Modal,
	Notice,
	TFile,
	parseYaml,
	setIcon,
} from 'obsidian';
import { LOG_PREFIX } from '../constants';
import { splitFrontmatter } from '../lib/frontmatter';
import { openTagSearch } from '../lib/tag-search';

/** What any floating editor needs to open anchored to a property row / cell. */
interface OpenEditorOpts {
	/** Element the editor anchors beneath (also drives click-to-toggle). */
	anchor: HTMLElement;
	/**
	 * Where the editor is mounted. Defaults to the view's document body; the
	 * page panel passes its modal container so Obsidian's modal focus trap
	 * doesn't yank focus out of the editor's input (see
	 * `FloatingEditorDeps.container`).
	 */
	container?: HTMLElement;
	file: TFile;
	/** Bare frontmatter property name (no `note.` prefix). */
	propName: string;
	/** Called after each successful write so the opener can re-render. */
	onWrite?: () => void;
}

/** Opening the select editor: the pill values currently set. */
export interface OpenSelectOpts extends OpenEditorOpts {
	/** The values currently set, in display form. */
	current: string[];
	isList: boolean;
}

/** Opening the date editor: the value as written (`''` when unset). */
export interface OpenDateOpts extends OpenEditorOpts {
	current: string;
}

/** Callbacks the owning view provides; all editing routes through the view. */
export interface NotePageModalDeps {
	/** Color a pill element for a value (pinned-color aware). */
	applyColor: (pill: HTMLElement, text: string) => void;
	/** Persist one frontmatter property of a file (`null` deletes it). */
	write: (file: TFile, propName: string, value: unknown) => Promise<void>;
	/** Whether the property edits as pills / as a multi-value list / as a date. */
	isPillProp: (propName: string) => boolean;
	isListProp: (propName: string) => boolean;
	isDateProp: (propName: string) => boolean;
	/** Open the view-managed select / date editor. */
	openSelect: (opts: OpenSelectOpts) => void;
	openDate: (opts: OpenDateOpts) => void;
	/** Re-point an open editor after its anchor row re-renders. */
	reanchorEditor: (anchor: HTMLElement, filePath: string, propName: string) => void;
	/** Close the view-managed editor (modal teardown). */
	closeEditor: () => void;
}

export class NotePageModal extends Modal {
	private file: TFile;
	private deps: NotePageModalDeps;
	private pageTitleEl!: HTMLElement;
	private propsEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private bodyArea!: HTMLTextAreaElement;
	/** Lifetime owner for MarkdownRenderer children; replaced per render. */
	private renderComp: Component | null = null;
	private saveTimer: number | null = null;
	/** True while the textarea holds keystrokes not yet written to disk. */
	private dirty = false;

	constructor(app: App, file: TFile, deps: NotePageModalDeps) {
		super(app);
		this.file = file;
		this.deps = deps;
	}

	onOpen(): void {
		// Modal.onOpen is typed void; the actual build is async (file read).
		void this.buildPanel();
	}

	private async buildPanel(): Promise<void> {
		const { contentEl, modalEl } = this;
		modalEl.addClass('ntn-page-modal');
		contentEl.addClass('ntn-page-content');

		// ---- Open-in-new-tab button, next to the modal's close X ----
		const openTabBtn = modalEl.createDiv({
			cls: 'ntn-page-open-tab',
			attr: { 'aria-label': 'Open in new tab', tabindex: '0' },
		});
		setIcon(openTabBtn, 'maximize-2');
		const openInTab = () => {
			// close() flushes the pending body/title writes (onClose); opening
			// by TFile keeps working even if the title rename lands after.
			this.close();
			void this.app.workspace.getLeaf(true).openFile(this.file);
		};
		openTabBtn.addEventListener('click', openInTab);
		openTabBtn.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter' || evt.key === ' ') {
				evt.preventDefault();
				openInTab();
			}
		});

		// ---- Title: an editable h1, like Notion's page title ----
		this.pageTitleEl = contentEl.createEl('h1', {
			cls: 'ntn-page-title',
			// plaintext-only keeps pasted rich text from injecting HTML
			// (supported in Electron/Chromium, which is all Obsidian runs on).
			attr: { contenteditable: 'plaintext-only', 'data-placeholder': 'Untitled' },
		});
		this.pageTitleEl.setText(this.file.basename);
		this.pageTitleEl.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') {
				// Enter on the title moves into the body, like Notion.
				evt.preventDefault();
				this.editBody();
			}
		});
		this.pageTitleEl.addEventListener('blur', () => void this.commitTitle());

		// The note as written on disk: frontmatter feeds the properties
		// section, the body feeds the textarea.
		const { frontmatter, body } = splitFrontmatter(await this.app.vault.read(this.file));

		// ---- Properties (hidden via CSS while empty) ----
		this.propsEl = contentEl.createDiv({ cls: 'ntn-page-props' });
		this.renderPropertyRows(this.parseProperties(frontmatter));

		// ---- Body: rendered markdown, click to edit in a textarea ----
		this.previewEl = contentEl.createDiv({
			cls: 'ntn-page-preview markdown-rendered',
		});
		this.previewEl.addEventListener('click', (evt) => {
			const link = (evt.target as HTMLElement).closest('a');
			if (link?.hasClass('internal-link')) {
				evt.preventDefault();
				const target = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
				this.close();
				void this.app.workspace.openLinkText(target, this.file.path, Keymap.isModEvent(evt));
				return;
			}
			if (link?.hasClass('tag')) {
				// Tags in the body search the vault, like tags anywhere else.
				evt.preventDefault();
				const tag = link.getAttribute('href') ?? link.getText();
				if (openTagSearch(this.app, tag)) this.close();
				return;
			}
			if (link) return; // external links keep their native behavior
			this.editBody();
		});

		this.bodyArea = contentEl.createEl('textarea', {
			cls: 'ntn-page-body ntn-hidden',
			attr: { placeholder: 'Write something…' },
		});
		this.bodyArea.value = body;
		this.bodyArea.addEventListener('input', () => {
			this.autoSizeBody();
			this.scheduleSave();
		});
		this.bodyArea.addEventListener('blur', () => {
			if (this.dirty) void this.saveBody();
			void this.showPreview();
		});

		await this.renderPreview();

		// Focus the title with its text selected so typing replaces the
		// placeholder "Untitled" name immediately.
		this.pageTitleEl.focus();
		contentEl.win.getSelection()?.selectAllChildren(this.pageTitleEl);
	}

	// ---------------- Body: preview <-> edit ----------------

	/** Swap the rendered body for the markdown textarea and focus it. */
	private editBody(): void {
		this.previewEl.addClass('ntn-hidden');
		this.bodyArea.removeClass('ntn-hidden');
		this.autoSizeBody();
		this.bodyArea.focus();
	}

	/**
	 * Grow the textarea to fit its content so the whole body stays readable
	 * while editing — the panel scrolls, the textarea never does. Without
	 * this, a long properties list plus the title can crush a flex-sized
	 * textarea to nothing (many-properties bug, July 2026).
	 */
	private autoSizeBody(): void {
		this.bodyArea.setCssStyles({ height: 'auto' });
		this.bodyArea.setCssStyles({ height: `${this.bodyArea.scrollHeight + 2}px` });
	}

	/** Swap the textarea back for the freshly rendered markdown. */
	private async showPreview(): Promise<void> {
		this.bodyArea.addClass('ntn-hidden');
		this.previewEl.removeClass('ntn-hidden');
		await this.renderPreview();
	}

	private async renderPreview(): Promise<void> {
		// A fresh Component per render drops the previous render's children
		// (MarkdownRenderer attaches child renderers to it).
		this.renderComp?.unload();
		this.renderComp = new Component();
		this.renderComp.load();
		this.previewEl.empty();
		const markdown = this.bodyArea.value;
		if (!markdown.trim()) {
			this.previewEl.createDiv({
				cls: 'ntn-page-preview-empty',
				text: 'Write something…',
			});
			return;
		}
		await MarkdownRenderer.render(
			this.app, markdown, this.previewEl, this.file.path, this.renderComp,
		);
	}

	// ---------------- Properties ----------------

	/** Re-read the file and rebuild the property rows from what's on disk. */
	private async refreshProperties(): Promise<void> {
		const { frontmatter } = splitFrontmatter(await this.app.vault.read(this.file));
		this.renderPropertyRows(this.parseProperties(frontmatter));
	}

	private renderPropertyRows(props: Record<string, unknown>): void {
		this.propsEl.empty();
		for (const [key, value] of Object.entries(props)) {
			this.renderPropertyRow(key, value);
		}
	}

	private renderPropertyRow(key: string, value: unknown): void {
		const row = this.propsEl.createDiv({ cls: 'ntn-page-prop' });
		row.createDiv({ cls: 'ntn-page-prop-name', text: key });
		const valueEl = row.createDiv({ cls: 'ntn-page-prop-value' });

		// Bases matches the `tags` key case-insensitively, so we do too. Tags
		// are always a pill list — Bases wraps even a bare-string `tags: foo`
		// in a tag list, and the select editor writes them back as one.
		const isTags = key.toLowerCase() === 'tags';
		const isPill = isTags || this.deps.isPillProp(key) || Array.isArray(value);

		// ---- Pills: open the select editor ----
		if (isPill) {
			const items = Array.isArray(value)
				? value.map((v) => this.formatScalar(v))
				: (this.isEmpty(value) ? [] : [this.formatScalar(value)]);
			for (const item of items) {
				const pill = valueEl.createSpan({ cls: 'ntn-pill' });
				this.deps.applyColor(pill, item);
				pill.setText(item.replace(/^#/, ''));
				// A tag pill searches on click (and closes the panel); the
				// row's empty space still opens the editor.
				if (isTags) this.makeTagPill(pill, item);
			}
			if (!items.length) this.renderEmpty(valueEl);
			valueEl.addClass('ntn-page-prop-editable');
			valueEl.addEventListener('click', () => {
				this.deps.openSelect({
					anchor: valueEl,
					container: this.containerEl,
					file: this.file,
					propName: key,
					current: items,
					isList: isTags || this.deps.isListProp(key) || Array.isArray(value),
					onWrite: () => void this.refreshProperties(),
				});
			});
			// Keep an open menu pointed at this re-rendered row (same
			// pattern as the table's renderCell after a write).
			this.deps.reanchorEditor(valueEl, this.file.path, key);
			return;
		}

		// ---- Checkboxes write straight back ----
		if (typeof value === 'boolean') {
			const cb = valueEl.createEl('input', { type: 'checkbox', cls: 'ntn-checkbox' });
			cb.checked = value;
			cb.addEventListener('change', () => void this.writeAndRefresh(key, cb.checked));
			return;
		}

		const text = this.isEmpty(value) ? '' : this.formatScalar(value);
		if (text) valueEl.createSpan({ text });
		else this.renderEmpty(valueEl);
		valueEl.addClass('ntn-page-prop-editable');

		// ---- Dates: open the calendar editor ----
		// A date is what the vault registers as one (so an empty row still
		// gets the calendar) or any value Bases itself would read as a date.
		if (this.deps.isDateProp(key) || (text && DateValue.parseFromString(text))) {
			valueEl.addEventListener('click', () => {
				this.deps.openDate({
					anchor: valueEl,
					container: this.containerEl,
					file: this.file,
					propName: key,
					current: text,
					onWrite: () => void this.refreshProperties(),
				});
			});
			this.deps.reanchorEditor(valueEl, this.file.path, key);
			return;
		}

		// ---- Plain values: click-to-edit inline ----
		valueEl.addEventListener('click', () => this.editScalar(valueEl, key, value));
	}

	/**
	 * Make a pill search the vault for its tag, like the table's tag pills.
	 * The panel covers the whole workspace, so it steps aside for the search
	 * pane — closing also flushes any pending title/body edit (onClose).
	 */
	private makeTagPill(pill: HTMLElement, tag: string): void {
		pill.addClass('ntn-pill-tag');
		pill.addEventListener('click', (evt) => {
			evt.stopPropagation();
			if (openTagSearch(this.app, tag)) this.close();
		});
	}

	/** Swap a property row's value for an input; Enter/blur commits, Esc cancels. */
	private editScalar(valueEl: HTMLElement, key: string, value: unknown): void {
		if (valueEl.querySelector('.ntn-input')) return; // already editing
		const kind = typeof value === 'number' ? 'number' : 'text';
		const current = this.isEmpty(value) ? '' : this.formatScalar(value);
		valueEl.empty();
		const input = valueEl.createEl('input', {
			type: 'text',
			cls: 'ntn-input ntn-page-prop-input',
		});
		input.value = current;
		input.focus();
		input.select();

		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;
			const raw = input.value.trim();
			if (raw === current) {
				void this.refreshProperties(); // no write fires; discard the input
				return;
			}
			let out: unknown = raw;
			if (kind === 'number') {
				const n = Number(raw);
				out = raw === '' ? null : (Number.isNaN(n) ? raw : n);
			} else if (raw === '') {
				out = null;
			}
			void this.writeAndRefresh(key, out);
		};

		input.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') {
				evt.preventDefault();
				commit();
			} else if (evt.key === 'Escape') {
				committed = true; // suppress blur commit
				// Consume the key so it cancels the edit, not the whole modal.
				evt.preventDefault();
				evt.stopPropagation();
				void this.refreshProperties();
			}
		});
		input.addEventListener('blur', commit);
	}

	private async writeAndRefresh(propName: string, value: unknown): Promise<void> {
		await this.deps.write(this.file, propName, value);
		await this.refreshProperties();
	}

	private parseProperties(frontmatter: string): Record<string, unknown> {
		if (!frontmatter) return {};
		const yaml = frontmatter
			.replace(/^---\r?\n/, '')
			.replace(/---\r?\n?$/, '');
		try {
			const parsed: unknown = parseYaml(yaml);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch (e) {
			console.error(`${LOG_PREFIX} failed to parse note frontmatter`, e);
		}
		return {};
	}

	private isEmpty(value: unknown): boolean {
		return value === null || value === undefined || value === '';
	}

	private renderEmpty(valueEl: HTMLElement): void {
		valueEl.createSpan({ cls: 'ntn-page-prop-empty', text: 'Empty' });
	}

	/** YAML scalars as Notion would show them (dates as yyyy-mm-dd). */
	private formatScalar(value: unknown): string {
		if (value instanceof Date) return value.toISOString().slice(0, 10);
		return String(value);
	}

	// ---------------- Body ----------------

	/** Debounced autosave: write 400ms after the last keystroke. */
	private scheduleSave(): void {
		this.dirty = true;
		const win = this.contentEl.win;
		if (this.saveTimer !== null) win.clearTimeout(this.saveTimer);
		this.saveTimer = win.setTimeout(() => void this.saveBody(), 400);
	}

	private async saveBody(): Promise<void> {
		this.dirty = false;
		try {
			// Re-split on every save so frontmatter written while the panel is
			// open (property edits, Bases itself) is never clobbered.
			await this.app.vault.process(this.file, (data) =>
				splitFrontmatter(data).frontmatter + this.bodyArea.value,
			);
		} catch (e) {
			console.error(`${LOG_PREFIX} failed to save note body`, e);
			new Notice('Couldn\'t save the note.');
		}
	}

	// ---------------- Title ----------------

	/** Rename the file to match the title; revert the h1 if that fails. */
	private async commitTitle(): Promise<void> {
		// Filenames can't span lines; collapse whatever a paste dragged in.
		const title = (this.pageTitleEl.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (!title || title === this.file.basename) return;
		const folder = this.file.parent?.path ?? '';
		const newPath = folder && folder !== '/' ? `${folder}/${title}.md` : `${title}.md`;
		try {
			await this.app.fileManager.renameFile(this.file, newPath);
		} catch (e) {
			console.error(`${LOG_PREFIX} failed to rename note`, e);
			new Notice(`Couldn't rename the note to "${title}".`);
			this.pageTitleEl.setText(this.file.basename);
		}
	}

	onClose(): void {
		this.deps.closeEditor();
		this.renderComp?.unload();
		this.renderComp = null;
		if (this.saveTimer !== null) this.contentEl.win.clearTimeout(this.saveTimer);
		// Final flush so the last keystrokes and title edit are never lost.
		// Runs async (Modal.onClose is typed void); the input elements stay
		// alive in the closure even after the modal DOM is emptied.
		void this.flushPendingEdits();
		this.contentEl.empty();
	}

	private async flushPendingEdits(): Promise<void> {
		if (this.dirty) await this.saveBody();
		await this.commitTitle();
	}
}
