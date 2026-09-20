/**
 * Common ground for the floating cell editors (the select editor for pills,
 * the date editor for dates): a fixed-position popover mounted into a
 * container, anchored beneath a cell or property row, whose lifetime the
 * owning view drives — it holds at most one open editor and closes it on
 * outside click / Esc / unload.
 *
 * Editors hold only a stable `TFile` and the property id (never a
 * `BasesEntry`), so they survive the view's `onDataUpdated` re-renders; the
 * view re-points them at the freshly rendered cell via
 * {@link FloatingEditor.reanchorIfMatches}.
 */
import { BasesPropertyId, TFile } from 'obsidian';

export interface FloatingEditorDeps {
	/** The view's own window (popout-safe), used to clamp the popover on screen. */
	win: Window;
	/**
	 * Element the popover is appended to — normally the document body, but the
	 * page panel passes its modal container: Obsidian traps focus inside the
	 * open modal's `containerEl` (`Scope.setTabFocusContainerEl` +
	 * `Keymap.onFocusIn`), so a popover on the body would lose its input's
	 * focus to the modal's first focusable element (the title) one tick after
	 * opening. Doubles as the scope for {@link FloatingEditor.reanchorIfMatches},
	 * so a table re-render can't steal the anchor of an editor opened from the
	 * panel.
	 */
	container: HTMLElement;
	/** Cell (or property row) element the popover anchors beneath. */
	anchor: HTMLElement;
	/** The file being edited (a `TFile` is stable across data updates). */
	file: TFile;
	/** Property being edited. */
	prop: BasesPropertyId;
	/** Invoked once when the editor closes, so the owner can drop its reference. */
	onClose: () => void;
}

export abstract class FloatingEditor<D extends FloatingEditorDeps = FloatingEditorDeps> {
	/** The popover root; subclasses create it in their constructor. */
	protected menu!: HTMLElement;
	private closed = false;

	constructor(protected readonly deps: D) {}

	/** The element this editor is anchored to (drives click-to-toggle). */
	get anchorEl(): HTMLElement {
		return this.deps.anchor;
	}

	/** Whether the given node lives inside the popover. */
	contains(node: Node | null): boolean {
		return !!node && this.menu.contains(node);
	}

	/**
	 * Re-point the editor at a freshly rendered cell for the same file +
	 * property. `onDataUpdated` replaces every `td`, so without this the
	 * anchor would dangle on a detached node and click-to-toggle (which
	 * compares against the live cell) would miss. Returns whether it matched.
	 */
	reanchorIfMatches(el: HTMLElement, filePath: string, prop: BasesPropertyId): boolean {
		if (this.closed) return false;
		if (this.deps.prop !== prop || this.deps.file.path !== filePath) return false;
		// Only elements from the same surface the editor belongs to: a table
		// re-render must not re-point an editor opened from the page panel.
		if (!this.deps.container.contains(el)) return false;
		this.deps.anchor = el;
		return true;
	}

	/** Tear the popover down. Idempotent; notifies the owner via `onClose`. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.onClosing();
		this.menu.remove();
		this.deps.onClose();
	}

	/** Hook for subclasses to tear down side popovers before the menu goes. */
	protected onClosing(): void {}

	/** Place a popover just below `anchorRect`, nudged to stay on screen. */
	protected clampToWindow(el: HTMLElement, anchorRect: DOMRect): void {
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
