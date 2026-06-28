# iOS "Save to GoldenRetriever" Shortcut

Capture links, text, and files into GoldenRetriever from the iOS Share Sheet.

## One-time setup

1. In GoldenRetriever, open **Settings → API tokens**, create a token, and copy it.
2. Note your **Base URL** (shown in Settings, e.g. `https://goldenretriever-web.vercel.app`).

## Build the Shortcut (detailed, iOS 17–26)

The server detects the content type, so the Shortcut is just **one HTTP action**. The single
step everyone misses is **"Show More"** in *Get Contents of URL* — the Method/Headers/Body
fields are hidden until you tap it.

### A. Create the shortcut
1. Open **Shortcuts** → tap **+** (top-right) to create a new shortcut.
2. Tap **New Shortcut** at the top → rename it **Save to GoldenRetriever**.

### B. Add the HTTP request
3. Tap **Add Action** (or the search bar) → search **Get Contents of URL** → tap it. The action
   now reads *"Get contents of URL"*.
4. Tap the blue **URL** field and type exactly:
   `https://goldenretriever-web.vercel.app/api/capture`
5. Tap **Show More** (the small row directly under the action). It expands to reveal **Method**,
   **Headers**, **Request Body**.
6. **Method** → tap it → choose **POST**.
7. **Headers** → tap **Add new header**:
   - left **Key** box → type `Authorization`
   - right **Value** box → type `Bearer ` then your token, e.g. `Bearer grt_abc123…`
8. **Request Body** → leave it on **JSON** (this is the default; do NOT use Form — Shortcuts'
   multipart Form body gets dropped before it reaches the server: "network connection was lost").
9. Under Request Body, tap **Add new field** → choose **Text**.
   - **Key** → type `content`
   - **Value** → tap it → choose **Shortcut Input** (if it's not offered directly, tap
     **Select Variable** → **Shortcut Input**).

### C. Make it appear in the Share Sheet
10. Tap the **ⓘ** (Info) button on the bottom toolbar → turn **Show in Share Sheet** ON.
11. Next to **Share Sheet Types**, make sure **URLs, Text, Images, PDFs, and Files** are all
    checked (tap to enable any that aren't) → **Done**.

### D. (Optional) confirmation
12. Search **Show Notification** → add it → set the text to `Saved to GoldenRetriever ✓`.

Tap **Done** to save. That's the whole shortcut — three actions at most.

> **This JSON shortcut captures links and text.** A shared web page is sent as its URL and
> fetched server-side; selected text becomes a note. **Files/images** can't ride in a JSON body —
> for native PDF/image upload, make a **second** shortcut whose *Get Contents of URL* uses
> **Request Body → Form** with a **File** field named `content`, and share files to that one.
>
> **Don't want the token inline?** Add a **Text** action with your token, then a **Set Variable**
> action — tap **Variable Name** and type `Token` — and insert it via **Select Variable**. You
> can't rename a Text action itself; *Set Variable* is what names the value.

## Use it

Share any page/selection/file → **Save to GoldenRetriever**. It appears in your Library
and becomes searchable / answerable in chat within a few seconds (the first file upload
after idle may take 10–30s while the converter warms up).

## Notes

- No KB id is needed — a token maps to your personal library automatically.
- Revoke a lost token any time in **Settings → API tokens**; it stops working immediately.
