# Strata PDF Splitter

A Vercel-ready browser app for splitting machine-readable AutoCAD strata plan PDFs into unit-level PDFs.

The PDF is processed in the user's browser. It is not uploaded to Vercel or any backend service.

## What it does

- Reads one PDF at a time.
- Extracts the unit code from each page.
- Uses the title block marker `STRATA UNIT DETAILS` first.
- Falls back to a full-page regex search.
- Flags missing codes, duplicate codes, multiple codes, and pattern mismatches.
- Lets the user manually override a page code.
- Splits the PDF without rasterizing or compressing the page content.
- Downloads a ZIP containing:
  - `Strata_Output/` for valid files
  - `Review_Folder/` for pages with issues
  - `processing_log.xlsx`

## Naming conventions

Unit codes are described with a dynamic segment builder. A code is a sequence of
segments, each one of:

- **Fixed text** — a literal piece such as `H5`, `R2`, or `-`
- **Letters (A–Z)** — with a min–max length
- **Digits (0–9)** — with a min–max length
- **Letters or digits** — with a min–max length

Variable-length segments are supported, so codes like `R2A-201` and `R2A-1201`
(floor 2 vs floor 12) match the same convention.

Two presets ship with the app:

| Preset | Segments | Examples |
| --- | --- | --- |
| Classic | `H5` + `-` + 2 alphanumeric + `-` + 2 alphanumeric | `H5-0G-01`, `H5-01-02` |
| Tower block | `R2` + 1 letter (block) + `-` + 1–2 digits (floor) + 2 digits (unit) | `R2A-201`, `R2B-1307` |

Editing any segment switches the preset to **Custom**. Settings persist in
`localStorage`. A live pattern preview and a "test a code" box show whether a
sample code matches. You can also provide a custom regex override.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Build

```bash
npm run build
```

The build step does not bundle anything. It only confirms the static app is ready. The PDF libraries are already vendored in `vendor/`.
