# convert — markitdown HTTP service

Converts binary documents (PDF, Office, images) to Markdown for the ingest
pipeline. A single Vercel Python serverless function (`api/index.py`) wrapping
Microsoft [markitdown](https://github.com/microsoft/markitdown).

The web app calls it from `MarkitdownConverter` at `${MARKITDOWN_URL}/api/index`,
authenticating with the shared `MARKITDOWN_SECRET` (HMAC-compared, fail-closed).

## Env

- `MARKITDOWN_SECRET` — shared secret; must match the web project's value.

## Deploy

Deployed as its **own** Vercel project (separate from the web app):

```bash
vercel deploy --cwd services/convert --prod
```

Zero-config: Vercel auto-detects the Python function from `requirements.txt` +
`api/index.py`. Do **not** add a `functions` block to `vercel.json` — pinning
`api/index.py` there makes Vercel fail detection ("pattern doesn't match any
Serverless Functions"). Resource limits use the platform defaults (300s timeout).
