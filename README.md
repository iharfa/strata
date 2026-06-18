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

## Default pattern

The default unit code pattern is:

```text
H5-[A-Z0-9]{2}-[A-Z0-9]{2}
```

Examples:

```text
H5-0G-01
H5-01-01
H5-01-02
```

You can change the prefix and segment lengths in the app. You can also provide a custom regex override.

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
