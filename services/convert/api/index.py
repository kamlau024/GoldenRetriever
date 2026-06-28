import hmac
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler
from markitdown import MarkItDown

_md = MarkItDown()

_EXT = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Liveness probe only — no secret required and returns no data. The real work is
        # POST /api/index (secret-protected). Without this, a browser GET returns a 501.
        return self._send(200, {"status": "ok", "service": "convert"})

    def do_POST(self):
        # Fail closed: a missing secret is a misconfiguration, not an open door.
        secret = os.environ.get("MARKITDOWN_SECRET")
        if not secret:
            return self._send(500, {"error": "misconfigured"})
        if not hmac.compare_digest(self.headers.get("x-worker-secret", ""), secret):
            return self._send(403, {"error": "forbidden"})

        length = int(self.headers.get("content-length", 0))
        data = self.rfile.read(length)
        mime = self.headers.get("x-mime-type", "application/octet-stream")
        filename = self.headers.get("x-filename") or "upload"
        ext = _EXT.get(mime) or os.path.splitext(filename)[1] or ".bin"

        try:
            with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as tmp:
                tmp.write(data)
                tmp.flush()
                result = _md.convert(tmp.name)
            return self._send(200, {"markdown": result.text_content})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"error": str(exc)})

    def _send(self, code: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
