function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\.{1,}$/, "").trim();
}

export async function downloadAndConvert(
  videoId: string,
  title: string,
  outputDir: string,
  format: "audio" | "video" = "audio",
  onProgress?: (progress: number) => void,
  ytDlpPath = "yt-dlp",
  ffmpegPath = "ffmpeg",
  proxy?: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const safeTitle = sanitizeFilename(title);
  const targetDir = `${outputDir}\\${format === "video" ? "Video" : "Audio"}`;

  try {
    await Deno.mkdir(targetDir, { recursive: true });
  } catch {}

  const finalPath = format === "audio" 
    ? `${targetDir}\\${safeTitle}.mp3`
    : `${targetDir}\\${safeTitle}.mp4`;

   try {
    if (format === "audio") {
      const tempPath = `${targetDir}\\.tmp_${videoId}.%(ext)s`;
      const audioArgs = [url, "-f", "bestaudio", "-o", tempPath, "--no-playlist", "--concurrent-fragments", "4", "--socket-timeout", "30", "--retries", "3", "--progress"];
      if (proxy) audioArgs.push("--proxy", proxy, "--socket-timeout", "120");

      const dlCmd = new Deno.Command(ytDlpPath, { args: audioArgs, stdout: "piped", stderr: "piped" });
      const dlResult = await dlCmd.output();
      if (!dlResult.success) {
        const errText = new TextDecoder().decode(dlResult.stderr).trim();
        const lines = errText.split("\n").filter(l => l).slice(-2);
        return { success: false, error: lines.join(" | ") || "Erreur de téléchargement audio" };
      }

      if (onProgress) onProgress(80);

      let downloadedFile: string | null = null;
      for await (const entry of Deno.readDir(targetDir)) {
        if (entry.isFile && entry.name.startsWith(`.tmp_${videoId}.`)) {
          downloadedFile = `${targetDir}\\${entry.name}`;
          break;
        }
      }
      if (!downloadedFile) {
        return { success: false, error: "Fichier temporaire introuvable après téléchargement." };
      }

      const convCmd = new Deno.Command(ffmpegPath, {
        args: ["-i", downloadedFile, "-vn", "-acodec", "libmp3lame", "-q:a", "2", finalPath, "-y", "-loglevel", "error"],
        stderr: "piped",
      });
      const convResult = await convCmd.output();
      await Deno.remove(downloadedFile).catch(() => {});
      if (!convResult.success) {
        const errText = new TextDecoder().decode(convResult.stderr).trim();
        return { success: false, error: errText || "Erreur de conversion MP3" };
      }
      if (onProgress) onProgress(100);
      return { success: true, path: finalPath };

    } else {
      const videoArgs = [url, "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best", "--merge-output-format", "mp4", "-o", finalPath, "--no-playlist", "--concurrent-fragments", "4", "--socket-timeout", "30", "--retries", "3", "--progress"];
      if (proxy) videoArgs.push("--proxy", proxy, "--socket-timeout", "300");

      const dlCmd = new Deno.Command(ytDlpPath, { args: videoArgs, stdout: "piped", stderr: "piped" });
      const dlResult = await dlCmd.output();
      if (!dlResult.success) {
        const errText = new TextDecoder().decode(dlResult.stderr).trim();
        const lines = errText.split("\n").filter(l => l).slice(-2);
        return { success: false, error: lines.join(" | ") || "Erreur vidéo" };
      }
      if (onProgress) onProgress(100);
      return { success: true, path: finalPath };
    }
    } catch (err) {
    return { success: false, error: String(err) };
  }
}
