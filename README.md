# PDF Composer

PDF Composer is a local Node.js CLI for composing, converting, compressing, filtering, and reordering PDF files. It can also render PDF pages to images and turn JPG or PNG files into a PDF.

All processing happens locally on your machine.

## Requirements

- Node.js 18 or newer
- npm

## Install

Run the installer to install dependencies and make the `pdf-composer` command available globally through npm:

```bash
./install.sh
```

The installer runs `npm install` followed by `npm link`.

For manual installation, run:

```bash
npm install
```

Run the CLI directly from the project:

```bash
node cli.js --help
```

For convenient use as the `pdf-composer` command, link the package locally:

```bash
npm link
pdf-composer --help
```

## Usage

```text
pdf-composer
pdf-composer interactive
pdf-composer pdf-to-images <input.pdf> [--quality medium] [--output images-folder]
pdf-composer images-to-pdf <image...> [--output merged.pdf]
pdf-composer compress <input.pdf> [--quality medium] [--output compressed.pdf]
pdf-composer filter-pages <input.pdf> "1, 3, 5-7, 9-" [--output filtered.pdf]
pdf-composer booklet <input.pdf> <start-page> <total-page-count> <booklet-count> [--output booklet.pdf]
pdf-composer zip <first.pdf> <second.pdf> [--output alternating.pdf]
pdf-composer merge <first.pdf> <second.pdf> [--output combined.pdf]
```

When using `node cli.js`, replace `pdf-composer` in the examples with `node cli.js`.

Generated PDFs are written to the `output/` folder. `--output` is a filename, not a directory.

`pdf-to-images` writes a folder of JPGs next to the source PDF by default. Use `--output` to choose a different folder, or a `.zip` filename to pack the images.

## Commands

### PDF to images

Render every page as a JPG. By default the images go in a `report-images` folder beside `report.pdf`:

```bash
pdf-composer pdf-to-images report.pdf --quality high
```

### Images to PDF

Create a PDF from images in the order provided:

```bash
pdf-composer images-to-pdf page-1.jpg page-2.png --output report.pdf
```

### Compress a PDF

Rebuild a PDF from rendered images using the selected quality:

```bash
pdf-composer compress large-report.pdf --quality medium --output smaller-report.pdf
```

### Filter pages

Select individual pages and ranges. A trailing hyphen includes every page through the end:

```bash
pdf-composer filter-pages report.pdf "1, 3, 5-7, 9-" --output selected.pdf
```

### Make a booklet

Reorder pages for manual duplex booklet printing. The arguments are the first page number, total page count, and number of booklets:

```bash
pdf-composer booklet report.pdf 1 80 2 --output report-booklet.pdf
```

`book` is also accepted as an alias for `booklet`.

### Zip two PDFs

Interleave two PDFs as A1, B1, A2, B2, and so on. Remaining pages are placed at the end:

```bash
pdf-composer zip left.pdf right.pdf --output alternating.pdf
```

### Merge two PDFs

Append the complete second PDF to the first:

```bash
pdf-composer merge cover.pdf content.pdf --output complete-report.pdf
```

## Quality levels

The `--quality` option accepts:

```text
lowest | lower | low | medium | high | highest
```

Quality affects PDF-to-image resolution and JPEG compression. If omitted, `medium` is used.

Generated PDFs are written under the `output/` folder (created if needed). `--output` takes a filename such as `report.pdf`; that file is saved as `output/report.pdf`. When `--output` is provided, it must be the final parameter.

`pdf-to-images` defaults to a `{name}-images` folder next to the source PDF.

## Interactive mode

Start a guided prompt-based workflow:

```bash
pdf-composer interactive
```

Running `pdf-composer` without a command starts the same interactive workflow.

## Development

The help output is available through the npm start script:

```bash
npm start
```
