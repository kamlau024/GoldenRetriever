/** Converts binary document bytes to markdown (PDF, Office, images, …). */
export interface Converter {
  convert(bytes: Uint8Array, mimeType: string, filename?: string): Promise<string>;
}

/** Calls the markitdown Python service (Task 7B) over HTTP. */
export class MarkitdownConverter implements Converter {
  constructor(
    private baseUrl: string = process.env.MARKITDOWN_URL ?? "",
    private secret: string = process.env.MARKITDOWN_SECRET ?? "dev",
  ) {}

  async convert(bytes: Uint8Array, mimeType: string, filename?: string): Promise<string> {
    if (!this.baseUrl) throw new Error("MARKITDOWN_URL is not configured");
    const res = await fetch(`${this.baseUrl}/api/index`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-mime-type": mimeType,
        "x-filename": filename ?? "",
        "x-worker-secret": this.secret,
      },
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`markitdown failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { markdown: string };
    return data.markdown;
  }
}

/** Deterministic converter for tests. */
export class MockConverter implements Converter {
  constructor(private output = "# Converted\n\nMock document body about Kyoto ryokan.") {}
  async convert(): Promise<string> { return this.output; }
}
