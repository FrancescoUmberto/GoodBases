/**
 * An embedded Obsidian markdown editor (Live Preview) for the page panel's
 * body — the same CodeMirror editor a note tab uses, so formatting renders
 * in place while typing instead of dropping to raw markdown.
 *
 * Obsidian exports no API for this. The editor class is reached the way
 * other community plugins do (Kanban's `getEditorClass`): create a throwaway
 * markdown embed from `app.embedRegistry`, make it editable, and take the
 * grandparent prototype of its `editMode` — the editor base class whose
 * constructor is `(app, containerEl, owner)`. Verified against Obsidian
 * 1.13.7's `app.js`. Every internal is runtime-guarded: `createLiveEditor`
 * returns null when anything moved, and the panel falls back to its
 * preview + textarea body.
 */
import { App, Component, Editor, TFile } from 'obsidian';
import { LOG_PREFIX } from '../constants';

/** The internal editor instance, as far as we touch it. */
interface InternalEditor extends Component {
	editor: Editor;
	editorEl: HTMLElement;
	sourceMode: boolean;
	set(text: string, clear: boolean): void;
	destroy(): void;
}

type InternalEditorCtor = new (app: App, containerEl: HTMLElement, owner: unknown) => InternalEditor;

interface EmbedRegistry {
	embedByExtension?: Record<string, (ctx: unknown, file: TFile | null, subpath: string) => unknown>;
}

interface ThrowawayEmbed extends Component {
	editable: boolean;
	showEditor(): void;
	editMode?: { destroy?: () => void };
}

let cachedCtor: InternalEditorCtor | null | undefined;

/** Resolve (once) the internal editor class, or null if the API moved. */
function editorClass(app: App): InternalEditorCtor | null {
	if (cachedCtor !== undefined) return cachedCtor;
	cachedCtor = null;
	try {
		const registry = (app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
		const createMd = registry?.embedByExtension?.md;
		if (typeof createMd !== 'function') return null;
		const embed = createMd({ app, containerEl: createDiv(), state: {} }, null, '') as ThrowawayEmbed;
		embed.load();
		embed.editable = true;
		embed.showEditor();
		const editMode = embed.editMode;
		const ctor = editMode
			? (Object.getPrototypeOf(Object.getPrototypeOf(editMode)) as { constructor?: unknown }).constructor
			: undefined;
		editMode?.destroy?.();
		embed.unload();
		if (typeof ctor === 'function') cachedCtor = ctor as InternalEditorCtor;
	} catch (e) {
		console.warn(`${LOG_PREFIX} live preview editor unavailable, using plain textarea`, e);
	}
	return cachedCtor;
}

export interface LiveEditor {
	/** The editor's root element (already mounted in the container). */
	el: HTMLElement;
	getValue(): string;
	focus(): void;
	destroy(): void;
}

/**
 * Mount a Live Preview editor holding `text` into `container`. `onChange`
 * fires after every document change. Returns null when the internal editor
 * can't be built (callers fall back to a textarea).
 */
export function createLiveEditor(
	app: App,
	container: HTMLElement,
	file: TFile,
	text: string,
	onChange: () => void,
): LiveEditor | null {
	const resolved = editorClass(app);
	if (!resolved) return null;
	const Base: InternalEditorCtor = resolved;

	// The "owner" normally is a MarkdownView / embed. The editor calls back
	// into it for scroll sync, folds and the file path; none of those apply
	// inside the panel, so they are no-ops. `editor`/`file` also make it a
	// usable MarkdownFileInfo for workspace.activeEditor (editor commands).
	const owner = {
		app,
		get file() { return file; },
		get path() { return file.path; },
		getFile: () => file,
		getMode: () => 'source',
		editMode: null as InternalEditor | null,
		get editor() { return owner.editMode?.editor; },
		hoverPopover: null,
		showSearch: () => {},
		toggleMode: () => {},
		syncScroll: () => {},
		onMarkdownScroll: () => {},
		onMarkdownFold: () => {},
		onFoldChange: () => {},
		getFoldInfo: () => null,
	};

	class PanelEditor extends Base {
		/** The base pads the bottom by half the viewport (scroll-past-end); not in a panel. */
		updateBottomPadding(): void {}
		onUpdate(update: { docChanged: boolean }, changed: boolean): void {
			(Base.prototype as unknown as { onUpdate(u: unknown, c: boolean): void })
				.onUpdate.call(this, update, changed);
			if (update.docChanged) onChange();
		}
	}

	const comp = new Component();
	let instance: InternalEditor;
	try {
		instance = new PanelEditor(app, container, owner);
		owner.editMode = instance;
		comp.load();
		comp.addChild(instance);
		// Live Preview regardless of the vault's default editing mode —
		// the panel is meant to read like a formatted page while editing.
		instance.sourceMode = false;
		instance.set(text, true);
	} catch (e) {
		console.warn(`${LOG_PREFIX} live preview editor failed to mount, using plain textarea`, e);
		comp.unload();
		container.empty();
		return null;
	}

	let prevActive: typeof app.workspace.activeEditor = null;
	// Editor commands and hotkeys (bold, toggle checklist…) act on
	// workspace.activeEditor; point it here while the body has focus.
	instance.editorEl.addEventListener('focusin', () => {
		if (app.workspace.activeEditor === owner) return;
		prevActive = app.workspace.activeEditor;
		app.workspace.activeEditor = owner as unknown as typeof app.workspace.activeEditor;
	});

	return {
		el: instance.editorEl,
		getValue: () => instance.editor.getValue(),
		focus: () => instance.editor.focus(),
		destroy: () => {
			if (app.workspace.activeEditor === (owner as unknown)) app.workspace.activeEditor = prevActive;
			try {
				instance.destroy();
			} catch (e) {
				console.warn(`${LOG_PREFIX} failed to tear down live preview editor`, e);
			}
			comp.unload();
		},
	};
}
