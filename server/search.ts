import { youtubeiSearch } from "./youtubei.ts";

export interface SearchResult {
  id: string;
  title: string;
  duration: number;
  thumbnail: string | undefined;
  channel: string;
}

export async function searchYoutube(query: string, limit = 15, ytDlpPath = "yt-dlp", proxy?: string): Promise<SearchResult[]> {
  const args = [
    `ytsearch${limit}:${query}`,
    "--dump-json",
    "--no-playlist",
    "--flat-playlist",
    "--no-warnings",
    "--extractor-args", "youtube:player_client=android",
    "--socket-timeout", "15",
    "--extractor-retries", "1",
  ];
  if (proxy) {
    args.push("--proxy", proxy, "--socket-timeout", "30", "--retries", "3");
  }

  const cmd = new Deno.Command(ytDlpPath, {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout, stderr, success } = await cmd.output();

  if (!success) {
    const errText = new TextDecoder().decode(stderr);
    throw new Error(`yt-dlp a échoué : ${errText}`);
  }

  const text = new TextDecoder().decode(stdout).trim();
  if (!text) return [];

  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const data = JSON.parse(line);
        return {
          id: data.id,
          title: data.title,
          duration: data.duration ?? 0,
          thumbnail: data.thumbnails?.at(-1)?.url,
          channel: data.channel ?? data.uploader ?? "Inconnu",
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is SearchResult => r !== null);
}

export async function searchAll(query: string, limit = 15, ytDlpPath = "yt-dlp", proxy?: string): Promise<SearchResult[]> {
  // 1) Essai youtubei natif en priorité
  try {
    const native = await youtubeiSearch(query.trim(), limit);
    if (native && native.length > 0) return native;
  } catch (e) {
    console.warn("[search] youtubei natif a échoué, repli yt-dlp :", String(e).split("\n")[0]);
  }
  // 2) Repli sur yt-dlp
  return await searchYoutube(query.trim(), limit, ytDlpPath, proxy);
}

