# iOS "Save to GoldenRetriever" Shortcut

Capture links, text, and files into GoldenRetriever from the iOS Share Sheet.

## One-time setup

1. In GoldenRetriever, open **Settings → API tokens**, create a token, and copy it.
2. Note your **Base URL** (shown in Settings, e.g. `https://goldenretriever-web.vercel.app`).

## Build the Shortcut

The server detects the content type, so the Shortcut is just **three actions — no branching,
no variables required.**

Open the **Shortcuts** app → **+** → and add:

1. **Receive** *Safari web pages, Text, Images, PDFs, and Files* from the **Share Sheet**
   (tap the Shortcut's settings → "Show in Share Sheet" → accept those types).
2. **Get Contents of URL**:
   - **URL**: your Base URL + `/api/capture`
     (e.g. `https://goldenretriever-web.vercel.app/api/capture`)
   - **Method**: **POST**
   - **Headers**: add one — name `Authorization`, value `Bearer <paste your token>`
   - **Request Body**: **Form** → add a single field named **content**, and set its value to
     the **Shortcut Input** variable (tap the value → *Select Variable* → Shortcut Input).
3. **Show Notification** → "Saved to GoldenRetriever ✓".

That's the whole Shortcut. `/api/capture` inspects the `content` you send and routes it: a bare
`http(s)` link is fetched and saved as a page, plain text becomes a note, and a file/image/PDF
goes through the document converter.

> Prefer not to paste the token inline? Put it (and the base URL) in a **Text** action followed
> by a **Set Variable** action — tap **Variable Name** and type e.g. `Token` — then insert it
> with **Select Variable**. You can't name a Text action directly; the *Set Variable* action is
> what names the value.

## Use it

Share any page/selection/file → **Save to GoldenRetriever**. It appears in your Library
and becomes searchable / answerable in chat within a few seconds (the first file upload
after idle may take 10–30s while the converter warms up).

## Notes

- No KB id is needed — a token maps to your personal library automatically.
- Revoke a lost token any time in **Settings → API tokens**; it stops working immediately.
