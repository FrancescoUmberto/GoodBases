# GoodBases

A custom [Bases](https://help.obsidian.md/bases) view for
[Obsidian](https://obsidian.md) that renders your databases as a
Notion-style table: clean chrome, hover-reveal OPEN buttons, colored
value pills, and inline cell editing.

> Requires Obsidian **1.10.2+** with the **Bases** core plugin enabled.

<!-- TODO: add screenshot -->
<!-- ![GoodBases table view](docs/screenshot.png) -->

## Features

- **Notion-style table** — system font stack, hairline borders, hover
  wash, and a horizontal scroll container so columns never crush, even
  in embeds and reading mode.
- **OPEN button** — hover a row to reveal a button that opens the note,
  just like Notion's database rows.
- **Colored pills** — list properties (tags, multitext) render as pills
  using Notion's 9-color select palette. Colors are assigned by a
  deterministic hash, so a value keeps its color forever.
- **Pinned colors** — override the hash per value with the
  *Pinned pill colors* view option (`value=color`, e.g. `Done=green`).
- **Inline editing** — click a cell to edit text and numbers in a
  floating input; checkboxes toggle in place. Pill cells open a
  select-style menu listing every value already used for that property,
  with search and create-on-Enter.
- **Grouping support** — respects the Bases `group by` configuration.
- **View options** — wrap cell content, toggle vertical lines, force
  specific properties to render as pills.

## Usage

1. Enable the **Bases** core plugin and create a base.
2. In the base toolbar, open the view selector and choose
   **Notion-style table**.
3. Configure columns, filters, sorting, and grouping with the normal
   Bases controls; this view adds its own options (wrapping, vertical
   lines, pill properties, pinned colors) in the view settings.

Notes on editing:

- Only note frontmatter properties (`note.*`) are editable; `file.*`
  and `formula.*` columns are read-only by nature.
- `tags` pills are intentionally read-only for now — tags have special
  semantics and deserve a careful write path.

## Installation

### From the community plugin browser

Once accepted: **Settings → Community plugins → Browse**, search for
"GoodBases", install, and enable.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the
   [latest release](https://github.com/FrancescoUmberto/GoodBases/releases).
2. Put them in `VaultRoot/.obsidian/plugins/good-bases/`.
3. Reload Obsidian and enable the plugin in **Settings → Community
   plugins**.

## Development

```bash
npm install
npm run dev    # esbuild watch mode with inline sourcemaps
npm run build  # type-check + production bundle → main.js
```

Point the repo (or a symlink) at
`VaultRoot/.obsidian/plugins/good-bases/` and reload the plugin in
Obsidian after each build.

## Disclaimer

This plugin is not affiliated with, endorsed by, or sponsored by Notion
Labs, Inc. "Notion" is a trademark of Notion Labs, Inc.; it is used here
only to describe the visual style the view emulates.

## License

[MIT](LICENSE)
