import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createScanFoldersResponse } from "./scanFolders.ts";

Deno.test("createScanFoldersResponse returns JSON by default", async () => {
  const req = new Request("http://127.0.0.1:8787/scan-folders");
  const response = createScanFoldersResponse(req, [{
    path: "C:/MediaCLI/Audio",
    name: "Audio",
    hasAudio: true,
    hasVideo: false,
    count: 2,
  }]);

  assertEquals(response.headers.get("content-type")?.includes("application/json"), true);
  const body = await response.text();
  const payload = JSON.parse(body);
  assertEquals(payload.folders[0].path, "C:/MediaCLI/Audio");
});

Deno.test("createScanFoldersResponse returns SSE when requested", async () => {
  const req = new Request("http://127.0.0.1:8787/scan-folders", {
    headers: { accept: "text/event-stream" },
  });
  const response = createScanFoldersResponse(req, [{
    path: "C:/MediaCLI/Audio",
    name: "Audio",
    hasAudio: true,
    hasVideo: false,
    count: 2,
  }]);

  assertEquals(response.headers.get("content-type")?.includes("text/event-stream"), true);
  const body = await response.text();
  assert(body.includes("event: folder"));
  assert(body.includes("event: done"));
});
