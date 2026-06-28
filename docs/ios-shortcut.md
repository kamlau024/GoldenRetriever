# iOS "Save to GoldenRetriever" Shortcut

Capture links, text, and files into GoldenRetriever from the iOS Share Sheet.

## One-time setup

1. In GoldenRetriever, open **Settings → API tokens**, create a token, and copy it.
2. Note your **Base URL** (shown in Settings, e.g. `https://goldenretriever-web.vercel.app`).

## Build the Shortcut

Open the **Shortcuts** app → **+** → and add these actions:

1. **Receive** *Safari web pages, Text, Images, PDFs, and Files* from the **Share Sheet**
   (tap the Shortcut's settings → "Show in Share Sheet" → accept those types).
2. **Text** action → paste your token. (Name it `Token`.)
3. **Text** action → paste your Base URL. (Name it `BaseURL`.)
4. **If** *Shortcut Input* **has any value** and is a **URL**:
   - **Get Contents of URL**
     - URL: `BaseURL` + `/api/ingest`
     - Method: **POST**
     - Headers: `Authorization` = `Bearer ` + `Token`
     - Request Body: **JSON** → `{ "url": <Shortcut Input> }`
5. **Otherwise If** the input is **Text**:
   - **Get Contents of URL** → `BaseURL/api/ingest`, POST, same `Authorization` header,
     JSON body `{ "text": <Shortcut Input> }`.
6. **Otherwise** (a file/image/PDF):
   - **Get Contents of URL** → `BaseURL/api/upload`, POST, same `Authorization` header,
     Request Body: **Form** → add field **file** = *Shortcut Input* (the shared file).
7. **Show Notification**: "Saved to GoldenRetriever ✓".

## Use it

Share any page/selection/file → **Save to GoldenRetriever**. It appears in your Library
and becomes searchable / answerable in chat within a few seconds (the first file upload
after idle may take 10–30s while the converter warms up).

## Notes

- No KB id is needed — a token maps to your personal library automatically.
- Revoke a lost token any time in **Settings → API tokens**; it stops working immediately.
