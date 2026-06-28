# iOS "Save to GoldenRetriever" Shortcut

Capture links, text, and files into GoldenRetriever from the iOS Share Sheet.

## One-time setup

1. In GoldenRetriever, open **Settings → API tokens**, create a token, and copy it.
2. Note your **Base URL** (shown in Settings, e.g. `https://goldenretriever-web.vercel.app`).

## Build the Shortcut

Open the **Shortcuts** app → **+** → and add these actions:

1. **Receive** *Safari web pages, Text, Images, PDFs, and Files* from the **Share Sheet**
   (tap the Shortcut's settings → "Show in Share Sheet" → accept those types).
2. Create a named **Token** variable:
   - Add a **Text** action → paste your token.
   - Add a **Set Variable** action right below it → tap the **Variable Name** field and type
     `Token`. (Its value auto-fills with the Text above.) You can't rename the Text action
     itself — the *Set Variable* action is what gives the value a name.
3. Create a named **BaseURL** variable the same way:
   - **Text** action → paste your Base URL → **Set Variable** → name it `BaseURL`.

   > To insert `Token` or `BaseURL` into a field later, tap the field, then tap **Select
   > Variable** (or the variables strip above the keyboard) and pick it — don't type the name.

   The **If** action only tests *values* (has any value / is / contains), not types — there
   is no "is a URL" condition. So detect the type with a dedicated action first, then test
   *its* result.

4. **Get URLs from Input** → pass it *Shortcut Input*. (Call its result `Links`.) This pulls
   any web link out of the shared item; it's empty for plain text or a file.
5. **If** `Links` **has any value** — a shared web page or link:
   - **Get Contents of URL**
     - URL: `BaseURL` + `/api/ingest`
     - Method: **POST**
     - Headers: `Authorization` = `Bearer ` + `Token`
     - Request Body: **JSON** → `{ "url": Links }`
6. **Otherwise:**
   - **Get Text from Input** → pass *Shortcut Input* (call it `SharedText`).
   - **If** `SharedText` **has any value** — selected text:
     - **Get Contents of URL** → `BaseURL/api/ingest`, POST, same `Authorization` header,
       JSON body `{ "text": SharedText }`.
   - **Otherwise** — a file, image, or PDF:
     - **Get Contents of URL** → `BaseURL/api/upload`, POST, same `Authorization` header,
       Request Body: **Form** → add field **file** = *Shortcut Input*.
7. **Show Notification**: "Saved to GoldenRetriever ✓".

> Routing by type in Shortcuts is finicky. A PDF with selectable text may be caught by
> *Get Text from Input* and ingested as text rather than uploaded through the converter —
> usually fine, but if you want PDFs to always go through file-upload, share them from the
> **Files** app instead of a PDF viewer.

## Use it

Share any page/selection/file → **Save to GoldenRetriever**. It appears in your Library
and becomes searchable / answerable in chat within a few seconds (the first file upload
after idle may take 10–30s while the converter warms up).

## Notes

- No KB id is needed — a token maps to your personal library automatically.
- Revoke a lost token any time in **Settings → API tokens**; it stops working immediately.
