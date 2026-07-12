# GoodBases

A custom [Bases](https://help.obsidian.md/bases) view for
[Obsidian](https://obsidian.md) that renders your databases as a
Notion-style table: clean chrome, hover-reveal OPEN buttons, colored
value pills, and inline cell editing.

![GoodBases — Notion-style table view](docs/asset/intro.png)

![Tag selection](docs/asset/zoom.png)

> Requires Obsidian **1.10.2+** with the **Bases** core plugin enabled.

## Demo

![Inline editing and pill select menu in action](docs/asset/demo.gif)

## The page panel

Click **+ New** (or set *Open notes in* to *Page panel* and use the
hover OPEN button) to work on a note without leaving the table, in a
centered Notion-style panel:

![The Notion-style page panel](docs/asset/panel.png)

- **Title** — a real heading; type to rename the note, Enter jumps to
  the body.
- **Properties** — the note's frontmatter, editable exactly like the
  table: pill values open the select editor (with the color picker),
  checkboxes toggle in place, text and numbers edit inline.
- **Body** — rendered as formatted Markdown; click it to edit the
  source, click away and it renders again. Changes save automatically
  as you type.

![Creating and editing a note in the page panel](docs/asset/panel_demo.gif)

## Features

- **Notion-style table** — system font stack, hairline borders, hover
  wash, and a horizontal scroll container so columns never crush, even
  in embeds and reading mode.
- **OPEN button** — hover a row to reveal a button that opens the note,
  just like Notion's database rows.
- **Colored pills** — list properties (tags, multitext) render as pills
  using Notion's 9-color palette (accurate light- and dark-mode values).
  Colors are assigned by a deterministic hash, so a value keeps its color
  forever — unless you choose your own.
- **Per-value color picker** — click the colored square next to any value
  in the pill select menu and pick a color from Notion's palette. Your
  choice is saved and applies everywhere that value appears. (You can also
  set colors in bulk with the *Pinned pill colors* view option —
  `value=color`, e.g. `Done=green`.)
- **Inline editing** — click a cell to edit text and numbers in a
  floating input; checkboxes toggle in place. Pill cells open a
  select-style menu listing every value already used for that property,
  with search and create-on-Enter.
- **Page panel** — **+ New** opens the freshly created note centered in
  a Notion-style panel: an editable title, the note's properties
  (editable just like the table), and the body rendered as formatted
  Markdown. See [The page panel](#the-page-panel).
- **Choose what OPEN does** — the *Open notes in* view option points the
  hover OPEN button at a new tab (default) or at the page panel.
- **Grouping support** — respects the Bases `group by` configuration.
- **View options** — wrap cell content (on by default), toggle vertical
  lines, choose how OPEN opens notes, force specific properties to
  render as pills, and pin pill colors.

## Usage

1. Enable the **Bases** core plugin and create a base.
2. In the base toolbar, open the view selector and choose
   **Notion-style table**.
3. Configure columns, filters, sorting, and grouping with the normal
   Bases controls; this view adds its own options (wrapping, vertical
   lines, open mode, pill properties, pinned colors) in the view
   settings.

Notes on editing:

- Only note frontmatter properties (`note.*`) are editable; `file.*`
  and `formula.*` columns are read-only by nature.
- `tags` pills are intentionally read-only for now — tags have special
  semantics and deserve a careful write path.

## Installation

### From the community plugin browser

Once accepted: **Settings → Community plugins → Browse**, search for
[GoodBases](https://community.obsidian.md/plugins/good-bases), install, and enable. Then, open the view selector and pick **Notion-style table**.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the
   [latest release](https://github.com/FrancescoUmberto/GoodBases/releases).
2. Put them in `VaultRoot/.obsidian/plugins/good-bases/`.
3. Reload Obsidian and enable the plugin in **Settings → Community
   plugins**.

### Optional: Notion-style toolbar

The blue Notion-style **New** button and icon-only Sort / Filter /
Properties / Search are an **optional CSS snippet** (the toolbar is core
Obsidian UI, outside the plugin's view, so it isn't styled by the plugin
itself):

1. Copy
   [`snippets/goodbases-notion-toolbar.css`](snippets/goodbases-notion-toolbar.css)
   into `VaultRoot/.obsidian/snippets/`.
2. Enable it under **Settings → Appearance → CSS snippets**.

The snippet only affects a Base's toolbar while a GoodBases view is open;
every other base keeps its native toolbar.

<!-- ## Development

```bash
npm install
npm run dev    # esbuild watch mode with inline sourcemaps
npm run build  # type-check + production bundle → main.js
```

Point the repo (or a symlink) at
`VaultRoot/.obsidian/plugins/good-bases/` and reload the plugin in
Obsidian after each build. -->

## Support

GoodBases is free and open source, built and maintained in my spare
time. If it makes your vault a little nicer to work in, you can
[buy me a coffee](https://buymeacoffee.com/umbertofrancesco) ☕ — it
goes toward new features and keeping up with Obsidian's API changes.

## Roadmap

Where GoodBases is heading. These are directions, not dated promises —
want to nudge one up the list?
[Open an issue](https://github.com/FrancescoUmberto/GoodBases/issues).

- ✅ **First public release** (0.3) — Notion-style table view: colored
  pills, inline cell editing, the pill select editor, pinned colors,
  hover-reveal OPEN button, grouping, and view options.
- ✅ **Per-value color picker** (0.4) — recolor any value from Notion's
  palette; your choice persists everywhere it appears. Cells wrap by
  default.
- ✅ **Page panel** (0.5) — create and open notes in a centered
  Notion-style panel: editable title and properties, body rendered as
  formatted Markdown, and an *Open notes in* option for the OPEN button.
- 🔵 **Column resizing** (next) — drag handles on column borders, with
  widths persisted per view.
- 🔵 **Calculated footers** (next) — a Notion-style per-column
  *Calculate* row (count, sum, average, and more).
- 🔵 **Editable tags** (next) — extend the select editor to write `tags`
  safely (currently read-only).
- ⚪️ **Board & gallery views** (exploring) — Kanban boards and card
  galleries; deprioritized for now while table fidelity comes first.

## Changelog

The full history and downloadable builds are on the
[Releases page](https://github.com/FrancescoUmberto/GoodBases/releases).

### 0.5.1

- **Added:** the base's native toolbar **New** button now opens the page
  panel too, while a GoodBases view is active (other Bases views keep
  the core popover).
- **Added:** an open-in-new-tab button next to the page panel's close
  button — it saves pending edits, closes the panel, and opens the note
  in a new tab.

### 0.5.0

**📄 New — Notion-style page panel.** **+ New** now opens the freshly
created note centered in a panel, like Notion's page peek: an editable
title, the note's properties — pills open the same select editor as the
table, checkboxes toggle, text and numbers edit inline — and the body
rendered as formatted Markdown (click to edit the source, click away to
render it again; changes autosave as you type).

Also in this release:

- **Added:** an *Open notes in* view option — point the hover OPEN
  button at a new tab (default) or at the page panel.

### 0.4.5

- **Fixed:** in dark mode the table header no longer shows a light
  background — it now follows the page background like the rest of the
  table.
- **Fixed:** column headers now align consistently between editing and
  reading mode (header text is vertically centered in both).

### 0.4.4

- **Fixed:** long, multi-line text cells now edit in a textarea, so the
  full wrapped text stays visible while you type — previously a
  single-line input scrolled the text sideways. Shift+Enter inserts a
  newline; Enter saves.

### 0.4.3

- **Fixed:** clicking a pill cell again now closes its tag selector
  (previously only an outside click or Esc would).
- **Fixed:** the inline text/number edit box now matches the size of the
  cell you click, instead of a fixed size.

### 0.4.2

- **Changed:** the optional Notion-style toolbar snippet no longer uses
  the `:has()` selector, avoiding the performance cost of broad selector
  invalidation. Once enabled, the snippet now restyles every Bases
  toolbar (not just GoodBases views).

### 0.4.1

- **Changed:** the Notion-style toolbar restyle (blue "New" button +
  icon-only Sort / Filter / Properties / Search) is now an **optional CSS
  snippet** (`snippets/goodbases-notion-toolbar.css`) rather than shipping
  in the plugin, so GoodBases no longer restyles Obsidian's core UI. See
  [Installation → Optional: Notion-style toolbar](#optional-notion-style-toolbar).

### 0.4.0

**🎨 New — per-value color picker.** Click the colored square next to any
value in the pill select menu and pick a color from Notion's palette. Your
choice is saved (persisted to the *Pinned pill colors* option) and applies
everywhere that value appears.

![Picking a pill color from the select menu](docs/asset/color_picker.gif)

![The restyled Bases toolbar with a Notion-like blue "New" button](docs/asset/button.png)

Also in this release:

- **Changed:** cell content now wraps by default.
- **Changed:** colored pills use Notion's exact light- and dark-mode
  palette values.
- **Changed:** restyled the Bases toolbar for the Notion-style view — a
  Notion-like blue "New" button and icon-only Sort / Filter / Properties /
  Search, scoped so it only affects this plugin's views.
- **Fixed:** the inline edit box no longer lingers after you click away
  from a cell without changing it.


### 0.3.2

- **Added:** the project landing page, demo GIF, and a Buy Me a Coffee
  funding link.

### 0.3.1

- **Initial release:** Notion-style table view — colored pills, inline
  cell editing, the pill select editor, pinned pill colors, hover-reveal
  OPEN button, grouping support, and view options.

## Disclaimer

This plugin is not affiliated with, endorsed by, or sponsored by Notion
Labs, Inc. "Notion" is a trademark of Notion Labs, Inc.; it is used here
only to describe the visual style the view emulates.

## License

[MIT](LICENSE)
