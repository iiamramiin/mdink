<p align="center"><img src="resources/icons/appIcon.png" width="96" alt="mdink icon"></p>

<h1 align="center">mdink</h1>

<p align="center">A tiny, portable Markdown viewer for Windows — with diagrams, math, print / PDF, and pen & highlighter annotations.<br>One <code>.exe</code>, about 10 MB. No installer, no runtime to download.</p>

---

## Features

- **Reads like a document** — GitHub-flavored Markdown on a paper-sized page: tables, task lists, footnotes, alerts (`> [!NOTE]`), front matter, syntax-highlighted code with a copy button.
- **Diagrams** — ```` ```mermaid ```` blocks (flowchart, sequence, class, state, ER, gantt, pie, mindmap, …) rendered as crisp SVG.
- **Math** — `$inline$` and `$$display$$` LaTeX via KaTeX.
- **Right-to-left aware** — Persian / Arabic / Hebrew paragraphs, lists and tables flip direction automatically; the Vazirmatn font is built in.
- **Fonts & themes** — pick any installed font (or the built-in Vazirmatn), code font, size and line height; light, sepia and dark themes.
- **Zoom** — Ctrl + wheel, Ctrl +/−/0, fit-to-width.
- **Annotate** — highlighter (4 colors), pen, marker, sticky text notes, eraser, undo/redo. Annotations stick to the paragraph they belong to, are saved per file, and are printed in place.
- **Print / Save as PDF** — Ctrl+P, or the PDF button (pick “Save as PDF” in the print dialog). Page size A4 / Letter / Legal / A5.
- **Handy** — outline sidebar, find (Ctrl+F), relative images and links between `.md` files, back navigation, auto-reload when the file changes, recent files, drag & drop.

## Download & run

1. Grab `mdink-win-x64.zip` from [Releases](../../releases) and unzip it anywhere (a USB stick works).
2. Double-click `mdink.exe`.
3. *(Optional)* run `add-to-open-with.bat` once, then right-click any `.md` file → **Open with → Choose another app → mdink → Always**.

Requirements: Windows 10 or 11 (uses the Microsoft Edge WebView2 runtime that ships with Windows).

> Windows SmartScreen may warn about an unknown publisher the first time, because the exe isn't code-signed. Choose **More info → Run anyway**.

## Keyboard shortcuts

| Keys | Action | Keys | Action |
|---|---|---|---|
| Ctrl+O | Open file | V | Select / read |
| Ctrl+P | Print | H | Highlighter (or highlight the selection) |
| Ctrl+Shift+S | Save as PDF | P | Pen |
| Ctrl+F | Find | M | Marker |
| Ctrl + / − / 0, Ctrl+wheel | Zoom | T | Text note |
| Ctrl+\\ | Outline | E | Eraser |
| F5 | Reload file | Ctrl+Z / Ctrl+Y | Undo / redo |
| Alt+← | Back | D | Toggle dark theme |
| ? | All shortcuts | Esc | Back to select |

## Where things are stored

mdink is portable: settings, recent files and annotations live in a hidden `.storage` folder next to `mdink.exe` (annotations are keyed by the file's full path). Your `.md` files are never modified. The WebView2 engine keeps its own browser cache under `%APPDATA%\mdink.exe`.

## Security

Markdown can contain raw HTML, so every document is sanitized with DOMPurify, Mermaid runs in `strict` mode, and the app can only call the few native functions it needs (read files, open dialog, open links in your browser, print, storage). It cannot write or delete your files or run programs.

## Build from source

```bash
npm install
npx neu update        # downloads the Neutralinojs binaries (once)
npm run build         # -> dist/mdink-win/mdink.exe
npm run dev           # run with live files during development
```

Tagging a commit `v*` runs the GitHub Action, which builds the portable zip and attaches it to a release.

### Project layout

```
resources/
  index.html          app shell
  css/app.css         UI, themes, document and print styles
  js/app.js           rendering, files, zoom, fonts, find, printing
  js/ink.js           highlights, pen/marker strokes, notes
  sample/welcome.md   start page
scripts/vendor.js     copies browser builds of the libraries into resources/vendor
windows/*.bat         "Open with" registration helpers
```

## Built with

[Neutralinojs](https://neutralino.js.org) · [marked](https://marked.js.org) · [Mermaid](https://mermaid.js.org) · [KaTeX](https://katex.org) · [highlight.js](https://highlightjs.org) · [DOMPurify](https://github.com/cure53/DOMPurify) · [Vazirmatn](https://github.com/rastikerdar/vazirmatn)

## License

MIT
