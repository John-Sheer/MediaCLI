export type ScanFolder = {
  path: string;
  name: string;
  hasAudio: boolean;
  hasVideo: boolean;
  count: number;
};

export function createScanFoldersResponse(req: Request, folders: ScanFolder[]) {
  const accept = req.headers.get("accept") || "";
  const origin = req.headers.get("origin");
  const allowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost", "https://tauri.localhost"];
  const corsOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const wantsSse = accept.includes("text/event-stream");

  if (wantsSse) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        folders.forEach((folder) => send("folder", folder));
        send("done", { folders });
        controller.close();
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...corsHeaders,
      },
    });
  }

  return new Response(JSON.stringify({ folders }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
