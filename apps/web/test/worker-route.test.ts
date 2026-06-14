import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/worker/route.js";

const post = (secret?: string) =>
  POST(new NextRequest("http://localhost/api/worker", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-worker-secret": secret } : {}) },
    body: JSON.stringify({ jobId: "j", documentId: "missing" }),
  }));

describe("POST /api/worker secret handling", () => {
  it("500 when WORKER_SECRET is not configured", async () => {
    delete process.env.WORKER_SECRET;
    expect((await post("anything")).status).toBe(500);
  });
  it("403 when the provided secret is wrong", async () => {
    process.env.WORKER_SECRET = "right-secret";
    expect((await post("wrong-secret")).status).toBe(403);
  });
  it("404 for an unknown document once the secret matches", async () => {
    process.env.WORKER_SECRET = "right-secret";
    expect((await post("right-secret")).status).toBe(404);
  });
});
