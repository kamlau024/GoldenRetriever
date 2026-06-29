# iOS "Save to GoldenRetriever" Shortcut

Capture links, text, and files into GoldenRetriever from the iOS Share Sheet.

## One-time setup

1. In GoldenRetriever, open **Settings → API tokens**, create a token, and copy it.
2. Note your **Base URL** (shown in Settings, e.g. `https://goldenretriever-web.vercel.app`).

## Build the Shortcut (iOS 17–26)

> **Important:** iOS Shortcuts can't reliably upload a **POST** body (it fails with "network
> connection was lost" before the request even leaves the phone — an iOS URLSession/HTTP-2 issue).
> Plain **GET** requests work fine, so this shortcut sends the capture in the URL query string.

### A. Create the shortcut
1. Open **Shortcuts** → tap **+** → rename it **Save to GoldenRetriever**.

### B. URL-encode the shared item
2. Tap **Add Action** → search **URL Encode** → add it. Set its input to **Shortcut Input**
   (tap the input → **Shortcut Input**). This makes links with `?`/`&`/etc. safe in a URL.

### C. The request (a GET — no headers, no body)
3. **Add Action** → **Get Contents of URL**.
4. Tap the **URL** field and enter this, replacing `YOUR_TOKEN` with the token from
   **Settings → API tokens**:
   `https://goldenretriever-web.vercel.app/api/capture?token=YOUR_TOKEN&content=`
   then, immediately after `content=`, **insert the URL Encoded variable** (tap at the end of
   the URL → **Select Variable** → the *URL Encoded* output of step 2).
5. Leave **Method** as **GET** (the default). Do **not** add a request body.

   > **More secure (recommended):** keep the token **out of the URL**. Use the URL
   > `…/api/capture?content=` + the URL-Encoded variable (no `token=`), then tap **Show More →
   > Headers → Add new header**: `Authorization` = `Bearer YOUR_TOKEN`. The server accepts the
   > token from that header on a GET, so it never appears in server logs. Headers on a GET don't
   > trigger the POST-body failure. Fall back to `?token=` in the URL only if the header variant
   > fails on your device.

### D. Share Sheet + confirmation
6. Tap the **ⓘ** (Info) button → **Show in Share Sheet** ON → ensure **URLs** and **Text** are
   accepted → **Done**.
7. (Optional) **Show Notification** → `Saved to GoldenRetriever ✓`.

Tap **Done** to save.

> **What it captures:** a shared web page is sent as its URL and fetched server-side; selected
> text becomes a note. **Files/images** can't go through a GET — upload those from the web app
> (the `/api/capture` endpoint still accepts a POST multipart `content` file for non-iOS clients).
>
> **Security:** the token rides in the URL (and thus server access logs). That's acceptable for a
> personal, **revocable** capture token — revoke it any time in **Settings → API tokens**.
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
