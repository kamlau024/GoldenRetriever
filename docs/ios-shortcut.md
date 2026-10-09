# iOS "Save to GoldenRetriever" Shortcut

Capture links, text, and files into GoldenRetriever from the iOS Share Sheet.

## One-time setup

1. In GoldenRetriever, open **Settings → API tokens**, create a token, and copy it.
2. Note your **Base URL** (shown in Settings, e.g. `https://goldenretriever-web.vercel.app`).

## Build the Shortcut (iOS 17–26)

> **Important:** iOS Shortcuts can't reliably upload a **POST** body (it fails with "network
> connection was lost" before the request even leaves the phone — an iOS URLSession/HTTP-2 issue).
> Plain **GET** requests work fine, so this shortcut sends the captured content in the URL query
> string and the token in a request **header**.

### A. Create the shortcut
1. Open **Shortcuts** → tap **+** → rename it **Save to GoldenRetriever**.

### B. URL-encode the shared item
2. Tap **Add Action** → search **URL Encode** → add it. Set its input to **Shortcut Input**
   (tap the input → **Shortcut Input**). This makes links with `?`/`&`/etc. safe in a URL.

### C. The request (a GET with one header, no body)
3. **Add Action** → **Get Contents of URL**.
4. Tap the **URL** field and enter:
   `https://goldenretriever-web.vercel.app/api/capture?content=`
   then, immediately after `content=`, **insert the URL Encoded variable** (tap at the end of
   the URL → **Select Variable** → the *URL Encoded* output of step 2).
5. Leave **Method** as **GET** (the default). Do **not** add a request body.
6. Tap **Show More → Headers → Add new header**: key `Authorization`, value
   `Bearer YOUR_TOKEN` (replace `YOUR_TOKEN` with the token from **Settings → API tokens**).
   Headers on a GET don't trigger the POST-body failure.

   > **Never put the token in the URL.** The server rejects `?token=` with a 401. URLs are
   > written to server logs, and a token grants full access to your library (read, chat,
   > delete), not just capture.

### D. Share Sheet + confirmation
7. Tap the **ⓘ** (Info) button → **Show in Share Sheet** ON → ensure **URLs** and **Text** are
   accepted → **Done**.
8. (Optional) **Show Notification** → `Saved to GoldenRetriever ✓`.

Tap **Done** to save.

> **What it captures:** a shared web page is sent as its URL and fetched server-side; selected
> text becomes a note. **Files/images** can't go through a GET — upload those from the web app
> (the `/api/capture` endpoint still accepts a POST multipart `content` file for non-iOS clients).
>
> **Security:** the token travels only in the `Authorization` header. The captured content is
> still in the URL, so the links and text you save can appear in server logs.
>
> **Test it:** tap the shortcut directly first. With no shared input it sends an empty `content`,
> which returns a harmless `{"ok":true}` (no error) — proof the request reached the server. Then
> share a real page from Safari.

## Use it

Share any page/selection/file → **Save to GoldenRetriever**. It appears in your Library
and becomes searchable / answerable in chat within a few seconds (the first file upload
after idle may take 10–30s while the converter warms up).

## Notes

- No KB id is needed — a token maps to your personal library automatically.
- Revoke a lost token any time in **Settings → API tokens**; it stops working immediately.

## Migrating from an older Shortcut

Earlier versions of this guide put the token in the URL (`?token=YOUR_TOKEN&content=`). That
form is no longer accepted. To update:

1. Edit the shortcut's **Get Contents of URL** action: delete `token=YOUR_TOKEN&` from the URL
   and add the `Authorization` header from step 6.
2. In **Settings → API tokens**, revoke the old token and create a new one for the header, since
   the old token has already been written to server logs.
