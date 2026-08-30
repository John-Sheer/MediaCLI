use async_stream::stream;
use axum::{
    body::Body,
    extract::{Request, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response, Sse},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_core::Stream;
use futures_util::StreamExt as _;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    convert::Infallible,
    fs,
    io::{Read as _, Seek as _, SeekFrom},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt},
    net::TcpStream,
    process::Command,
    sync::RwLock,
    time::sleep,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn new_cmd(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(program);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

fn err_chain(e: &reqwest::Error) -> String {
    let mut s = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(x) = src {
        s.push_str(" <- ");
        s.push_str(&x.to_string());
        src = x.source();
    }
    s
}

#[cfg(not(target_os = "windows"))]
fn new_cmd(program: impl AsRef<std::ffi::OsStr>) -> Command {
    Command::new(program)
}

const PORT: u16 = 8787;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const TOR_PROXY: &str = "socks5://127.0.0.1:9050";

#[cfg(target_os = "android")]
macro_rules! server_log {
    ($($arg:tt)*) => {{
        use std::io::Write;
        let msg = format!("{}\n", format!($($arg)*));
        eprint!("{}", &msg);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/storage/emulated/0/Download/mediacli_crash.txt") {
            let _ = f.write_all(msg.as_bytes());
        }
    }};
}
#[cfg(not(target_os = "android"))]
macro_rules! server_log {
    ($($arg:tt)*) => {{
        eprintln!($($arg)*);
    }};
}

const ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "tauri://localhost",
    "https://tauri.localhost",
    "http://tauri.localhost",
];

const AUDIO_EXT: &[&str] = &["mp3", "m4a", "ogg", "wav", "flac", "aac", "webm"];
const VIDEO_EXT: &[&str] = &["mp4", "mkv", "mov", "webm", "avi", "m4v"];
const SERVE_EXT: &[&str] = &["mp3", "mp4", "m4a", "webm", "ogg", "wav", "flac", "mkv", "mov", "aac"];

const EXCLUDED_DIRS: &[&str] = &[
    "appdata", "application data", "local settings", "microsoft", "windows",
    "program files", "program files (x86)", "programdata", "$recycle.bin",
    "system volume information", "msocache", "recovery", "boot", "efi",
    "node_modules", ".git", ".tauri", "cache", "temp",
    // Android : dossiers lourds/vides à ne jamais parcourir
    "android", ".android", "android data", "android/obb", "obb", "data",
    "lockscreen", "thumbnails", ".thumbnails", ".cache", ".nomedia", ".trash",
    "backup", "backups", "whatsapp", "tencent", "miui", ".xiaomi", ".coloros",
    "backups", "log", "logs", "crashpad", "metainfo", "grpc",
];

const WEB_CLIENT_NAME: &str = "WEB";
const WEB_CLIENT_VERSION: &str = "2.20240610.00.00";
const ANDROID_CLIENT_NAME: &str = "ANDROID";
const ANDROID_CLIENT_VERSION: &str = "20.12.34";
const ANDROID_CLIENT_UA: &str = "com.google.android.youtube/20.12.34 (Linux; U; Android 12) gzip";
const TV_EMBEDDED_CLIENT_NAME: &str = "TVHTML5_SIMPLY_EMBEDDED_PLAYER";
const TV_EMBEDDED_CLIENT_VERSION: &str = "2.0";
const IOS_CLIENT_NAME: &str = "IOS";
const IOS_CLIENT_VERSION: &str = "21.10.2";
const IOS_DEVICE_MODEL: &str = "iPhone14,3";

#[derive(Clone)]
struct ServerState {
    output_dir: PathBuf,
    resource_dir: Option<PathBuf>,
    search_cache: Arc<RwLock<HashMap<String, (Instant, serde_json::Value)>>>,
    stream_cache: Arc<RwLock<HashMap<String, (Instant, String)>>>,
    progress_map: Arc<RwLock<HashMap<String, f64>>>,
    paused_set: Arc<RwLock<HashSet<String>>>,
    child_pids: Arc<RwLock<HashMap<String, i32>>>,
    tor_enabled: Arc<RwLock<bool>>,
    innertube_key: Option<String>,
    player_script_cache: Arc<RwLock<Option<(Instant, String, String)>>>,
    n_transform_cache: Arc<RwLock<Option<Vec<NTransformOp>>>>,
    sig_ops_cache: Arc<RwLock<Option<Vec<NTransformOp>>>>,
    client: reqwest::Client,
}

#[derive(Clone, Debug)]
enum NTransformOp {
    Reverse,
    Shift,
    Splice { start: usize, count: usize },
    Swap { pos: usize },
}

#[derive(Deserialize)]
struct SearchParams {
    q: Option<String>,
}

#[derive(Deserialize)]
struct LocalSearchParams {
    q: Option<String>,
}

#[derive(Deserialize)]
struct IdParams {
    id: Option<String>,
}

#[derive(Deserialize)]
struct DelayParams {
    id: Option<String>,
    delay: Option<u64>,
}

#[derive(Deserialize)]
struct ThumbParams {
    url: Option<String>,
}

#[derive(Deserialize)]
struct ListFolderParams {
    path: Option<String>,
    kind: Option<String>,
}

#[derive(Deserialize)]
struct LocalParams {
    path: Option<String>,
}

#[derive(Deserialize)]
struct DownloadBody {
    #[serde(alias = "videoId")]
    video_id: String,
    title: String,
    format: Option<String>,
}

#[derive(Deserialize)]
struct OpenFolderBody {
    #[serde(alias = "type")]
    folder: Option<String>,
}

#[derive(Deserialize)]
struct ProxyBody {
    action: Option<String>,
}

#[derive(Deserialize)]
struct PauseBody {
    #[serde(alias = "id")]
    download_id: Option<String>,
}

#[derive(Serialize)]
struct SearchResult {
    id: String,
    title: String,
    duration: u64,
    thumbnail: Option<String>,
    channel: String,
}

#[derive(Serialize)]
struct StreamInfo {
    url: String,
    title: String,
    duration: u64,
    channel: String,
    thumbnail: Option<String>,
}

#[derive(Serialize)]
struct FolderInfo {
    path: String,
    name: String,
    has_audio: bool,
    has_video: bool,
    count: usize,
}

#[derive(Serialize)]
struct FileInfo {
    name: String,
    path: String,
    size_label: String,
}

// ─── CORS ───

fn cors_headers_map(origin: Option<&str>) -> HeaderMap {
    let o = origin
        .filter(|o| ALLOWED_ORIGINS.contains(o))
        .unwrap_or(ALLOWED_ORIGINS[0]);
    let mut h = HeaderMap::new();
    h.insert("access-control-allow-origin", o.parse().unwrap());
    h.insert("access-control-allow-methods", "GET, POST, OPTIONS".parse().unwrap());
    h.insert("access-control-allow-headers", "Content-Type".parse().unwrap());
    h
}

fn json_response(data: impl Serialize, status: StatusCode, origin: Option<&str>) -> Response {
    let mut headers = cors_headers_map(origin);
    headers.insert("content-type", "application/json".parse().unwrap());
    let body = serde_json::to_string(&data).unwrap_or_default();
    (status, headers, body).into_response()
}

async fn handle_options(headers: HeaderMap) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let mut h = cors_headers_map(origin);
    h.insert("access-control-max-age", "86400".parse().unwrap());
    (StatusCode::OK, h, "").into_response()
}

// Diagnostique l'état réseau de l'app : lookup système, DNS UDP direct 8.8.8.8,
// et connect TCP par IP — pour distinguer DNS vs route bloqués.
async fn handle_netprobe() -> Response {
    use serde_json::json;

    let sys = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::lookup_host(("www.youtube.com", 80)),
    )
    .await;
    let sys_r = match sys {
        Ok(Ok(it)) => format!("{:?}", it.map(|s| s.to_string()).collect::<Vec<_>>()),
        Ok(Err(e)) => format!("ERR {}", e),
        Err(_) => "TIMEOUT".into(),
    };

    let mut payload: Vec<u8> = vec![0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    for lb in "www.youtube.com".split('.') {
        payload.push(lb.len() as u8);
        payload.extend_from_slice(lb.as_bytes());
    }
    payload.push(0);
    payload.extend_from_slice(&[0u8, 1, 0, 1]);

    let dns = tokio::time::timeout(Duration::from_secs(5), async {
        let sock = tokio::net::UdpSocket::bind("0.0.0.0:0").await?;
        sock.connect("8.8.8.8:53").await?;
        sock.send(&payload).await?;
        let mut buf = [0u8; 512];
        let n = sock.recv(&mut buf).await?;
        Ok::<_, std::io::Error>(buf[..n].to_vec())
    })
    .await;
    let dns_r = match dns {
        Ok(Ok(ans)) if ans.len() > 12 && (ans[2] & 0x80) != 0 => {
            let mut ip = String::new();
            let mut p = 12usize;
            while p < ans.len() {
                let b = ans[p];
                if b == 0 {
                    p += 1;
                    break;
                }
                p += 1 + b as usize;
            }
            p += 4;
            while p + 11 <= ans.len() {
                let f = ans[p];
                if (f & 0xc0) == 0xc0 {
                    p += 2;
                } else {
                    let l = f as usize;
                    p += 1 + l;
                }
                if p + 10 <= ans.len() {
                    let typ = ((ans[p] as u16) << 8) | ans[p + 1] as u16;
                    let rdlen = ((ans[p + 8] as u16) << 8) | ans[p + 9] as u16;
                    if p + 10 + rdlen as usize <= ans.len() && typ == 1 && rdlen as usize == 4 {
                        let v = &ans[p + 10..p + 14];
                        ip = format!("{}.{}.{}.{}", v[0], v[1], v[2], v[3]);
                    }
                    p += 10 + rdlen as usize;
                } else {
                    break;
                }
            }
            format!("DNS-OK {}", ip)
        }
        Ok(_) => "DNS-REP-MALFORMED".into(),
        Err(_) => "DNS-IO-ERR".into(),
    };

    let tcp = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(("8.8.8.8", 443))).await;
    let tcp_r = match tcp {
        Ok(Ok(_)) => "TCP-443-OK".into(),
        Ok(Err(e)) => format!("TCP-ERR {}", e),
        Err(_) => "TCP-TIMEOUT".into(),
    };

    let out = json!({ "sys_lookup": sys_r, "dns_udp_8833": dns_r, "tcp_ip_443": tcp_r });
    server_log!("[netprobe] {}", out);
    Json(out).into_response()
}

/// Middleware de diagnostic : loggue l'entrée et la sortie de chaque requête
/// HTTP dans le fichier crash pour voir si les requêtes atteignent axum.
async fn log_requests(req: Request, next: Next) -> Response {
    let m = req.method().clone();
    let u = req.uri().path().to_string();
    LAST_HTTP.store(
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        std::sync::atomic::Ordering::Relaxed,
    );
    ACTIVE_REQUESTS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    crashlog(&format!("[req+] {} {}", m, u));
    let t0 = Instant::now();
    let resp = next.run(req).await;
    ACTIVE_REQUESTS.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    crashlog(&format!("[req-] {} {} {}ms", m, u, t0.elapsed().as_millis()));
    resp
}

// ─── SECURITY ───

fn is_valid_video_id(id: &str) -> bool {
    id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_allowed_thumb_url(url: &str) -> bool {
    url::Url::parse(url)
        .map(|u| {
            matches!(
                u.host_str().unwrap_or(""),
                "img.youtube.com" | "i.ytimg.com" | "i9.ytimg.com"
            ) && u.scheme() == "https"
        })
        .unwrap_or(false)
}

fn is_path_allowed(requested: &Path, output_dir: &Path) -> bool {
    let rstr = requested.to_string_lossy().replace('\\', "/");
    #[cfg(target_os = "android")]
    {
        let prefixes: &[&str] = &[
            &output_dir.to_string_lossy().replace('\\', "/"),
            "/storage/emulated/0/Music",
            "/storage/emulated/0/Download",
            "/storage/emulated/0/Movies",
            "/storage/emulated/0/DCIM",
            "/storage/emulated/0/Pictures",
            "/sdcard/Music",
            "/sdcard/Download",
            "/data/user",
        ];
        for p in prefixes {
            if rstr.starts_with(p) {
                return true;
            }
        }
        return false;
    }
    #[cfg(not(target_os = "android"))]
    {
        let canonical_req = fs::canonicalize(requested).ok();
        let canonical_out = fs::canonicalize(output_dir).ok();
        if let (Some(ref r), Some(ref o)) = (&canonical_req, &canonical_out) {
            if r.starts_with(o) {
                return true;
            }
        }
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let home_path = PathBuf::from(&home);
            if let Some(ref r) = canonical_req {
                if let Ok(canonical_home) = fs::canonicalize(&home_path) {
                    if r.starts_with(&canonical_home) {
                        return true;
                    }
                }
            }
        }
        false
    }
}

fn mime_for_ext(ext: &str) -> &str {
    match ext {
        "mp3" => "audio/mpeg",
        "mp4" | "m4a" | "mov" => "video/mp4",
        "webm" | "mkv" => "video/webm",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        _ => "application/octet-stream",
    }
}

fn format_size(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1.0 {
        format!("{:.1} Mo", mb)
    } else {
        format!("{} Ko", bytes / 1024)
    }
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    cleaned.trim_end_matches('.').trim().to_string()
}

// ─── INNERTUBE ───

async fn innertube_request(
    client: &reqwest::Client,
    key: &str,
    endpoint: &str,
    extra_body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://www.youtube.com/youtubei/v1/{}?key={}",
        endpoint, key
    );
    let mut body = serde_json::json!({
        "context": {
            "client": {
                "clientName": WEB_CLIENT_NAME,
                "clientVersion": WEB_CLIENT_VERSION
            }
        }
    });
    if let (Some(obj), Some(extra)) = (body.as_object_mut(), extra_body.as_object()) {
        for (k, v) in extra {
            obj.insert(k.clone(), v.clone());
        }
    }
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .header("X-YouTube-Client-Name", "1")
        .header("X-YouTube-Client-Version", WEB_CLIENT_VERSION)
        .header("Origin", "https://www.youtube.com")
        .body(body.to_string())
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("InnerTube request failed: {}", err_chain(&e)))?;
    if !resp.status().is_success() {
        return Err(format!("InnerTube {} HTTP {}", endpoint, resp.status()));
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("InnerTube parse error: {}", e))
}

async fn innertube_android_request(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    extra_body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://www.youtube.com/youtubei/v1/{}?key={}&prettyPrint=false",
        endpoint, api_key
    );
    let mut body = serde_json::json!({
        "context": {
            "client": {
                "clientName": ANDROID_CLIENT_NAME,
                "clientVersion": ANDROID_CLIENT_VERSION,
                "androidSdkVersion": 31,
                "hl": "en",
                "gl": "US",
                "osName": "Android",
                "osVersion": "12",
                "userAgent": ANDROID_CLIENT_UA
            }
        },
        "contentCheckOk": true,
        "racyCheckOk": true
    });
    if let (Some(obj), Some(extra)) = (body.as_object_mut(), extra_body.as_object()) {
        for (k, v) in extra {
            obj.insert(k.clone(), v.clone());
        }
    }
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", ANDROID_CLIENT_UA)
        .header("X-YouTube-Client-Name", "3")
        .header("X-YouTube-Client-Version", ANDROID_CLIENT_VERSION)
        .body(body.to_string())
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("InnerTube Android request failed: {}", err_chain(&e)))?;
    if !resp.status().is_success() {
        let status_code = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("InnerTube Android {} HTTP {}: {}", endpoint, status_code, &body_text[..body_text.len().min(200)]));
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("InnerTube Android parse error: {}", e))
}

async fn innertube_client_request(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    client_name: &str,
    client_version: &str,
    client_number: &str,
    user_agent: &str,
    extra_body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://www.youtube.com/youtubei/v1/{}?key={}&prettyPrint=false",
        endpoint, api_key
    );
    let mut body = serde_json::json!({
        "context": {
            "client": {
                "clientName": client_name,
                "clientVersion": client_version,
                "hl": "en",
                "gl": "US"
            }
        },
        "contentCheckOk": true,
        "racyCheckOk": true
    });
    if let (Some(obj), Some(extra)) = (body.as_object_mut(), extra_body.as_object()) {
        for (k, v) in extra {
            obj.insert(k.clone(), v.clone());
        }
    }
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", user_agent)
        .header("X-YouTube-Client-Name", client_number)
        .header("X-YouTube-Client-Version", client_version)
        .body(body.to_string())
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("InnerTube {} request failed: {}", client_name, err_chain(&e)))?;
    if !resp.status().is_success() {
        let status_code = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("InnerTube {} {} HTTP {}: {}", client_name, endpoint, status_code, &body_text[..body_text.len().min(200)]));
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("InnerTube {} parse error: {}", client_name, e))
}

fn parse_duration(text: &str) -> u64 {
    let parts: Vec<u64> = text.split(':').filter_map(|p| p.parse().ok()).collect();
    match parts.len() {
        3 => parts[0] * 3600 + parts[1] * 60 + parts[2],
        2 => parts[0] * 60 + parts[1],
        1 => parts[0],
        _ => 0,
    }
}

async fn youtubei_search(
    client: &reqwest::Client,
    key: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    let data = innertube_request(client, key, "search", serde_json::json!({ "query": query })).await?;
    Ok(parse_search_response(&data, limit))
}

// Recherche via le client ANDROID d'InnerTube : c'est le même chemin qui
// fonctionne pour le streaming (le client WEB est de plus en plus bloqué par
// YouTube). Utilisé en secours quand la recherche WEB échoue.
async fn youtubei_search_android(
    client: &reqwest::Client,
    key: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    let data = innertube_android_request(client, "search", key, serde_json::json!({ "query": query })).await?;
    Ok(parse_search_response(&data, limit))
}

fn parse_search_response(data: &serde_json::Value, limit: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    // Deux structures possibles selon le client InnerTube :
    //  - WEB : /contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents
    //  - ANDROID (récent) : /contents/sectionListRenderer/contents
    let sections = data
        .pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_else(|| {
            data.pointer("/contents/sectionListRenderer/contents")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
        });
    for sec in &sections {
        let items = sec
            .pointer("/itemSectionRenderer/contents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for item in &items {
            if results.len() >= limit {
                break;
            }
            // Les clients récents (ANDROID) renvoient compactVideoRenderer /
            // gridVideoRenderer au lieu de videoRenderer : on accepte les trois.
            let v = item
                .get("videoRenderer")
                .or_else(|| item.get("compactVideoRenderer"))
                .or_else(|| item.get("gridVideoRenderer"));
            let v = match v {
                Some(v) => v,
                None => continue,
            };
            let id = v
                .get("videoId")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            if id.is_empty() || !seen_ids.insert(id.clone()) {
                continue;
            }
            let title = extract_text(v, "/title/runs")
                .or_else(|| v.pointer("/title/simpleText").and_then(|t| t.as_str()).map(String::from))
                .unwrap_or_else(|| "Sans titre".into());
            let dur_text = v
                .pointer("/lengthText/simpleText")
                .and_then(|t| t.as_str())
                .map(String::from)
                .or_else(|| extract_text(v, "/lengthText/runs"))
                .unwrap_or_else(|| "0:00".into());
            let thumbnail = v
                .pointer("/thumbnail/thumbnails")
                .and_then(|t| t.as_array())
                .and_then(|arr| arr.last())
                .and_then(|t| t.get("url").and_then(|u| u.as_str()))
                .map(String::from);
            let channel = extract_text(v, "/ownerText/runs")
                .or_else(|| extract_text(v, "/longBylineText/runs"))
                .or_else(|| extract_text(v, "/shortBylineText/runs"))
                .unwrap_or_else(|| "Inconnu".into());
            results.push(SearchResult {
                id,
                title,
                duration: parse_duration(&dur_text),
                thumbnail,
                channel,
            });
        }
        if results.len() >= limit {
            break;
        }
    }
    results
}

fn extract_text(v: &serde_json::Value, path: &str) -> Option<String> {
    v.pointer(path)
        .and_then(|runs| runs.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
}

// ─── SIGNATURE DECRYPTION ───

fn apply_splice(s: &mut Vec<char>, start: usize, count: usize) {
    if start < s.len() {
        s.drain(start..std::cmp::min(start + count, s.len()));
    }
}

fn apply_swap(s: &mut Vec<char>, pos: usize) {
    let len = s.len();
    if len == 0 { return; }
    let idx = pos % len;
    if idx != 0 && idx < len {
        s.swap(0, idx);
    }
}

async fn fetch_player_script(
    client: &reqwest::Client,
    cache: &Arc<RwLock<Option<(Instant, String, String)>>>,
) -> Result<(String, String), String> {
    {
        let c = cache.read().await;
        if let Some((ts, url, text)) = c.as_ref() {
            if ts.elapsed() < Duration::from_secs(1800) {
                return Ok((url.clone(), text.clone()));
            }
        }
    }
    let resp = client
        .get("https://www.youtube.com/watch?v=LLRAN_2gl0Q")
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch YouTube page: {}", e))?;
    let html = resp.text().await.map_err(|e| e.to_string())?;
    let re = Regex::new(r#"(?:"|%)("([^"'\s]*?/?(?:player[^"'\s]*?\.js))"|(?:src|href)="(/s/player[^"]+)"|"jsUrl":"([^"]+)")"#).unwrap();
    let js_url = if let Some(m) = re.captures(&html) {
        let url = m.get(1).or_else(|| m.get(2)).or_else(|| m.get(3)).map(|x| x.as_str()).unwrap_or("/s/player/8a56d1b0/player_ias.vflset/en_US/base.js");
        if url.starts_with('/') {
            format!("https://www.youtube.com{}", url)
        } else {
            url.to_string()
        }
    } else {
        "https://www.youtube.com/s/player/8a56d1b0/player_ias.vflset/en_US/base.js".into()
    };
    let js_resp = client
        .get(&js_url)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch player JS: {}", e))?;
    let js_text = js_resp.text().await.map_err(|e| e.to_string())?;
    let mut c = cache.write().await;
    *c = Some((Instant::now(), js_url.clone(), js_text.clone()));
    Ok((js_url, js_text))
}

fn parse_n_transform(js: &str) -> Vec<NTransformOp> {
    let mut ops = Vec::new();
    let fn_re = Regex::new(
        r#"\b([a-zA-Z0-9_$]{2,})\s*=\s*function\(\s*a\s*\)\s*\{[\s\S]*?\.slice\(0\)[\s\S]*?\}"#
    ).unwrap();
    let fn_name = if let Some(m) = fn_re.find(js) {
        let name_re = Regex::new(r#"\b([a-zA-Z0-9_$]{2,})\s*=\s*function"#).unwrap();
        name_re.captures(m.as_str()).and_then(|c| c.get(1)).map(|x| x.as_str().to_string())
    } else {
        None
    };
    if fn_name.is_none() {
        return ops;
    }
    let fn_name = fn_name.unwrap();
    let body_re = Regex::new(&format!(
        r#"{} = function"#,
        regex::escape(&fn_name)
    )).unwrap();
    if let Some(m) = body_re.find(js) {
        let start = m.start();
        let body = &js[start..std::cmp::min(start + 800, js.len())];
        let splice_re = Regex::new(r#"\.splice\((\d+),(\d+)\)"#).unwrap();
        for sm in splice_re.captures_iter(body) {
            if let (Some(s), Some(c)) = (sm.get(1), sm.get(2)) {
                ops.push(NTransformOp::Splice {
                    start: s.as_str().parse().unwrap_or(0),
                    count: c.as_str().parse().unwrap_or(0),
                });
            }
        }
        if body.contains(".reverse()") {
            ops.push(NTransformOp::Reverse);
        }
        if body.contains(".shift()") || body.contains("splice(0,1)") {
            ops.push(NTransformOp::Shift);
        }
        let swap_re = Regex::new(r#"\w=\w\[\w%\d+\];\w\[(\d+)\]=\w\[\w\];\w\[\w\]=\w"#).unwrap();
        if let Some(sm) = swap_re.captures(body) {
            if let Some(p) = sm.get(1) {
                ops.push(NTransformOp::Swap {
                    pos: p.as_str().parse().unwrap_or(0),
                });
            }
        }
    }
    ops
}

async fn decipher_n(
    client: &reqwest::Client,
    n: &str,
    player_cache: &Arc<RwLock<Option<(Instant, String, String)>>>,
    ops_cache: &Arc<RwLock<Option<Vec<NTransformOp>>>>,
) -> String {
    {
        let c = ops_cache.read().await;
        if let Some(ops) = c.as_ref() {
            return apply_n_ops(n, ops);
        }
    }
    let ops = match fetch_player_script(client, player_cache).await {
        Ok((_, js)) => {
            let parsed = parse_n_transform(&js);
            if parsed.is_empty() {
                return n.to_string();
            }
            parsed
        }
        Err(_) => return n.to_string(),
    };
    let result = apply_n_ops(n, &ops);
    *ops_cache.write().await = Some(ops);
    result
}

fn parse_signature_ops(js: &str) -> Vec<NTransformOp> {
    let mut ops = Vec::new();
    let fn_re = Regex::new(
        r#"var\s+([a-zA-Z0-9_$]{2,})\s*=\s*function\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)"#
    ).unwrap();
    let fn_name = fn_re.captures(js).and_then(|c| c.get(1)).map(|x| x.as_str().to_string());
    let fn_name = match fn_name {
        Some(n) => n,
        None => return ops,
    };
    let body_re = Regex::new(&format!(
        r#"{} = function"#,
        regex::escape(&fn_name)
    )).unwrap();
    if let Some(m) = body_re.find(js) {
        let start = m.start();
        let body = &js[start..std::cmp::min(start + 1000, js.len())];
        let end_re = Regex::new(r#"return\s+\w+\.join\(\s*""\s*\)"#).unwrap();
        let body = if let Some(em) = end_re.find(body) {
            &body[..em.end()]
        } else {
            body
        };
        let splice_re = Regex::new(r#"\.splice\((\d+),(\d+)\)"#).unwrap();
        for sm in splice_re.captures_iter(body) {
            if let (Some(s), Some(c)) = (sm.get(1), sm.get(2)) {
                ops.push(NTransformOp::Splice {
                    start: s.as_str().parse().unwrap_or(0),
                    count: c.as_str().parse().unwrap_or(0),
                });
            }
        }
        let reverse_re = Regex::new(r#"\.reverse\(\)"#).unwrap();
        for _ in reverse_re.find_iter(body) {
            ops.push(NTransformOp::Reverse);
        }
        let swap_re = Regex::new(r#"(\w)\[(\d+)\]=(\w)\[(\w+)%(\d+)\];\4\[\5\]=\2;\2=\3"#).unwrap();
        if let Some(sm) = swap_re.captures(body) {
            if let Some(p) = sm.get(5) {
                ops.push(NTransformOp::Swap {
                    pos: p.as_str().parse().unwrap_or(0),
                });
            }
        }
        if ops.is_empty() {
            let alt_swap_re = Regex::new(r#"c=\w+\[0\];\w+\[0\]=\w+\[%(\d+)\];\w+\[%\1\]=c"#).unwrap();
            if let Some(sm) = alt_swap_re.captures(body) {
                if let Some(p) = sm.get(1) {
                    ops.push(NTransformOp::Swap {
                        pos: p.as_str().parse().unwrap_or(0),
                    });
                }
            }
        }
    }
    ops
}

async fn decipher_signature(
    client: &reqwest::Client,
    s: &str,
    player_cache: &Arc<RwLock<Option<(Instant, String, String)>>>,
    sig_ops_cache: &Arc<RwLock<Option<Vec<NTransformOp>>>>,
) -> String {
    {
        let c = sig_ops_cache.read().await;
        if let Some(ops) = c.as_ref() {
            return apply_n_ops(s, ops);
        }
    }
    let ops = match fetch_player_script(client, player_cache).await {
        Ok((_, js)) => {
            let parsed = parse_signature_ops(&js);
            if parsed.is_empty() {
                server_log!("[sig] WARNING: no signature ops found in player JS");
                return s.to_string();
            }
            server_log!("[sig] parsed {} signature ops", parsed.len());
            parsed
        }
        Err(e) => {
            server_log!("[sig] failed to fetch player script: {}", e);
            return s.to_string();
        }
    };
    let result = apply_n_ops(s, &ops);
    *sig_ops_cache.write().await = Some(ops);
    result
}

fn apply_n_ops(n: &str, ops: &[NTransformOp]) -> String {
    let mut chars: Vec<char> = n.chars().collect();
    for op in ops {
        match op {
            NTransformOp::Reverse => chars.reverse(),
            NTransformOp::Shift => {
                if !chars.is_empty() {
                    chars.remove(0);
                }
            }
            NTransformOp::Splice { start, count } => {
                apply_splice(&mut chars, *start, *count);
            }
            NTransformOp::Swap { pos } => {
                apply_swap(&mut chars, *pos);
            }
        }
    }
    chars.into_iter().collect()
}

async fn pick_stream_url_from_data(
    data: &serde_json::Value,
    client: &reqwest::Client,
    state: &ServerState,
) -> Option<String> {
    let streaming = data.get("streamingData")?;
    let mut formats: Vec<serde_json::Value> = Vec::new();
    if let Some(f) = streaming.get("formats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    if let Some(f) = streaming.get("adaptiveFormats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    server_log!("[pick] total formats: {}, has url: {}, has signatureCipher: {}, has cipher: {}",
        formats.len(),
        formats.iter().filter(|f| f.get("url").is_some()).count(),
        formats.iter().filter(|f| f.get("signatureCipher").is_some()).count(),
        formats.iter().filter(|f| f.get("cipher").is_some()).count(),
    );
    if let Some(first) = formats.first() {
        let keys: Vec<String> = first.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
        server_log!("[pick] first format keys: {:?}", keys);
        if let Some(mt) = first.get("mimeType").and_then(|v| v.as_str()) {
            server_log!("[pick] first format mimeType: {}", mt);
        }
    }
    let has_audio = |f: &serde_json::Value| -> bool {
        f.get("audioQuality").is_some()
            || f.get("audioCodec").is_some()
            || f.get("mimeType")
                .and_then(|m| m.as_str())
                .map(|m| m.contains("audio"))
                .unwrap_or(false)
    };
    let pick = |pred: &dyn Fn(&serde_json::Value) -> bool| -> Option<serde_json::Value> {
        let mut filtered: Vec<_> = formats
            .iter()
            .filter(|f| f.get("url").is_some() || f.get("signatureCipher").is_some() || f.get("cipher").is_some())
            .filter(|f| pred(f))
            .cloned()
            .collect();
        filtered.sort_by(|a, b| {
            let ha = a.get("height").and_then(|h| h.as_u64()).unwrap_or(0);
            let hb = b.get("height").and_then(|h| h.as_u64()).unwrap_or(0);
            let ba = a.get("bitrate").and_then(|h| h.as_u64()).unwrap_or(0);
            let bb = b.get("bitrate").and_then(|h| h.as_u64()).unwrap_or(0);
            hb.cmp(&ha).then(bb.cmp(&ba))
        });
        filtered.into_iter().next()
    };
    let fmt = pick(&|f| {
        f.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("video/mp4")).unwrap_or(false)
            && f.get("height").and_then(|h| h.as_u64()).unwrap_or(0) <= 720
            && has_audio(f)
    })
    .or_else(|| pick(&|f| {
        f.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("video/mp4")).unwrap_or(false)
            && has_audio(f)
    }))
    .or_else(|| pick(&|f| has_audio(f)))
    .or_else(|| pick(&|_| true))?;

    let mut url: Option<String> = fmt.get("url").and_then(|u| u.as_str()).map(String::from);
    if url.is_none() {
        let cipher_str = fmt.get("signatureCipher")
            .or_else(|| fmt.get("cipher"))
            .and_then(|c| c.as_str());
        if let Some(cipher) = cipher_str {
            let params: HashMap<_, _> = url::form_urlencoded::parse(cipher.as_bytes()).collect();
            if let Some(real_url) = params.get("url") {
                let mut parsed = url::Url::parse(real_url).ok()?;
                if let Some(s) = params.get("s") {
                    let decoded_sig = decipher_signature(client, s, &state.player_script_cache, &state.sig_ops_cache).await;
                    let sp = params.get("sp").map(|x| &**x).unwrap_or("sig");
                    parsed.set_query(Some(&format!(
                        "{}&{}={}",
                        parsed.query().unwrap_or(""),
                        sp,
                        decoded_sig
                    )));
                    server_log!("[pick] deciphered signature, sp={}", sp);
                }
                if let Some(n) = params.get("n") {
                    let decoded = decipher_n(client, n, &state.player_script_cache, &state.n_transform_cache).await;
                    parsed.set_query(Some(&format!(
                        "{}&n={}",
                        parsed.query().unwrap_or(""),
                        decoded
                    )));
                }
                url = Some(parsed.to_string());
            }
        }
    }
    url
}

async fn resolve_stream_url(state: &ServerState, id: &str) -> Option<String> {
    let client = &state.client;
    let tor = *state.tor_enabled.read().await;
    let key = state.innertube_key.as_deref().unwrap_or("AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");

    if !tor {
        match youtubei_stream_android_vr(client, id, key).await {
            Ok(info) if !info.url.is_empty() => {
                server_log!("[server] resolved URL from Android VR for {}", id);
                return Some(info.url);
            }
            Ok(_) => { server_log!("[server] Android VR returned empty url for {}", id); }
            Err(e) => { server_log!("[server] Android VR error for {}: {}", id, e); }
        }
    }

    if !tor {
        match youtubei_stream_android(client, id, key).await {
            Ok(info) if !info.url.is_empty() => {
                server_log!("[server] resolved URL from Android InnerTube for {}", id);
                return Some(info.url);
            }
            Ok(_) => { server_log!("[server] Android InnerTube returned empty url for {}", id); }
            Err(e) => { server_log!("[server] Android InnerTube error for {}: {}", id, e); }
        }
    }

    if !tor {
        match youtubei_stream_ios(client, id, key).await {
            Ok(info) if !info.url.is_empty() => {
                server_log!("[server] resolved URL from iOS InnerTube for {}", id);
                return Some(info.url);
            }
            Ok(_) => { server_log!("[server] iOS InnerTube returned empty url for {}", id); }
            Err(e) => { server_log!("[server] iOS InnerTube error for {}: {}", id, e); }
        }
    }

    if !tor {
        match youtubei_stream_tv(client, id, key).await {
            Ok(info) if !info.url.is_empty() => {
                server_log!("[server] resolved URL from TV for {}", id);
                return Some(info.url);
            }
            Ok(_) => { server_log!("[server] TV returned empty url for {}", id); }
            Err(e) => { server_log!("[server] TV error for {}: {}", id, e); }
        }
    }

    if !tor {
        match youtubei_stream_web_embedded(client, id, key).await {
            Ok(info) if !info.url.is_empty() => {
                server_log!("[server] resolved URL from Web Embedded for {}", id);
                return Some(info.url);
            }
            Ok(_) => { server_log!("[server] Web Embedded returned empty url for {}", id); }
            Err(e) => { server_log!("[server] Web Embedded error for {}: {}", id, e); }
        }
    }

    if !tor {
        if let Ok(data) = watch_page_stream(client, id).await {
            server_log!("[server] watch_page_stream OK for {}", id);
            if let Some(url) = pick_stream_url_from_data(&data, client, state).await {
                server_log!("[server] resolved URL from watch page for {}", id);
                return Some(url);
            }
            server_log!("[server] no URL from watch page streamingData for {}", id);
        } else {
            server_log!("[server] watch_page_stream failed for {}", id);
        }
    }

    if !tor {
        match youtubei_stream(client, key, id, &state.player_script_cache, &state.n_transform_cache).await {
            Ok(info) if !info.url.is_empty() => {
                server_log!("[server] resolved URL from WEB InnerTube for {}", id);
                return Some(info.url);
            }
            Ok(_) => { server_log!("[server] WEB InnerTube returned empty url for {}", id); }
            Err(e) => { server_log!("[server] WEB InnerTube error for {}: {}", id, e); }
        }
    }

    let timeout = if tor { Duration::from_secs(60) } else { Duration::from_secs(20) };
    if let Some(url) = try_stream_ytdlp(client, state, id, "18", timeout).await {
        return Some(url);
    }
    let t = if tor { Duration::from_secs(80) } else { Duration::from_secs(25) };
    if let Some(url) = try_stream_ytdlp(client, state, id, "22", t).await {
        return Some(url);
    }
    let t = if tor { Duration::from_secs(120) } else { Duration::from_secs(35) };
    if let Some(url) = try_stream_ytdlp(client, state, id, "best[height<=720][ext=mp4]", t).await {
        return Some(url);
    }

    None
}

// ─── RÉSOLUTION DE FLUX POUR TÉLÉCHARGEMENT SANS YT-DLP ───

fn ext_from_mime(mt: &str) -> String {
    if mt.contains("webm") {
        "webm".to_string()
    } else if mt.contains("video") {
        "mp4".to_string()
    } else {
        "m4a".to_string()
    }
}

async fn decipher_format_url(
    fmt: &serde_json::Value,
    client: &reqwest::Client,
    state: &ServerState,
) -> Option<String> {
    if let Some(u) = fmt.get("url").and_then(|u| u.as_str()) {
        return Some(u.to_string());
    }
    let cipher_str = fmt
        .get("signatureCipher")
        .or_else(|| fmt.get("cipher"))
        .and_then(|c| c.as_str())?;
    let params: HashMap<_, _> = url::form_urlencoded::parse(cipher_str.as_bytes()).collect();
    let real_url = params.get("url")?;
    let mut parsed = url::Url::parse(real_url).ok()?;
    if let Some(s) = params.get("s") {
        let decoded_sig = decipher_signature(client, s, &state.player_script_cache, &state.sig_ops_cache).await;
        let sp = params.get("sp").map(|x| &**x).unwrap_or("sig");
        parsed.set_query(Some(&format!(
            "{}&{}={}",
            parsed.query().unwrap_or(""),
            sp,
            decoded_sig
        )));
    }
    if let Some(n) = params.get("n") {
        let decoded = decipher_n(client, n, &state.player_script_cache, &state.n_transform_cache).await;
        parsed.set_query(Some(&format!(
            "{}&n={}",
            parsed.query().unwrap_or(""),
            decoded
        )));
    }
    Some(parsed.to_string())
}

async fn pick_audio_format(
    data: &serde_json::Value,
    client: &reqwest::Client,
    state: &ServerState,
) -> Option<(String, String)> {
    let streaming = data.get("streamingData")?;
    let mut formats: Vec<serde_json::Value> = Vec::new();
    if let Some(f) = streaming.get("formats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    if let Some(f) = streaming.get("adaptiveFormats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    let mut candidates: Vec<_> = formats
        .iter()
        .filter(|f| f.get("url").is_some() || f.get("signatureCipher").is_some() || f.get("cipher").is_some())
        .filter(|f| {
            f.get("mimeType")
                .and_then(|m| m.as_str())
                .map(|m| m.trim_start().starts_with("audio/"))
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|a, b| {
        let am4a = a.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("mp4")).unwrap_or(false);
        let bm4a = b.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("mp4")).unwrap_or(false);
        bm4a.cmp(&am4a).then(
            b.get("bitrate").and_then(|x| x.as_u64()).unwrap_or(0)
                .cmp(&a.get("bitrate").and_then(|x| x.as_u64()).unwrap_or(0)),
        )
    });
    let fmt = &candidates[0];
    let mt = fmt.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
    let itag = fmt.get("itag").and_then(|x| x.as_u64()).unwrap_or(0);
    let bitrate = fmt.get("bitrate").and_then(|x| x.as_u64()).unwrap_or(0);
    let has_url = fmt.get("url").is_some();
    let has_sc = fmt.get("signatureCipher").is_some() || fmt.get("cipher").is_some();
    server_log!("[audio] picked itag={} mime={} bitrate={} has_url={} has_sc={} candidates={}", itag, mt, bitrate, has_url, has_sc, candidates.len());
    let url = decipher_format_url(fmt, client, state).await?;
    server_log!("[audio] URL (trunc 160): {}", url.chars().take(160).collect::<String>());
    Some((url, ext_from_mime(mt)))
}

async fn pick_lowest_progressive(
    data: &serde_json::Value,
    client: &reqwest::Client,
    state: &ServerState,
) -> Option<(String, String, u64)> {
    let streaming = data.get("streamingData")?;
    let formats: Vec<&serde_json::Value> = streaming
        .get("formats")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().collect::<Vec<_>>())
        .unwrap_or_default();
    let mut candidates: Vec<serde_json::Value> = formats
        .into_iter()
        .filter(|f| f.get("url").is_some() || f.get("signatureCipher").is_some() || f.get("cipher").is_some())
        .cloned()
        .collect();
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|a, b| {
        a.get("itag").and_then(|x| x.as_u64()).unwrap_or(999)
            .cmp(&b.get("itag").and_then(|x| x.as_u64()).unwrap_or(999))
    });
    let fmt = &candidates[0];
    let mt = fmt.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
    let itag = fmt.get("itag").and_then(|x| x.as_u64()).unwrap_or(0);
    let url = decipher_format_url(fmt, client, state).await?;
    server_log!("[audio] progressive bas itag={} mime={}", itag, mt);
    Some((url, ext_from_mime(mt), itag))
}

async fn resolve_audio_url(state: &ServerState, id: &str) -> Option<(String, String, u64)> {
    let client = &state.client;
    let key = state.innertube_key.as_deref().unwrap_or("AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");
    let tor = *state.tor_enabled.read().await;
    if !tor {
        match innertube_android_request(client, "player", key, serde_json::json!({ "videoId": id })).await {
            Ok(data) => {
                let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
                server_log!("[download] Android status {} pour {}", status, id);
                if status == "OK" {
                    if let Some(res) = pick_audio_format(&data, client, state).await {
                        server_log!("[download] audio URL via Android pour {}", id);
                        return Some((res.0, res.1, 0));
                    }
                }
            }
            Err(e) => server_log!("[download] audio: android ERR {}", e),
        }
    }
    if !tor {
        match innertube_client_request(
            client, "player", key,
            IOS_CLIENT_NAME, IOS_CLIENT_VERSION, "5",
            "com.google.ios.youtube/21.10.2 (iPhone14,3; U; CPU iOS 18_2 like Mac OS X)",
            serde_json::json!({ "videoId": id, "deviceMake": "Apple", "deviceModel": IOS_DEVICE_MODEL, "osName": "iPhone", "osVersion": "18.2" }),
        ).await {
            Ok(data) => {
                let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
                server_log!("[download] iOS status {} pour {}", status, id);
                if status == "OK" {
                    if let Some(res) = pick_audio_format(&data, client, state).await {
                        server_log!("[download] audio URL via iOS pour {}", id);
                        return Some((res.0, res.1, 0));
                    }
                }
            }
            Err(e) => server_log!("[download] audio: iOS ERR {}", e),
        }
    }
    match watch_page_stream(client, id).await {
        Ok(data) => {
            if let Some(res) = pick_audio_format(&data, client, state).await {
                server_log!("[download] audio URL via watch page pour {}", id);
                return Some((res.0, res.1, 0));
            }
        }
        Err(e) => server_log!("[download] audio: watch ERR {}", e),
    }
    if !tor {
        match innertube_request(client, key, "player", serde_json::json!({ "videoId": id })).await {
            Ok(data) => {
                let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
                if status == "OK" {
                    if let Some(res) = pick_audio_format(&data, client, state).await {
                        server_log!("[download] audio URL via WEB pour {}", id);
                        return Some((res.0, res.1, 0));
                    }
                }
            }
            Err(e) => server_log!("[download] audio: web ERR {}", e),
        }
    }
    // Repli sur la cascade éprouvée de /stream (résout fiablement sur ce réseau).
    if let Some(url) = resolve_stream_url(state, id).await {
        server_log!("[download] audio URL via resolve_stream_url pour {}", id);
        return Some((url, "mp4".to_string(), 0));
    }
    None
}

async fn resolve_audio_dl_url(state: &ServerState, id: &str) -> Option<(String, String)> {
    let client = &state.client;
    let key = state.innertube_key.as_deref().unwrap_or("AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");
    let tor = *state.tor_enabled.read().await;
    if !tor {
        match innertube_android_request(client, "player", key, serde_json::json!({ "videoId": id })).await {
            Ok(data) => {
                let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
                server_log!("[audio-dl] android status {} pour {}", status, id);
                if status == "OK" {
                    if let Some((u, ext, itag)) = pick_lowest_progressive(&data, client, state).await {
                        server_log!("[audio-dl] progressif itag {} (ranges OK) via Android pour {}", itag, id);
                        return Some((u, ext));
                    }
                }
            }
            Err(e) => server_log!("[audio-dl] android ERR {}", e),
        }
    }
    if let Some(u) = resolve_stream_url(state, id).await {
        server_log!("[audio-dl] repli sur flux /stream (muxé, ranges OK) pour {}", id);
        return Some((u, "mp4".to_string()));
    }
    None
}

async fn pick_video_format(
    data: &serde_json::Value,
    client: &reqwest::Client,
    state: &ServerState,
) -> Option<(String, String)> {
    let streaming = data.get("streamingData")?;
    let mut formats: Vec<serde_json::Value> = Vec::new();
    if let Some(f) = streaming.get("formats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    if let Some(f) = streaming.get("adaptiveFormats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    let has_audio = |f: &serde_json::Value| -> bool {
        f.get("audioQuality").is_some()
            || f.get("audioCodec").is_some()
            || f.get("mimeType")
                .and_then(|m| m.as_str())
                .map(|m| m.contains("audio"))
                .unwrap_or(false)
    };
    let mut candidates: Vec<_> = formats
        .iter()
        .filter(|f| f.get("url").is_some() || f.get("signatureCipher").is_some() || f.get("cipher").is_some())
        .filter(|f| {
            let mt = f.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
            mt.trim_start().starts_with("video/") && has_audio(f)
        })
        .cloned()
        .collect();
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|a, b| {
        let am4a = a.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("mp4")).unwrap_or(false);
        let bm4a = b.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("mp4")).unwrap_or(false);
        let ah = a.get("height").and_then(|h| h.as_u64()).unwrap_or(0);
        let bh = b.get("height").and_then(|h| h.as_u64()).unwrap_or(0);
        let aok = ah > 0 && ah <= 720;
        let bok = bh > 0 && bh <= 720;
        bm4a.cmp(&am4a)
            .then(bok.cmp(&aok))
            .then(bh.cmp(&ah))
            .then(
                b.get("bitrate").and_then(|x| x.as_u64()).unwrap_or(0)
                    .cmp(&a.get("bitrate").and_then(|x| x.as_u64()).unwrap_or(0)),
            )
    });
    let fmt = &candidates[0];
    let mt = fmt.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
    let itag = fmt.get("itag").and_then(|x| x.as_u64()).unwrap_or(0);
    let bitrate = fmt.get("bitrate").and_then(|x| x.as_u64()).unwrap_or(0);
    server_log!("[video] picked itag={} mime={} bitrate={} height={} candidates={}", itag, mt, bitrate, fmt.get("height").and_then(|h| h.as_u64()).unwrap_or(0), candidates.len());
    let url = decipher_format_url(fmt, client, state).await?;
    server_log!("[video] URL (trunc 160): {}", url.chars().take(160).collect::<String>());
    Some((url, ext_from_mime(mt)))
}

async fn resolve_video_url(state: &ServerState, id: &str) -> Option<(String, String)> {
    let client = &state.client;
    let key = state.innertube_key.as_deref().unwrap_or("AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");
    let tor = *state.tor_enabled.read().await;
    if !tor {
        if let Ok(data) = innertube_android_request(client, "player", key, serde_json::json!({ "videoId": id })).await {
            let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
            server_log!("[download] Android status {} pour {}", status, id);
            if status == "OK" {
                if let Some(res) = pick_video_format(&data, client, state).await {
                    server_log!("[download] video URL via Android pour {}", id);
                    return Some(res);
                }
            }
        }
    }
    if let Ok(data) = watch_page_stream(client, id).await {
        if let Some(res) = pick_video_format(&data, client, state).await {
            server_log!("[download] video URL via watch page pour {}", id);
            return Some(res);
        }
    }
    if !tor {
        if let Ok(data) = innertube_request(client, key, "player", serde_json::json!({ "videoId": id })).await {
            let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
            if status == "OK" {
                if let Some(res) = pick_video_format(&data, client, state).await {
                    server_log!("[download] video URL via WEB pour {}", id);
                    return Some(res);
                }
            }
        }
    }
    // Repli sur la cascade éprouvée de /stream (résout fiablement sur ce réseau).
    if let Some(url) = resolve_stream_url(state, id).await {
        server_log!("[download] video URL via resolve_stream_url pour {}", id);
        return Some((url, "mp4".to_string()));
    }
    None
}

async fn proxy_youtube_stream(
    client: &reqwest::Client,
    url: &str,
    range: Option<&str>,
    origin: Option<&str>,
) -> Response {
    let mut req = client
        .get(url)
        .header("User-Agent", UA)
        .header("Referer", "https://www.youtube.com/")
        .header("Origin", "https://www.youtube.com");
    if let Some(r) = range {
        req = req.header("Range", r);
    }
    match req.send().await {
        Ok(resp) => {
            let code = resp.status().as_u16();
            let status = match code {
                200 => StatusCode::OK,
                206 => StatusCode::PARTIAL_CONTENT,
                302 | 301 => StatusCode::FOUND,
                _ => StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY),
            };
            let mut h = HeaderMap::new();
            for key in &["content-type", "content-length", "content-range"] {
                if let Some(val) = resp.headers().get(*key) {
                    h.insert(*key, val.clone());
                }
            }
            h.insert("accept-ranges", "bytes".parse().unwrap());
            h.insert("cache-control", "no-store".parse().unwrap());
            h.extend(cors_headers_map(origin));
            let chunked = resp.bytes_stream().map(|c| {
                c.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
            });
            (status, h, Body::from_stream(chunked)).into_response()
        }
        Err(e) => {
            server_log!("[proxy] send error: {}", e);
            json_response(
                serde_json::json!({"error": "Erreur de proxy stream."}),
                StatusCode::BAD_GATEWAY,
                origin,
            )
        }
    }
}

async fn watch_page_stream(
    client: &reqwest::Client,
    video_id: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let resp = client
        .get(&url)
        .header("User-Agent", UA)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Watch page fetch failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Watch page HTTP {}", resp.status()));
    }
    let html = resp.text().await.map_err(|e| format!("Watch page read: {}", e))?;
    let marker = "var ytInitialPlayerResponse = ";
    let start = html.find(marker).ok_or("ytInitialPlayerResponse not found in page")? + marker.len();
    let mut depth = 0i32;
    let mut end = start;
    let bytes = html.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'{' {
            depth += 1;
        } else if b == b'}' {
            depth -= 1;
            if depth == 0 {
                end = i + 1;
                break;
            }
        } else if b == b'"' {
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i += 2;
                    continue;
                }
                if bytes[i] == b'"' {
                    break;
                }
                i += 1;
            }
        }
        i += 1;
    }
    if depth != 0 {
        return Err("Failed to parse ytInitialPlayerResponse JSON".into());
    }
    let json_str = &html[start..end];
    let data: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON parse error: {}", e))?;
    Ok(data)
}

async fn youtubei_stream(
    client: &reqwest::Client,
    key: &str,
    video_id: &str,
    player_cache: &Arc<RwLock<Option<(Instant, String, String)>>>,
    ops_cache: &Arc<RwLock<Option<Vec<NTransformOp>>>>,
) -> Result<StreamInfo, String> {
    let data = innertube_request(client, key, "player", serde_json::json!({ "videoId": video_id })).await?;
    let streaming = data.get("streamingData").ok_or("No streamingData")?;
    let mut formats: Vec<serde_json::Value> = Vec::new();
    if let Some(f) = streaming.get("formats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    if let Some(f) = streaming.get("adaptiveFormats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    if formats.is_empty() {
        return Err("No formats found".into());
    }
    let has_audio = |f: &serde_json::Value| -> bool {
        f.get("audioQuality").is_some()
            || f.get("audioCodec").is_some()
            || f.get("mimeType")
                .and_then(|m| m.as_str())
                .map(|m| m.contains("audio"))
                .unwrap_or(false)
    };
    let pick = |pred: &dyn Fn(&serde_json::Value) -> bool| -> Option<serde_json::Value> {
        let mut filtered: Vec<_> = formats
            .iter()
            .filter(|f| f.get("url").is_some() || f.get("signatureCipher").is_some())
            .filter(|f| pred(f))
            .cloned()
            .collect();
        filtered.sort_by(|a, b| {
            let ha = a.get("height").and_then(|h| h.as_u64()).unwrap_or(0);
            let hb = b.get("height").and_then(|h| h.as_u64()).unwrap_or(0);
            let ba = a.get("bitrate").and_then(|h| h.as_u64()).unwrap_or(0);
            let bb = b.get("bitrate").and_then(|h| h.as_u64()).unwrap_or(0);
            hb.cmp(&ha).then(bb.cmp(&ba))
        });
        filtered.into_iter().next()
    };
    let fmt = pick(&|f: &serde_json::Value| {
        f.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("video/mp4")).unwrap_or(false)
            && f.get("height").and_then(|h| h.as_u64()).unwrap_or(0) <= 720
            && has_audio(f)
    })
    .or_else(|| {
        pick(&|f| {
            f.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("video/mp4")).unwrap_or(false)
                && has_audio(f)
        })
    })
    .or_else(|| pick(&|f| has_audio(f)))
    .or_else(|| pick(&|_| true))
    .ok_or("No suitable format found")?;

    let mut url: Option<String> = fmt.get("url").and_then(|u| u.as_str()).map(String::from);
    if url.is_none() {
        if let Some(cipher) = fmt.get("signatureCipher").and_then(|c| c.as_str()) {
            let params: HashMap<_, _> = url::form_urlencoded::parse(cipher.as_bytes()).collect();
            if let Some(real_url) = params.get("url") {
                if let Some(n) = params.get("n") {
                    let decoded = decipher_n(client, n, player_cache, ops_cache).await;
                    let mut parsed = url::Url::parse(real_url).map_err(|e| e.to_string())?;
                    parsed.set_query(Some(&format!(
                        "{}&n={}",
                        parsed.query().unwrap_or(""),
                        decoded
                    )));
                    url = Some(parsed.to_string());
                } else {
                    url = Some(real_url.to_string());
                }
            }
        }
    }
    let url = url.ok_or("Stream URL not found")?;
    let video_details = data.get("videoDetails").cloned().unwrap_or_default();
    let dur = video_details
        .get("lengthSeconds")
        .and_then(|s| s.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    Ok(StreamInfo {
        url,
        title: video_details
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .into(),
        duration: dur,
        channel: video_details
            .get("author")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .into(),
        thumbnail: video_details
            .pointer("/thumbnail/thumbnails")
            .and_then(|t| t.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|u| u.as_str())
            .map(String::from),
    })
}

async fn youtubei_stream_android(
    client: &reqwest::Client,
    video_id: &str,
    api_key: &str,
) -> Result<StreamInfo, String> {
    let data = innertube_android_request(client, "player", api_key, serde_json::json!({ "videoId": video_id })).await?;
    let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
    server_log!("[android-player] status: {}", status);
    if status != "OK" {
        let reason = data.get("playabilityStatus").and_then(|s| s.get("reason")).and_then(|v| v.as_str()).unwrap_or("unknown");
        return Err(format!("Android player status {}: {}", status, reason));
    }
    extract_stream_info(data, video_id, "android")
}

async fn youtubei_stream_ios(
    client: &reqwest::Client,
    video_id: &str,
    api_key: &str,
) -> Result<StreamInfo, String> {
    let data = innertube_client_request(
        client, "player", api_key,
        IOS_CLIENT_NAME, IOS_CLIENT_VERSION, "5",
        "com.google.ios.youtube/21.10.2 (iPhone14,3; U; CPU iOS 18_2 like Mac OS X)",
        serde_json::json!({ "videoId": video_id, "deviceMake": "Apple", "deviceModel": IOS_DEVICE_MODEL, "osName": "iPhone", "osVersion": "18.2" }),
    ).await?;
    let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
    server_log!("[ios-player] status: {}", status);
    if status != "OK" {
        let reason = data.get("playabilityStatus").and_then(|s| s.get("reason")).and_then(|v| v.as_str()).unwrap_or("unknown");
        return Err(format!("iOS player status {}: {}", status, reason));
    }
    extract_stream_info(data, video_id, "ios")
}

fn extract_stream_info(
    data: serde_json::Value,
    video_id: &str,
    source: &str,
) -> Result<StreamInfo, String> {
    let streaming = data.get("streamingData").ok_or("No streamingData")?;
    let mut formats: Vec<serde_json::Value> = Vec::new();
    if let Some(f) = streaming.get("formats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    if let Some(f) = streaming.get("adaptiveFormats").and_then(|v| v.as_array()) {
        formats.extend(f.iter().cloned());
    }
    server_log!("[{}] total formats: {}, has url: {}, has signatureCipher: {}",
        source,
        formats.len(),
        formats.iter().filter(|f| f.get("url").is_some()).count(),
        formats.iter().filter(|f| f.get("signatureCipher").is_some()).count(),
    );
    if formats.is_empty() {
        return Err("No formats found".into());
    }
    let has_audio = |f: &serde_json::Value| -> bool {
        f.get("audioQuality").is_some()
            || f.get("audioCodec").is_some()
            || f.get("mimeType")
                .and_then(|m| m.as_str())
                .map(|m| m.contains("audio"))
                .unwrap_or(false)
    };
    let pick = |pred: &dyn Fn(&serde_json::Value) -> bool| -> Option<serde_json::Value> {
        let mut filtered: Vec<_> = formats
            .iter()
            .filter(|f| f.get("url").is_some() || f.get("signatureCipher").is_some() || f.get("cipher").is_some())
            .filter(|f| pred(f))
            .cloned()
            .collect();
        filtered.sort_by(|a, b| {
            let ha = a.get("height").and_then(|h| h.as_u64()).unwrap_or(0);
            let hb = b.get("height").and_then(|h| h.as_u64()).unwrap_or(0);
            let ba = a.get("bitrate").and_then(|h| h.as_u64()).unwrap_or(0);
            let bb = b.get("bitrate").and_then(|h| h.as_u64()).unwrap_or(0);
            hb.cmp(&ha).then(bb.cmp(&ba))
        });
        filtered.into_iter().next()
    };
    let fmt = pick(&|f: &serde_json::Value| {
        f.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("video/mp4")).unwrap_or(false)
            && f.get("height").and_then(|h| h.as_u64()).unwrap_or(0) <= 720
            && has_audio(f)
    })
    .or_else(|| pick(&|f| {
        f.get("mimeType").and_then(|m| m.as_str()).map(|m| m.contains("video/mp4")).unwrap_or(false)
            && has_audio(f)
    }))
    .or_else(|| pick(&|f| has_audio(f)))
    .or_else(|| pick(&|_| true))
    .ok_or("No suitable format found")?;

    let mut url: Option<String> = fmt.get("url").and_then(|u| u.as_str()).map(String::from);
    if url.is_none() {
        let cipher_str = fmt.get("signatureCipher")
            .or_else(|| fmt.get("cipher"))
            .and_then(|c| c.as_str());
        if let Some(cipher) = cipher_str {
            let params: HashMap<_, _> = url::form_urlencoded::parse(cipher.as_bytes()).collect();
            if let Some(real_url) = params.get("url") {
                url = Some(real_url.to_string());
            }
        }
    }
    let url = url.ok_or("Stream URL not found")?;
    server_log!("[{}] resolved URL for {}, length={}", source, video_id, url.len());
    let video_details = data.get("videoDetails").cloned().unwrap_or_default();
    let dur = video_details
        .get("lengthSeconds")
        .and_then(|s| s.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    Ok(StreamInfo {
        url,
        title: video_details
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .into(),
        duration: dur,
        channel: video_details
            .get("author")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .into(),
        thumbnail: video_details
            .pointer("/thumbnail/thumbnails")
            .and_then(|t| t.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|u| u.as_str())
            .map(String::from),
    })
}

async fn innertube_tv_embedded_request(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    extra_body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://www.youtube.com/youtubei/v1/{}?key={}",
        endpoint, api_key
    );
    let mut body = serde_json::json!({
        "context": {
            "client": {
                "clientName": TV_EMBEDDED_CLIENT_NAME,
                "clientVersion": TV_EMBEDDED_CLIENT_VERSION,
                "hl": "en",
                "gl": "US"
            },
            "thirdParty": {
                "embedUrl": "https://www.youtube.com/"
            }
        }
    });
    if let (Some(obj), Some(extra)) = (body.as_object_mut(), extra_body.as_object()) {
        for (k, v) in extra {
            obj.insert(k.clone(), v.clone());
        }
    }
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("InnerTube TV embedded request failed: {}", err_chain(&e)))?;
    if !resp.status().is_success() {
        let status_code = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("InnerTube TV embedded {} HTTP {}: {}", endpoint, status_code, &body_text[..body_text.len().min(200)]));
    }
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("InnerTube TV embedded parse error: {}", e))
}

async fn youtubei_stream_tv_embedded(
    client: &reqwest::Client,
    video_id: &str,
    api_key: &str,
) -> Result<StreamInfo, String> {
    let data = innertube_tv_embedded_request(client, "player", api_key, serde_json::json!({ "videoId": video_id })).await?;
    let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
    server_log!("[tv-embedded-player] status: {}", status);
    if status != "OK" {
        let reason = data.get("playabilityStatus").and_then(|s| s.get("reason")).and_then(|v| v.as_str()).unwrap_or("unknown");
        return Err(format!("TV embedded player status {}: {}", status, reason));
    }
    extract_stream_info(data, video_id, "tv-embedded")
}

async fn youtubei_stream_android_vr(
    client: &reqwest::Client,
    video_id: &str,
    api_key: &str,
) -> Result<StreamInfo, String> {
    let data = innertube_client_request(
        client, "player", api_key,
        "ANDROID_VR", "1.57.29", "28",
        "com.google.android.apps.youtube.vr.oculus/1.57.29 (Linux; U; Android 12; eureka-user Build/SQ3A.220605.009.A1) gzip",
        serde_json::json!({ "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true }),
    ).await?;
    let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
    server_log!("[android-vr-player] status: {}", status);
    if status != "OK" {
        let reason = data.get("playabilityStatus").and_then(|s| s.get("reason")).and_then(|v| v.as_str()).unwrap_or("unknown");
        return Err(format!("Android VR player status {}: {}", status, reason));
    }
    extract_stream_info(data, video_id, "android-vr")
}

async fn youtubei_stream_tv(
    client: &reqwest::Client,
    video_id: &str,
    api_key: &str,
) -> Result<StreamInfo, String> {
    let data = innertube_client_request(
        client, "player", api_key,
        "TVHTML5", "7.20240723.10.00", "7",
        "Mozilla/5.0",
        serde_json::json!({ "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true }),
    ).await?;
    let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
    server_log!("[tv-player] status: {}", status);
    if status != "OK" {
        let reason = data.get("playabilityStatus").and_then(|s| s.get("reason")).and_then(|v| v.as_str()).unwrap_or("unknown");
        return Err(format!("TV player status {}: {}", status, reason));
    }
    extract_stream_info(data, video_id, "tv")
}

async fn youtubei_stream_web_embedded(
    client: &reqwest::Client,
    video_id: &str,
    api_key: &str,
) -> Result<StreamInfo, String> {
    let data = innertube_client_request(
        client, "player", api_key,
        "WEB_EMBEDDED_PLAYER", "1.20240620", "56",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        serde_json::json!({ "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true,
            "playbackContext": { "contentPlaybackContext": { "signatureTimestamp": 20073 } }
        }),
    ).await?;
    let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
    server_log!("[web-embedded-player] status: {}", status);
    if status != "OK" {
        let reason = data.get("playabilityStatus").and_then(|s| s.get("reason")).and_then(|v| v.as_str()).unwrap_or("unknown");
        return Err(format!("Web embedded player status {}: {}", status, reason));
    }
    extract_stream_info(data, video_id, "web-embedded")
}

// ─── YT-DLP FALLBACK ───

fn yt_dlp_path(state: &ServerState) -> String {
    state
        .resource_dir
        .as_ref()
        .map(|d| {
            let p = d.join("yt-dlp.exe");
            if p.exists() {
                p.to_string_lossy().to_string()
            } else {
                let p = d.join("yt-dlp");
                if p.exists() {
                    p.to_string_lossy().to_string()
                } else {
                    "yt-dlp".into()
                }
            }
        })
        .unwrap_or_else(|| "yt-dlp".into())
}

fn ffmpeg_path(state: &ServerState) -> String {
    #[cfg(target_os = "android")]
    {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let p = parent.join("libffmpeg.so");
                if p.exists() {
                    return p.to_string_lossy().to_string();
                }
            }
        }
    }
    state
        .resource_dir
        .as_ref()
        .map(|d| {
            let candidates = ["ffmpeg.exe", "ffmpeg", "libffmpeg.so"];
            for c in candidates {
                let p = d.join(c);
                if p.exists() {
                    return p.to_string_lossy().to_string();
                }
            }
            "ffmpeg".into()
        })
        .unwrap_or_else(|| "ffmpeg".into())
}

async fn try_stream_ytdlp(
    client: &reqwest::Client,
    state: &ServerState,
    video_id: &str,
    format: &str,
    timeout: Duration,
) -> Option<String> {
    let ytdlp = yt_dlp_path(state);
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let tor = *state.tor_enabled.read().await;
    server_log!("[ytdlp] binary={} exists={}", ytdlp, std::path::Path::new(&ytdlp).exists());
    let mut args = vec![
        &url,
        "-f", format,
        "--get-url",
        "--no-playlist",
        "--user-agent", UA,
        "--extractor-args", "youtube:player_client=android",
    ];
    let proxy_arg;
    if tor {
        proxy_arg = TOR_PROXY.to_string();
        args.push("--proxy");
        args.push(&proxy_arg);
    }
    let output = tokio::time::timeout(
        timeout,
        new_cmd(&ytdlp)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output(),
    )
    .await
    .ok()?;
    let out = match output {
        Ok(o) => o,
        Err(e) => {
            server_log!("[ytdlp] spawn error: {}", e);
            return None;
        }
    };
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        server_log!("[ytdlp] exit={:?} stderr={}", out.status.code(), &stderr[..stderr.len().min(400)]);
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !stdout.is_empty() {
        server_log!("[ytdlp] resolved via yt-dlp for {}", video_id);
        return Some(stdout);
    }
    server_log!("[ytdlp] empty stdout");
    None
}

// ─── ROUTE HANDLERS ───

async fn handle_search(
    State(state): State<ServerState>,
    Query(params): Query<SearchParams>,
    headers: HeaderMap,
) -> Response {
    let q = match params.q {
        Some(q) if !q.trim().is_empty() => q,
        _ => return json_response(serde_json::json!({"error": "Paramètre 'q' manquant."}), StatusCode::BAD_REQUEST, None),
    };
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    const SEARCH_BUDGET: Duration = Duration::from_secs(22);
    match tokio::time::timeout(SEARCH_BUDGET, run_search(state, q.clone(), origin)).await {
        Ok(resp) => resp,
        Err(_) => {
            server_log!("[search] TIMEOUT après {}s ({})", SEARCH_BUDGET.as_secs(), q);
            json_response(
                serde_json::json!({"error": "Recherche expirée (délai de 22 s). Réessayez."}),
                StatusCode::GATEWAY_TIMEOUT,
                origin,
            )
        }
    }
}

async fn run_search(state: ServerState, q: String, origin: Option<&str>) -> Response {
    let cache_key = q.to_lowercase();
    {
        let cache = state.search_cache.read().await;
        if let Some((ts, data)) = cache.get(&cache_key) {
            if ts.elapsed() < Duration::from_secs(600) {
                return json_response(data, StatusCode::OK, origin);
            }
        }
    }
    let client = state.client.clone();
    let results = if let Some(ref key) = state.innertube_key {
        match youtubei_search(&client, key, &q, 15).await {
            Ok(r) if !r.is_empty() => Ok(r),
            Ok(_) | Err(_) => {
                // Le client WEB est souvent bloqué : on retente via le client
                // ANDROID (le même que le streaming), qui est plus fiable.
                match youtubei_search_android(&client, key, &q, 15).await {
                    Ok(r) if !r.is_empty() => Ok(r),
                    Ok(_) => Err("No results".into()),
                    Err(e) => Err(e),
                }
            }
        }
    } else {
        Err("YOUTUBE_INNERTUBE_KEY not configured".into())
    };
    match results {
        Ok(r) => {
            let val = serde_json::to_value(&r).unwrap();
            state.search_cache.write().await.insert(cache_key, (Instant::now(), val.clone()));
            json_response(val, StatusCode::OK, origin)
        }
        Err(e) => {
            let msg = if e.contains("connect") || e.contains("resolve") || e.contains("timeout") {
                "Erreur connexion internet."
            } else {
                "Erreur de recherche."
            };
            json_response(serde_json::json!({"error": format!("{} {}", msg, e)}), StatusCode::INTERNAL_SERVER_ERROR, origin)
        }
    }
}

async fn handle_thumb(
    State(state): State<ServerState>,
    Query(params): Query<ThumbParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let target = match params.url {
        Some(u) => u,
        _ => return json_response(serde_json::json!({"error": "Paramètre 'url' manquant."}), StatusCode::BAD_REQUEST, origin),
    };
    if !is_allowed_thumb_url(&target) {
        return json_response(serde_json::json!({"error": "URL d'image non autorisée."}), StatusCode::FORBIDDEN, origin);
    }
    let client = state.client.clone();
    match client
        .get(&target)
        .header("User-Agent", UA)
        .header("Referer", "https://www.youtube.com/")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let ct = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("image/jpeg")
                .to_string();
            match resp.bytes().await {
                Ok(bytes) => {
                    let mut headers = HeaderMap::new();
                    headers.insert("content-type", ct.parse().unwrap());
                    headers.insert("cache-control", "public, max-age=86400".parse().unwrap());
                    headers.extend(cors_headers_map(origin));
                    (StatusCode::OK, headers, bytes.to_vec()).into_response()
                }
                Err(_) => json_response(serde_json::json!({"error": "Échec du proxy d'image."}), StatusCode::BAD_GATEWAY, origin),
            }
        }
        _ => json_response(serde_json::json!({"error": "Image introuvable."}), StatusCode::NOT_FOUND, origin),
    }
}

async fn handle_stream(
    State(state): State<ServerState>,
    Query(params): Query<IdParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = match params.id {
        Some(id) if is_valid_video_id(&id) => id,
        _ => return json_response(serde_json::json!({"error": "videoId invalide."}), StatusCode::BAD_REQUEST, origin),
    };

    let cached_url = {
        let cache = state.stream_cache.read().await;
        cache.get(&id)
            .filter(|(ts, _)| ts.elapsed() < Duration::from_secs(1200))
            .map(|(_, url)| url.clone())
    };

    let stream_url = if let Some(url) = cached_url {
        url
    } else {
        match resolve_stream_url(&state, &id).await {
            Some(url) => {
                state.stream_cache.write().await.insert(id.clone(), (Instant::now(), url.clone()));
                url
            }
            None => {
                return json_response(
                    serde_json::json!({"error": "Aucun flux vidéo disponible."}),
                    StatusCode::BAD_GATEWAY,
                    origin,
                );
            }
        }
    };

    let range = headers.get("range").and_then(|v| v.to_str().ok());
    proxy_youtube_stream(&state.client, &stream_url, range, origin).await
}

async fn handle_stream_tor(
    State(state): State<ServerState>,
    Query(params): Query<IdParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = match params.id {
        Some(id) if is_valid_video_id(&id) => id,
        _ => return json_response(serde_json::json!({"error": "videoId invalide."}), StatusCode::BAD_REQUEST, origin),
    };
    let client = state.client.clone();

    let cached_url = {
        let cache = state.stream_cache.read().await;
        cache.get(&id)
            .filter(|(ts, _)| ts.elapsed() < Duration::from_secs(1200))
            .map(|(_, url)| url.clone())
    };

    let stream_url = if let Some(url) = cached_url {
        url
    } else {
        let mut direct_url = try_stream_ytdlp(&client, &state, &id, "18", Duration::from_secs(60)).await;
        if direct_url.is_none() {
            direct_url = try_stream_ytdlp(&client, &state, &id, "22", Duration::from_secs(80)).await;
        }
        if direct_url.is_none() {
            direct_url = try_stream_ytdlp(&client, &state, &id, "best[height<=720][ext=mp4]", Duration::from_secs(120)).await;
        }
        match direct_url {
            Some(url) => {
                state.stream_cache.write().await.insert(id.clone(), (Instant::now(), url.clone()));
                url
            }
            None => {
                return json_response(serde_json::json!({"error": "Aucun flux vidéo disponible via Tor."}), StatusCode::BAD_GATEWAY, origin);
            }
        }
    };

    let range = headers.get("range").and_then(|v| v.to_str().ok());
    proxy_youtube_stream(&state.client, &stream_url, range, origin).await
}

async fn handle_preload_stream(
    State(state): State<ServerState>,
    Query(params): Query<IdParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = match params.id {
        Some(id) if is_valid_video_id(&id) => id,
        _ => return json_response(serde_json::json!({"error": "videoId invalide."}), StatusCode::BAD_REQUEST, origin),
    };
    {
        let cache = state.stream_cache.read().await;
        if let Some((ts, _)) = cache.get(&id) {
            if ts.elapsed() < Duration::from_secs(1200) {
                return json_response(serde_json::json!({"ok": true, "cached": true}), StatusCode::OK, origin);
            }
        }
    }
    match resolve_stream_url(&state, &id).await {
        Some(url) => {
            state.stream_cache.write().await.insert(id.clone(), (Instant::now(), url.clone()));
            json_response(serde_json::json!({"ok": true, "cached": false}), StatusCode::OK, origin)
        }
        None => {
            json_response(
                serde_json::json!({"error": "Aucun flux vidéo disponible."}),
                StatusCode::BAD_GATEWAY,
                origin,
            )
        }
    }
}

async fn handle_local(
    State(state): State<ServerState>,
    Query(params): Query<LocalParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let file_path = match params.path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => return json_response(serde_json::json!({"error": "Paramètre 'path' manquant."}), StatusCode::BAD_REQUEST, origin),
    };
    if !is_path_allowed(&file_path, &state.output_dir) {
        return json_response(serde_json::json!({"error": "Chemin non autorisé."}), StatusCode::FORBIDDEN, origin);
    }
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !SERVE_EXT.contains(&ext.as_str()) {
        return json_response(serde_json::json!({"error": "Type de fichier non supporté."}), StatusCode::FORBIDDEN, origin);
    }
    let metadata = match fs::metadata(&file_path) {
        Ok(m) if m.is_file() => m,
        _ => return json_response(serde_json::json!({"error": "Fichier introuvable."}), StatusCode::NOT_FOUND, origin),
    };
    let mime = mime_for_ext(&ext);
    let file_size = metadata.len();

    if let Some(range_header) = headers.get("range").and_then(|v| v.to_str().ok()) {
        let range_re = Regex::new(r"bytes=(\d+)-(\d*)").unwrap();
        if let Some(caps) = range_re.captures(range_header) {
            let start: u64 = caps.get(1).unwrap().as_str().parse().unwrap_or(0);
            let end: u64 = caps.get(2)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(file_size - 1);
            if start > end || start >= file_size {
                let mut resp_headers = HeaderMap::new();
                resp_headers.insert("Content-Range", format!("bytes */{}", file_size).parse().unwrap());
                return (StatusCode::RANGE_NOT_SATISFIABLE, resp_headers).into_response();
            }
            let chunk_size = end - start + 1;
            let mut file = match fs::File::open(&file_path) {
                Ok(f) => f,
                Err(_) => return json_response(serde_json::json!({"error": "Cannot open file"}), StatusCode::INTERNAL_SERVER_ERROR, origin),
            };
            if file.seek(SeekFrom::Start(start)).is_err() {
                return json_response(serde_json::json!({"error": "Seek failed"}), StatusCode::INTERNAL_SERVER_ERROR, origin);
            }
            let mut buf = vec![0u8; chunk_size as usize];
            let n = file.read(&mut buf).unwrap_or(0);
            buf.truncate(n);
            let mut resp_headers = HeaderMap::new();
            resp_headers.insert("Content-Type", mime.parse().unwrap());
            resp_headers.insert("Content-Range", format!("bytes {}-{}/{}", start, start + n as u64 - 1, file_size).parse().unwrap());
            resp_headers.insert("Accept-Ranges", "bytes".parse().unwrap());
            resp_headers.insert("Content-Length", n.to_string().parse().unwrap());
            resp_headers.insert("Cache-Control", "no-store".parse().unwrap());
            resp_headers.extend(cors_headers_map(origin));
            return (StatusCode::PARTIAL_CONTENT, resp_headers, buf).into_response();
        }
    }
    if file_size > 100 * 1024 * 1024 {
        return json_response(serde_json::json!({"error": "Fichier trop volumineux (>100 Mo)."}), StatusCode::PAYLOAD_TOO_LARGE, origin);
    }
    let data = match fs::read(&file_path) {
        Ok(d) => d,
        Err(_) => return json_response(serde_json::json!({"error": "Cannot read file"}), StatusCode::INTERNAL_SERVER_ERROR, origin),
    };
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert("Content-Type", mime.parse().unwrap());
    resp_headers.insert("Accept-Ranges", "bytes".parse().unwrap());
    resp_headers.insert("Content-Length", file_size.to_string().parse().unwrap());
    resp_headers.insert("Cache-Control", "no-store".parse().unwrap());
    resp_headers.extend(cors_headers_map(origin));
    (StatusCode::OK, resp_headers, data).into_response()
}

fn valid_status_key(k: &str) -> bool {
    let stripped = k
        .strip_suffix("-audio")
        .or_else(|| k.strip_suffix("-video"));
    match stripped {
        Some(id) if id.len() == 11 => id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        _ => false,
    }
}

async fn is_download_paused(state: &ServerState, key: &str) -> bool {
    state.paused_set.read().await.contains(key)
}

/// Attend tant que la clé est en pause (boucle toutes les 250 ms).
async fn wait_if_paused(state: &ServerState, key: &str) {
    loop {
        if !is_download_paused(state, key).await {
            return;
        }
        sleep(Duration::from_millis(250)).await;
    }
}

#[cfg(unix)]
fn signal_pid(pid: i32, sig: i32) {
    unsafe {
        libc::kill(pid, sig);
    }
    if pid > 0 {
        server_log!("[pause] signal {} -> pid {}", sig, pid);
    }
}

#[cfg(not(unix))]
fn signal_pid(_pid: i32, _sig: i32) {}

/// Lance `cmd` en draineant ses sorties et attend sa fin, mais de façon
/// « pausable » : tant que la clé est en pause on ne fait que patienter (le
/// processus est gelé par SIGSTOP depuis l'endpoint pause) et le timeout est
/// étendu du temps passé en pause. Retourne un Output dont stderr contient la
/// queue des sorties (pour les messages d'erreur yt-dlp).
async fn wait_cmd_pausable(
    state: &ServerState,
    key: &str,
    mut cmd: tokio::process::Command,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    use std::process::Stdio;
    use std::collections::VecDeque;
    use tokio::io::AsyncBufReadExt;

    let mut cmd = cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(format!("spawn: {}", e)),
    };
    let pid = child.id().unwrap_or(0) as i32;
    if pid > 0 {
        state.child_pids.write().await.insert(key.to_string(), pid);
    } else {
        server_log!("[pause] pas de pid pour {}", key);
    }

    let tail = Arc::new(tokio::sync::Mutex::new(String::new()));
    if let Some(oe) = child.stdout.take() {
        let tail = Arc::clone(&tail);
        tokio::spawn(async move {
            let mut r = tokio::io::BufReader::new(oe).lines();
            let mut lines: VecDeque<String> = VecDeque::new();
            while let Ok(Some(l)) = r.next_line().await {
                lines.push_back(l);
                if lines.len() > 40 {
                    lines.pop_front();
                }
                *tail.lock().await = lines.iter().cloned().collect::<Vec<_>>().join("\n");
            }
        });
    }
    if let Some(ee) = child.stderr.take() {
        let tail = Arc::clone(&tail);
        tokio::spawn(async move {
            let mut r = tokio::io::BufReader::new(ee).lines();
            let mut lines: VecDeque<String> = VecDeque::new();
            while let Ok(Some(l)) = r.next_line().await {
                lines.push_back(l);
                if lines.len() > 40 {
                    lines.pop_front();
                }
                *tail.lock().await = lines.iter().cloned().collect::<Vec<_>>().join("\n");
            }
        });
    }

    let start = Instant::now();
    let mut paused_acc = Duration::ZERO;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                state.child_pids.write().await.remove(key);
                return Ok(std::process::Output {
                    status,
                    stdout: Vec::new(),
                    stderr: tail.lock().await.clone().into_bytes(),
                });
            }
            Ok(None) => {}
            Err(e) => {
                state.child_pids.write().await.remove(key);
                return Err(format!("wait: {}", e));
            }
        }
        if is_download_paused(state, key).await {
            paused_acc += Duration::from_millis(1000);
        }
        if start.elapsed() > timeout + paused_acc {
            let _ = child.kill().await;
            state.child_pids.write().await.remove(key);
            return Err("__TIMEOUT__".into());
        }
        sleep(Duration::from_millis(1000)).await;
    }
}

/// Retraite un échec d'écriture ponctuel (EIO = stockage FUSE endormi sous
/// Android, EAGAIN, erreurs transitoires) : on patiente brièvement puis on
/// réessaie, jusqu'à `max_retries` fois avant de rendre l'erreur finale.
fn resilient_write(file: &mut std::fs::File, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut attempt = 0u32;
    loop {
        match file.write_all(data) {
            Ok(()) => return Ok(()),
            Err(e) => {
                let transient = matches!(e.raw_os_error(), Some(5) | Some(11) | Some(28));
                if transient && attempt < 4 {
                    attempt += 1;
                    std::thread::sleep(Duration::from_millis(400 * u64::from(attempt)));
                    continue;
                }
                return Err(e);
            }
        }
    }
}

/// Télécharge une URL YouTube en flux UNIQUE non borné, en HTTP/1.1.
/// C'est le chemin qui fonctionne réellement sur ce réseau : les URLs servies
/// par /stream (Android VR / watch page, non plafonnées) acceptent un GET
/// ouvert, contrairement aux URLs itag 140 "Android" qui ne servent qu'~1 Mo
/// de ranges puis répondent 403 (limite sans jeton P.O.T.). HTTP/1.1 évite
/// l'erreur "error decoding response body" du HTTP/2. Pause intégrée entre
/// les morceaux écrits sur disque.
fn parse_content_range_total(cr: &str) -> Option<u64> {
    cr.split('/').last().and_then(|s| s.trim().parse::<u64>().ok()).filter(|n| *n > 0)
}

async fn stream_ranges_pausable<F>(
    state: &ServerState,
    key: &str,
    url: &str,
    chunk: u64,
    progress_base: f64,
    progress_span: f64,
    size_hint: u64,
    mut write: F,
) -> Result<u64, String>
where
    F: FnMut(&[u8]) -> std::io::Result<()>,
{
    let chunk = chunk.max(1);
    let mut pos: u64 = 0;
    let mut total: Option<u64> = None;
    let mut last_pct: u32 = 0;
    let mut seg_retries: u32 = 0;
    loop {
        if let Some(t) = total {
            if pos >= t {
                break;
            }
        }
        wait_if_paused(state, key).await;
        let end = total.map(|t| (pos + chunk - 1).min(t - 1)).unwrap_or(pos + chunk - 1);
        let range = if end > pos { format!("bytes={}-{}", pos, end) } else { format!("bytes={}-", pos) };
        let resp = state
            .client
            .get(url)
            .version(reqwest::Version::HTTP_11)
            .header("User-Agent", UA)
            .header("Referer", "https://www.youtube.com/")
            .header("Origin", "https://www.youtube.com")
            .header("Range", &range)
            .send()
            .await
            .map_err(|e| format!("Erreur de téléchargement: {}", e))?;
        let status = resp.status();
        if status != reqwest::StatusCode::PARTIAL_CONTENT && !status.is_success() {
            seg_retries += 1;
            if seg_retries >= 3 {
                let url_trunc: String = url.chars().take(140).collect();
                server_log!("[range] HTTP {} (épuisé) pour {}", status, url_trunc);
                return Err(format!("Erreur de téléchargement (HTTP {})", status));
            }
            server_log!("[range] HTTP {} retry ({}) à l'offset {}", status, seg_retries, pos);
            sleep(Duration::from_millis(800)).await;
            continue;
        }
        if status == reqwest::StatusCode::PARTIAL_CONTENT {
            if let Some(cr) = resp.headers().get("content-range").and_then(|v| v.to_str().ok()) {
                if let Some(t) = parse_content_range_total(cr) {
                    total = Some(t);
                }
            }
        }
        let effective = (total.or_else(|| (size_hint > 0).then_some(size_hint))).map(|t| t.max(1)).unwrap_or(5_000_000) as f64;
        let mut bytes = resp.bytes_stream();
        let mut got_this = 0u64;
        let mut broke = false;
        while let Some(part) = bytes.next().await {
            wait_if_paused(state, key).await;
            let part = match part {
                Ok(p) => p,
                Err(e) => {
                    server_log!("[range] coupure à l'offset {}: {}", pos, e);
                    broke = true;
                    break;
                }
            };
            write(&part).map_err(|e| format!("Erreur d'écriture du fichier: {}", e))?;
            pos += part.len() as u64;
            got_this += part.len() as u64;
            let pct = (progress_base + (pos as f64 / effective) * progress_span).min(progress_base + progress_span) as u32;
            if pct != last_pct {
                last_pct = pct;
                state.progress_map.write().await.insert(key.to_string(), pct as f64);
            }
        }
        if broke {
            seg_retries += 1;
            if seg_retries >= 3 {
                return Err("Connexion interrompue pendant le téléchargement (3 essais)".into());
            }
            continue;
        }
        seg_retries = 0;
        if status == reqwest::StatusCode::PARTIAL_CONTENT && total.is_none() && got_this < chunk {
            total = Some(pos);
        }
        if status != reqwest::StatusCode::PARTIAL_CONTENT {
            total = Some(pos);
        }
    }
    server_log!("[range] terminé après {} octets", pos);
    Ok(pos)
}

async fn handle_download(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<DownloadBody>,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    if !is_valid_video_id(&body.video_id) {
        return json_response(serde_json::json!({"error": "videoId invalide."}), StatusCode::BAD_REQUEST, origin);
    }
    let fmt = body.format.as_deref().unwrap_or("audio");
    let status_key = format!("{}-{}", body.video_id, fmt);
    state.progress_map.write().await.insert(status_key.clone(), 0.0);
    state.paused_set.write().await.remove(&status_key);
    state.child_pids.write().await.remove(&status_key);
    let mut target_dir = if fmt == "video" {
        state.output_dir.join("Video")
    } else {
        state.output_dir.join("Audio")
    };
    if let Err(e) = fs::create_dir_all(&target_dir) {
        // Fallback : si le dossier par défaut est inaccessible (scoped storage /
        // permissions), on bascule vers /storage/emulated/0/Download/MediaCLI
        // qui reste écrivable en brut avec le legacy storage.
        let fallback = PathBuf::from("/storage/emulated/0/Download/MediaCLI")
            .join(if fmt == "video" { "Video" } else { "Audio" });
        match fs::create_dir_all(&fallback) {
            Ok(_) => {
                server_log!("[download] fallback écriture MediaCLI -> {}", fallback.display());
                target_dir = fallback;
            }
            Err(e2) => {
                state.progress_map.write().await.remove(&status_key);
                return json_response(serde_json::json!({"success": false, "error": format!("Impossible de créer le dossier de destination ({} puis {}): {}", target_dir.display(), fallback.display(), e2)}), StatusCode::INTERNAL_SERVER_ERROR, origin);
            }
        }
    }
    let safe_title = sanitize_filename(&body.title);

    // Garde-fou : un stockage plein donne la pire expérience (échec en plein
    // flux). On refuse proprement dès le départ s'il reste moins de 200 Mo.
    if let Some(free) = free_space_bytes(&target_dir) {
        if free < 200 * 1024 * 1024 {
            state.progress_map.write().await.remove(&status_key);
            let mb = free / (1024 * 1024);
            return json_response(serde_json::json!({"success": false, "error": format!("Stockage insuffisant ({} Mo libres sur le dossier de destination). Libérez de l'espace puis réessayez.", mb)}), StatusCode::INSUFFICIENT_STORAGE, origin);
        }
    }

    let ytdlp = yt_dlp_path(&state);
    let has_ytdlp = new_cmd(&ytdlp)
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);
    server_log!("[download] {} via {} pour {}", fmt, if has_ytdlp { "yt-dlp" } else { "flux direct" }, body.video_id);

    if has_ytdlp {
        let ffmpeg = ffmpeg_path(&state);
        let tor = *state.tor_enabled.read().await;

        if fmt == "audio" {
            let temp_pattern = target_dir.join(format!(".tmp_{}.%(ext)s", body.video_id));
            let mut args = vec![
                format!("https://www.youtube.com/watch?v={}", body.video_id),
                "-f".into(), "bestaudio".into(),
                "-o".into(), temp_pattern.to_string_lossy().to_string(),
                "--no-playlist".into(),
                "--concurrent-fragments".into(), "4".into(),
                "--socket-timeout".into(), "30".into(),
                "--retries".into(), "3".into(),
            ];
            if tor {
                args.push("--proxy".into());
                args.push(TOR_PROXY.into());
                args.push("--socket-timeout".into());
                args.push("120".into());
            }
            let mut cmd = new_cmd(&ytdlp);
            cmd.args(&args);
            let output = wait_cmd_pausable(&state, &status_key, cmd, Duration::from_secs(300)).await;
            match output {
                Ok(o) if o.status.success() => {}
                Ok(o) => {
                    let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                    let msg = if stderr.is_empty() { "Erreur de téléchargement audio".into() } else { stderr };
                    state.progress_map.write().await.remove(&status_key);
                    return json_response(serde_json::json!({"success": false, "error": msg}), StatusCode::INTERNAL_SERVER_ERROR, origin);
                }
                Err(e) => {
                    let msg = if e == "__TIMEOUT__" { "Timeout du téléchargement audio (5 min)".into() } else { format!("Impossible de lancer yt-dlp: {}", e) };
                    state.progress_map.write().await.remove(&status_key);
                    return json_response(serde_json::json!({"success": false, "error": msg}), StatusCode::INTERNAL_SERVER_ERROR, origin);
                }
            }
            state.progress_map.write().await.insert(status_key.clone(), 80.0);
            let temp_file = fs::read_dir(&target_dir)
                .ok()
                .and_then(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .find(|e| e.file_name().to_string_lossy().starts_with(&format!(".tmp_{}.", body.video_id)))
                        .map(|e| e.path())
                });
            let temp_file = match temp_file {
                Some(f) => f,
                None => {
                    state.progress_map.write().await.remove(&status_key);
                    return json_response(serde_json::json!({"success": false, "error": "Fichier temporaire introuvable."}), StatusCode::INTERNAL_SERVER_ERROR, origin);
                }
            };
            let final_path = target_dir.join(format!("{}.mp3", safe_title));
            let conv_output = tokio::time::timeout(Duration::from_secs(120), new_cmd(&ffmpeg)
                .args([
                    "-i", &temp_file.to_string_lossy(),
                    "-vn", "-acodec", "libmp3lame", "-q:a", "2",
                    &final_path.to_string_lossy(),
                    "-y", "-loglevel", "error",
                ])
                .output()).await;
            let _ = fs::remove_file(&temp_file);
            match conv_output {
                Ok(Ok(o)) if o.status.success() => {
                    state.paused_set.write().await.remove(&status_key);
                    state.progress_map.write().await.insert(status_key, 100.0);
                    json_response(serde_json::json!({"success": true, "path": final_path.to_string_lossy()}), StatusCode::OK, origin)
                }
                _ => {
                    let _ = fs::remove_file(&final_path);
                    let err = match conv_output {
                        Ok(Ok(o)) => String::from_utf8_lossy(&o.stderr).trim().to_string(),
                        Ok(Err(e)) => format!("spawn: {}", e),
                        Err(_) => "Timeout de la conversion MP3 (120s)".into(),
                    };
                    state.progress_map.write().await.remove(&status_key);
                    json_response(serde_json::json!({"success": false, "error": err}), StatusCode::INTERNAL_SERVER_ERROR, origin)
                }
            }
        } else {
            let final_path = target_dir.join(format!("{}.mp4", safe_title));
            let mut args = vec![
                format!("https://www.youtube.com/watch?v={}", body.video_id),
                "-f".into(), "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".into(),
                "--merge-output-format".into(), "mp4".into(),
                "-o".into(), final_path.to_string_lossy().to_string(),
                "--no-playlist".into(),
                "--concurrent-fragments".into(), "4".into(),
                "--socket-timeout".into(), "30".into(),
                "--retries".into(), "3".into(),
            ];
            if tor {
                args.push("--proxy".into());
                args.push(TOR_PROXY.into());
                args.push("--socket-timeout".into());
                args.push("300".into());
            }
            let mut cmd = new_cmd(&ytdlp);
            cmd.args(&args);
            let output = wait_cmd_pausable(&state, &status_key, cmd, Duration::from_secs(600)).await;
            match output {
                Ok(o) if o.status.success() => {
                    state.paused_set.write().await.remove(&status_key);
                    state.progress_map.write().await.insert(status_key, 100.0);
                    json_response(serde_json::json!({"success": true, "path": final_path.to_string_lossy()}), StatusCode::OK, origin)
                }
                _ => {
                    let err = match output {
                        Ok(o) => {
                            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                            if stderr.is_empty() { "Erreur de téléchargement vidéo".into() } else { stderr }
                        }
                        Err(e) => {
                            if e == "__TIMEOUT__" { "Timeout du téléchargement vidéo (10 min)".into() } else { format!("Impossible de lancer yt-dlp: {}", e) }
                        }
                    };
                    state.progress_map.write().await.remove(&status_key);
                    json_response(serde_json::json!({"success": false, "error": err}), StatusCode::INTERNAL_SERVER_ERROR, origin)
                }
            }
        }
    } else {
        if fmt != "video" {
            return download_audio_with_ffmpeg(&state, &body, &target_dir, &safe_title, &status_key, origin).await;
        }
        use std::io::Write;

        let (stream_url, ext) = match resolve_video_url(&state, &body.video_id).await {
            Some((url, ext)) => (url, ext),
            None => {
                state.progress_map.write().await.remove(&status_key);
                return json_response(serde_json::json!({"success": false, "error": "Aucun flux vidéo disponible pour le téléchargement"}), StatusCode::BAD_GATEWAY, origin);
            }
        };
        let final_path = target_dir.join(format!("{}.{}", safe_title, ext));
        state.progress_map.write().await.insert(status_key.clone(), 20.0);

        let mut file = match std::fs::File::create(&final_path) {
            Ok(f) => f,
            Err(e) => {
                state.progress_map.write().await.remove(&status_key);
                return json_response(serde_json::json!({"success": false, "error": format!("Erreur d'écriture du fichier: {}", e)}), StatusCode::INTERNAL_SERVER_ERROR, origin);
            }
        };
        server_log!("[download] flux complet vidéo pour {}", body.video_id);
        let dl_url = stream_url.clone();
        match stream_ranges_pausable(&state, &status_key, &dl_url, 4 * 1024 * 1024, 20.0, 80.0, 60_000_000, |part: &[u8]| resilient_write(&mut file, part)).await {
            Ok(_) => {
                state.paused_set.write().await.remove(&status_key);
                state.progress_map.write().await.insert(status_key, 100.0);
            }
            Err(msg) => {
                let _ = std::fs::remove_file(&final_path);
                server_log!("[download] échec {}: {}", body.video_id, msg);
                state.progress_map.write().await.remove(&status_key);
                return json_response(serde_json::json!({"success": false, "error": msg}), StatusCode::INTERNAL_SERVER_ERROR, origin);
            }
        }
        json_response(serde_json::json!({"success": true, "path": final_path.to_string_lossy()}), StatusCode::OK, origin)
    }
}

async fn download_audio_with_ffmpeg(
    state: &ServerState,
    body: &DownloadBody,
    target_dir: &std::path::Path,
    safe_title: &str,
    status_key: &str,
    origin: Option<&str>,
) -> Response {
    use std::io::Write;

    let final_path = target_dir.join(format!("{}.mp3", safe_title));

    let (url, temp_ext) = match resolve_audio_dl_url(state, &body.video_id).await {
        Some((u, e)) => (u, e),
        None => {
            state.progress_map.write().await.remove(status_key);
            return json_response(serde_json::json!({"success": false, "error": "Aucun flux audio disponible pour le téléchargement"}), StatusCode::BAD_GATEWAY, origin);
        }
    };
    state.progress_map.write().await.insert(status_key.to_string(), 8.0);

    server_log!("[audio-dl] téléchargement audio (plages) pour {}", body.video_id);
    let temp_path = target_dir.join(format!(".tmp_{}.{}", body.video_id, temp_ext));
    let mut file = match std::fs::File::create(&temp_path) {
        Ok(f) => f,
        Err(e) => {
            state.progress_map.write().await.remove(status_key);
            return json_response(serde_json::json!({"success": false, "error": format!("Erreur d'écriture du fichier: {}", e)}), StatusCode::INTERNAL_SERVER_ERROR, origin);
        }
    };
    match stream_ranges_pausable(state, status_key, &url, 2 * 1024 * 1024, 8.0, 82.0, 5_000_000, |part: &[u8]| resilient_write(&mut file, part)).await {
        Ok(_) => {}
        Err(msg) => {
            let _ = std::fs::remove_file(&temp_path);
            server_log!("[audio-dl] échec {}: {}", body.video_id, msg);
            state.progress_map.write().await.remove(status_key);
            return json_response(serde_json::json!({"success": false, "error": msg}), StatusCode::INTERNAL_SERVER_ERROR, origin);
        }
    }
    drop(file);
    state.paused_set.write().await.remove(status_key);
    state.progress_map.write().await.insert(status_key.to_string(), 90.0);

    let ffmpeg = ffmpeg_path(state);
    let ffmpeg_ok = {
        let mut probe_cmd = new_cmd(&ffmpeg);
        probe_cmd.arg("-version");
        tokio::time::timeout(Duration::from_secs(8), probe_cmd.output())
            .await
            .map(|r| r.map(|o| o.status.success()).unwrap_or(false))
            .unwrap_or(false)
    };
    if !ffmpeg_ok {
        // Pas de ffmpeg disponible : on conserve le fichier audio tel quel
        // (m4a/webm/mp4) au lieu d'échouer — il reste lisible partout.
        let keep_ext = temp_ext;
        let keep_path = target_dir.join(format!("{}.{}", safe_title, keep_ext));
        match std::fs::rename(&temp_path, &keep_path) {
            Ok(_) => {
                state.paused_set.write().await.remove(status_key);
                state.progress_map.write().await.insert(status_key.to_string(), 100.0);
                server_log!("[audio-dl] ffmpeg absent — fichier audio gardé tel quel (.{}) pour {}", keep_ext, body.video_id);
                return json_response(serde_json::json!({"success": true, "path": keep_path.to_string_lossy(), "note": "Aucun ffmpeg : fichier audio téléchargé directement (pas de conversion mp3)."}), StatusCode::OK, origin);
            }
            Err(e) => {
                let _ = std::fs::remove_file(&temp_path);
                state.progress_map.write().await.remove(status_key);
                return json_response(serde_json::json!({"success": false, "error": format!("Erreur de sauvegarde du fichier audio: {}", e)}), StatusCode::INTERNAL_SERVER_ERROR, origin);
            }
        }
    }

    server_log!("[audio-dl] conversion avec {} pour {}", ffmpeg, body.video_id);
    let mut cmd = new_cmd(&ffmpeg);
    let args: Vec<String> = vec![
        "-y".into(),
        "-loglevel".into(), "error".into(),
        "-i".into(), temp_path.to_string_lossy().to_string(),
        "-vn".into(), "-acodec".into(), "libmp3lame".into(), "-q:a".into(), "2".into(),
        final_path.to_string_lossy().to_string(),
    ];
    cmd.args(args);
    #[cfg(target_os = "android")]
    {
        if let Some(dir) = std::path::Path::new(&ffmpeg).parent() {
            let ld = dir.to_string_lossy().to_string();
            cmd.env("LD_LIBRARY_PATH", ld);
        }
    }
    let conv = tokio::time::timeout(Duration::from_secs(120), cmd.output()).await;
    let _ = std::fs::remove_file(&temp_path);
    match conv {
        Ok(Ok(o)) if o.status.success() => {
            state.paused_set.write().await.remove(status_key);
            state.progress_map.write().await.insert(status_key.to_string(), 100.0);
            json_response(serde_json::json!({"success": true, "path": final_path.to_string_lossy()}), StatusCode::OK, origin)
        }
        _ => {
            let err = match conv {
                Ok(Ok(o)) => {
                    let code = o.status.code().map(|c| c.to_string()).unwrap_or_else(|| "?".into());
                    let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                    format!("ffmpeg exit={} stdout={} stderr={}", code, stdout, stderr)
                }
                Ok(Err(e)) => format!("ffmpeg spawn: {}", e),
                Err(_) => "Timeout de la conversion MP3 (120s)".into(),
            };
            let _ = std::fs::remove_file(&final_path);
            state.progress_map.write().await.remove(status_key);
            server_log!("[audio-ffmpeg] conversion KO: {}", err);
            json_response(serde_json::json!({"success": false, "error": err}), StatusCode::INTERNAL_SERVER_ERROR, origin)
        }
    }
}

async fn handle_progress(
    State(state): State<ServerState>,
    Query(params): Query<IdParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = params.id.unwrap_or_default();
    let progress = state.progress_map.read().await.get(&id).copied().unwrap_or(0.0);
    let paused = state.paused_set.read().await.contains(&id);
    json_response(serde_json::json!({"progress": progress, "paused": paused}), StatusCode::OK, origin)
}

async fn handle_pause(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<PauseBody>,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = body.download_id.unwrap_or_default();
    if !valid_status_key(&id) {
        return json_response(serde_json::json!({"error": "id invalide."}), StatusCode::BAD_REQUEST, origin);
    }
    let mut set = state.paused_set.write().await;
    let first = !set.contains(&id);
    set.insert(id.clone());
    drop(set);
    if let Some(pid) = state.child_pids.read().await.get(&id).copied() {
        #[cfg(unix)]
        signal_pid(pid, libc::SIGSTOP);
        #[cfg(not(unix))]
        signal_pid(pid, 0);
    }
    server_log!("[pause] {} ({} en pause)", id, if first { "nouvelle" } else { "déjà" });
    json_response(serde_json::json!({"ok": true, "paused": true}), StatusCode::OK, origin)
}

async fn handle_resume(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<PauseBody>,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = body.download_id.unwrap_or_default();
    if !valid_status_key(&id) {
        return json_response(serde_json::json!({"error": "id invalide."}), StatusCode::BAD_REQUEST, origin);
    }
    let mut set = state.paused_set.write().await;
    let was = set.remove(&id);
    drop(set);
    if let Some(pid) = state.child_pids.read().await.get(&id).copied() {
        #[cfg(unix)]
        signal_pid(pid, libc::SIGCONT);
        #[cfg(not(unix))]
        signal_pid(pid, 0);
    }
    server_log!("[pause] {} ({} en pause)", id, if was { "plus" } else { "jamais" });
    json_response(serde_json::json!({"ok": true, "paused": false}), StatusCode::OK, origin)
}

async fn handle_open_folder(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<OpenFolderBody>,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let target = match body.folder.as_deref() {
        Some("video") => state.output_dir.join("Video"),
        Some("all") => state.output_dir.clone(),
        _ => state.output_dir.join("Audio"),
    };
    let _ = fs::create_dir_all(&target);
    #[cfg(target_os = "windows")]
    {
        let _ = new_cmd("explorer").arg(&target).spawn();
    }
    #[cfg(target_os = "android")]
    {
        server_log!("[open-folder] Android: dossier = {}", target.display());
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "android")))]
    {
        let _ = Command::new("xdg-open").arg(&target).spawn();
    }
    json_response(
        serde_json::json!({"ok": true, "path": target.to_string_lossy()}),
        StatusCode::OK,
        origin,
    )
}

async fn handle_list_folder(
    State(state): State<ServerState>,
    Query(params): Query<ListFolderParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let dir = match params.path {
        Some(p) => PathBuf::from(p),
        _ => return json_response(serde_json::json!({"error": "Paramètre 'path' manquant."}), StatusCode::BAD_REQUEST, origin),
    };
    if !is_path_allowed(&dir, &state.output_dir) {
        return json_response(serde_json::json!({"error": "Chemin non autorisé."}), StatusCode::FORBIDDEN, origin);
    }
    let kind = params.kind.as_deref().unwrap_or("audio");
    let wanted: &[&str] = if kind == "video" { VIDEO_EXT } else { AUDIO_EXT };
    let mut entries = Vec::new();
    fn walk_dir(base: &Path, wanted: &[&str], entries: &mut Vec<FileInfo>) {
        if let Ok(read_dir) = fs::read_dir(base) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    continue;
                } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if wanted.contains(&ext.to_lowercase().as_str()) {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let size_label = fs::metadata(&path)
                            .map(|m| format_size(m.len()))
                            .unwrap_or_default();
                        entries.push(FileInfo {
                            name,
                            path: path.to_string_lossy().to_string(),
                            size_label,
                        });
                    }
                }
            }
        }
    }
    walk_dir(&dir, wanted, &mut entries);
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    json_response(serde_json::json!({"files": entries}), StatusCode::OK, origin)
}

async fn handle_proxy(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<ProxyBody>,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    match body.action.as_deref() {
        Some("start") => {
            if *state.tor_enabled.read().await {
                return json_response(serde_json::json!({"enabled": true}), StatusCode::OK, origin);
            }
            let tor_path = state
                .resource_dir
                .as_ref()
                .map(|d| d.join("tor").join(if cfg!(windows) { "tor.exe" } else { "tor" }))
                .unwrap_or_else(|| PathBuf::from("tor"));
            if !tor_path.exists() {
                return json_response(serde_json::json!({"error": "Tor non configuré."}), StatusCode::INTERNAL_SERVER_ERROR, origin);
            }
            let data_dir = state
                .resource_dir
                .as_ref()
                .map(|d| d.join("tor").join("data"))
                .unwrap_or_default();
            let mut args = vec![
                "--HTTPTunnelPort".into(), "9080".into(),
                "--SocksPort".into(), "9050".into(),
                "--DataDirectory".into(), data_dir.to_string_lossy().to_string(),
            ];
            let geoip = state.resource_dir.as_ref().map(|d| d.join("tor").join("data").join("geoip"));
            let geoip6 = state.resource_dir.as_ref().map(|d| d.join("tor").join("data").join("geoip6"));
            if let Some(ref g) = geoip {
                if g.exists() {
                    args.push("--GeoIPFile".into());
                    args.push(g.to_string_lossy().to_string());
                }
            }
            if let Some(ref g) = geoip6 {
                if g.exists() {
                    args.push("--GeoIPv6File".into());
                    args.push(g.to_string_lossy().to_string());
                }
            }
            let _ = new_cmd(&tor_path).args(&args).spawn();
            let mut ready = false;
            for _ in 0..20 {
                if TcpStream::connect("127.0.0.1:9050").await.is_ok() {
                    ready = true;
                    break;
                }
                sleep(Duration::from_millis(200)).await;
            }
            if ready {
                *state.tor_enabled.write().await = true;
                json_response(serde_json::json!({"enabled": true}), StatusCode::OK, origin)
            } else {
                json_response(serde_json::json!({"error": "Tor n'a pas démarré à temps."}), StatusCode::INTERNAL_SERVER_ERROR, origin)
            }
        }
        Some("stop") => {
            *state.tor_enabled.write().await = false;
            #[cfg(target_os = "windows")]
            { let _ = new_cmd("taskkill").args(["/F", "/IM", "tor.exe"]).output().await; }
            #[cfg(not(target_os = "windows"))]
            { let _ = new_cmd("pkill").arg("tor").output().await; }
            json_response(serde_json::json!({"enabled": false}), StatusCode::OK, origin)
        }
        _ => json_response(serde_json::json!({"error": "Action inconnue."}), StatusCode::BAD_REQUEST, origin),
    }
}

async fn handle_proxy_status(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let enabled = *state.tor_enabled.read().await;
    json_response(
        serde_json::json!({
            "enabled": enabled,
            "proxy": if enabled { Some(TOR_PROXY) } else { None }
        }),
        StatusCode::OK,
        origin,
    )
}

async fn handle_user_dirs(
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    #[cfg(target_os = "android")]
    {
        json_response(
            serde_json::json!({
                "music": "/storage/emulated/0/Music",
                "videos": "/storage/emulated/0/Movies",
                "downloads": "/storage/emulated/0/Download",
            }),
            StatusCode::OK,
            origin,
        )
    }
    #[cfg(not(target_os = "android"))]
    {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        json_response(
            serde_json::json!({
                "music": if home.is_empty() { String::new() } else { format!("{}{}", home, if cfg!(windows) { "\\Music" } else { "/Music" }) },
                "videos": if home.is_empty() { String::new() } else { format!("{}{}", home, if cfg!(windows) { "\\Videos" } else { "/Videos" }) },
                "downloads": if home.is_empty() { String::new() } else { format!("{}{}", home, if cfg!(windows) { "\\Downloads" } else { "/Downloads" }) },
            }),
            StatusCode::OK,
            origin,
        )
    }
}

fn scan_walk(
    base: &Path,
    depth: usize,
    dirs: &mut Vec<FolderInfo>,
    seen: &mut HashMap<String, (bool, bool, usize)>,
    max: usize,
    max_depth: usize,
    budget: &mut ScanBudget,
) -> bool {
    if dirs.len() >= max || depth > max_depth || budget.take() {
        return false;
    }
    let entries = match fs::read_dir(base) {
        Ok(e) => e,
        Err(_) => return false,
    };
    let mut has_media_child = false;
    let base_key = base.to_string_lossy().to_string();
    for entry in entries.flatten() {
        if dirs.len() >= max || budget.take() {
            break;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let path = entry.path();
        if path.is_dir() {
            if EXCLUDED_DIRS.contains(&name_str.to_lowercase().as_str()) {
                continue;
            }
            if scan_walk(&path, depth + 1, dirs, seen, max, max_depth, budget) {
                has_media_child = true;
            }
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if AUDIO_EXT.contains(&ext_lower.as_str()) {
                let entry = seen.entry(base_key.clone()).or_insert((false, false, 0));
                entry.0 = true;
                entry.2 += 1;
            } else if VIDEO_EXT.contains(&ext_lower.as_str()) {
                let entry = seen.entry(base_key.clone()).or_insert((false, false, 0));
                entry.1 = true;
                entry.2 += 1;
            }
        }
    }
    seen.get(&base_key).map(|info| info.2 > 0 || has_media_child).unwrap_or(has_media_child)
}

async fn handle_scan_folders(
    State(_state): State<ServerState>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let dirs = tokio::task::spawn_blocking(run_scan_folders)
        .await
        .unwrap_or_default();
    json_response(serde_json::json!({"folders": dirs}), StatusCode::OK, origin)
}

fn run_local_search(query: &str) -> Vec<serde_json::Value> {
    let q = query.trim().to_lowercase();
    let mut files: Vec<serde_json::Value> = Vec::new();
    let max = 800;
    #[cfg(target_os = "android")]
    let max_depth = 8;
    #[cfg(not(target_os = "android"))]
    let max_depth = 6;
    #[cfg(target_os = "android")]
    let mut budget = ScanBudget::android();
    #[cfg(not(target_os = "android"))]
    let mut budget = ScanBudget::new();

    fn walk(
        base: &Path,
        depth: usize,
        q: &str,
        max: usize,
        files: &mut Vec<serde_json::Value>,
        max_depth: usize,
        budget: &mut ScanBudget,
    ) {
        if depth > max_depth || budget.take() {
            return;
        }
        let entries = match fs::read_dir(base) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if files.len() >= max || budget.take() {
                break;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            let path = entry.path();
            if path.is_dir() {
                if EXCLUDED_DIRS.contains(&name_str.to_lowercase().as_str()) {
                    continue;
                }
                walk(&path, depth + 1, q, max, files, max_depth, budget);
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_lowercase();
                if (AUDIO_EXT.contains(&ext_lower.as_str()) || VIDEO_EXT.contains(&ext_lower.as_str()))
                    && name_str.to_lowercase().contains(q)
                {
                    let folder = path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                    let size_label = fs::metadata(&path).map(|m| format_size(m.len())).unwrap_or_default();
                    files.push(serde_json::json!({
                        "name": name_str.to_string(),
                        "path": path.to_string_lossy().to_string(),
                        "folder": folder,
                        "size_label": size_label,
                    }));
                }
            }
        }
    }

    for r in local_roots() {
        if files.len() >= max {
            break;
        }
        walk(&r, 0, &q, max, &mut files, max_depth, &mut budget);
    }
    files.sort_by(|a, b| {
        let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        an.cmp(bn)
    });
    files
}

async fn handle_local_search(
    State(_state): State<ServerState>,
    Query(params): Query<LocalSearchParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let q = params.q.unwrap_or_default();
    if q.trim().is_empty() {
        return json_response(serde_json::json!({"files": []}), StatusCode::OK, origin);
    }
    let files = tokio::task::spawn_blocking(move || run_local_search(&q))
        .await
        .unwrap_or_default();
    json_response(serde_json::json!({"files": files}), StatusCode::OK, origin)
}

struct ScanBudget {
    entries_left: usize,
    start: Instant,
    max_elapsed: Duration,
}

impl ScanBudget {
    #[cfg(not(target_os = "android"))]
    fn new() -> Self {
        Self {
            entries_left: 500_000,
            start: Instant::now(),
            max_elapsed: Duration::from_secs(10),
        }
    }
    #[cfg(target_os = "android")]
    fn android() -> Self {
        Self {
            entries_left: 2_000_000,
            start: Instant::now(),
            max_elapsed: Duration::from_secs(30),
        }
    }
    // Consomme un "coup" (une entrée du filesystem). Renvoie true quand le
    // budget est épuisé : le walk doit s'arrêter là.
    fn take(&mut self) -> bool {
        if self.entries_left == 0 || self.start.elapsed() > self.max_elapsed {
            return true;
        }
        self.entries_left -= 1;
        false
    }
}

fn local_roots() -> Vec<PathBuf> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    let mut roots: Vec<PathBuf> = Vec::new();
    if !home.is_empty() {
        for d in &["Music", "Videos", "Downloads", "Desktop", "Documents", "Pictures"] {
            roots.push(PathBuf::from(&home).join(d));
        }
    }
    #[cfg(target_os = "windows")]
    {
        for c in b'A'..=b'Z' {
            let letter = format!("{}:", c as char);
            if letter == "C:" { continue; }
            let root = PathBuf::from(format!("{}\\", letter));
            if root.exists() {
                roots.push(root);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Android : une seule passe depuis la racine du stockage partagé.
        // Les dossiers "classiques" (Music, Download, DCIM...) sont dedans ;
        // les scanner séparément gaspillait le budget (ScanBudget) et la racine
        // n'était jamais atteinte → dossiers persos manquants dans les résultats.
        let root = PathBuf::from("/storage/emulated/0");
        if root.exists() {
            roots.push(root);
        }
    }
    roots
}

fn run_scan_folders() -> Vec<FolderInfo> {
    let mut dirs: Vec<FolderInfo> = Vec::new();
    let mut seen: HashMap<String, (bool, bool, usize)> = HashMap::new();
    let max = 5000;
    #[cfg(target_os = "android")]
    let max_depth = 8;
    #[cfg(not(target_os = "android"))]
    let max_depth = 6;
    #[cfg(target_os = "android")]
    let mut budget = ScanBudget::android();
    #[cfg(not(target_os = "android"))]
    let mut budget = ScanBudget::new();

    let roots = local_roots();

    for r in &roots {
        if dirs.len() >= max || budget.take() {
            break;
        }
        scan_walk(r, 0, &mut dirs, &mut seen, max, max_depth, &mut budget);
    }

    for (path, (has_audio, has_video, count)) in seen.iter() {
        if dirs.len() >= max { break; }
        if *count > 0 {
            let name = Path::new(path).file_name().unwrap_or_default().to_string_lossy().to_string();
            dirs.push(FolderInfo {
                path: path.clone(),
                name,
                has_audio: *has_audio,
                has_video: *has_video,
                count: *count,
            });
        }
    }
    dirs.sort_by(|a, b| a.path.cmp(&b.path));
    dirs
}

async fn handle_errlog(
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let tag = params.get("tag").map(|s| s.as_str()).unwrap_or("");
    let m = params.get("m").map(|s| s.as_str()).unwrap_or("");
    let b = params.get("b").map(|s| s.as_str()).unwrap_or("");
    let when = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let line = format!("[errlog {}] tag={} m={} href={}\n", when, tag, m, b);
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/storage/emulated/0/Download/mediacli_crash.txt")
        .map(|mut f| {
            use std::io::Write as _;
            let _ = f.write_all(line.as_bytes());
        });
    json_response(serde_json::json!({"ok": true}), StatusCode::OK, origin)
}

async fn handle_ping(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let ytdlp = yt_dlp_path(&state);
    server_log!("[ping] pong");
    json_response(
        serde_json::json!({
            "ok": true,
            "tor_enabled": *state.tor_enabled.read().await,
            "yt_dlp_path": ytdlp,
            "resource_dir": state.resource_dir.as_ref().map(|p| p.to_string_lossy().to_string()),
        }),
        StatusCode::OK,
        origin,
    )
}

async fn debug_fetch_range(client: &reqwest::Client, url: &str, range: &str, cap: u64) -> (String, u64, u64) {
    let resp = client
        .get(url)
        .header("User-Agent", UA)
        .header("Referer", "https://www.youtube.com/")
        .header("Origin", "https://www.youtube.com")
        .header("Range", range)
        .send()
        .await;
    let mut resp = match resp {
        Ok(r) => r,
        Err(e) => return (format!("req_err:{}", e), 0, 0),
    };
    let status = resp.status().as_u16().to_string();
    let mut got: u64 = 0;
    while let Ok(Some(chunk)) = resp.chunk().await {
        got += chunk.len() as u64;
        if got >= cap {
            break;
        }
    }
    let cr = resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("").to_string();
    (status, got, cr.split('/').last().and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0))
}

async fn handle_debug_ffmpeg(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let mut results = serde_json::json!({});

    let ffmpeg = ffmpeg_path(&state);
    results["ffmpeg_path"] = serde_json::json!(ffmpeg);

    #[cfg(target_os = "android")]
    {
        use std::os::unix::fs::PermissionsExt;
        let p = std::path::Path::new(&ffmpeg);
        if let Ok(md) = std::fs::metadata(p) {
            results["mode"] = serde_json::json!(format!("{:o}", md.permissions().mode()));
            results["len"] = serde_json::json!(md.len());
        } else {
            results["mode"] = serde_json::json!("metadata KO");
        }

        let mounts = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
        let data_line = mounts.lines().find(|l| l.starts_with("/dev/block/") && l.contains(" /data ")).unwrap_or("");
        results["data_mount"] = serde_json::json!(data_line);

        let mut spawn_ok = Vec::new();
        let r1 = tokio::process::Command::new("/system/bin/toybox").arg("id").output().await;
        spawn_ok.push(serde_json::json!({"cmd": "toybox id", "ok": r1.is_ok(), "err": r1.err().map(|e| e.to_string())}));

        let chmod = tokio::process::Command::new("/system/bin/chmod").arg("755").arg(&ffmpeg).output().await;
        spawn_ok.push(serde_json::json!({"cmd": "chmod 755", "ok": chmod.is_ok(), "out": chmod.as_ref().ok().map(|o| String::from_utf8_lossy(&o.stderr).to_string())}));

        let mut cmd = tokio::process::Command::new(&ffmpeg);
        cmd.arg("-version");
        if let Some(dir) = std::path::Path::new(&ffmpeg).parent() {
            cmd.env("LD_LIBRARY_PATH", dir);
        }
        let r2 = cmd.output().await;
        spawn_ok.push(serde_json::json!({"cmd": "ffmpeg -version", "ok": r2.is_ok(), "err": r2.as_ref().err().map(|e| e.to_string()), "out": r2.as_ref().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string().chars().take(80).collect::<String>())}));

        let r3 = tokio::process::Command::new("/system/bin/sh").arg("-c").arg("echo hello").output().await;
        spawn_ok.push(serde_json::json!({"cmd": "sh -c echo", "ok": r3.is_ok(), "err": r3.err().map(|e| e.to_string())}));

        results["spawn"] = serde_json::json!(spawn_ok);
    }

    json_response(results, StatusCode::OK, origin)
}

async fn handle_debug_audio(
    State(state): State<ServerState>,
    Query(params): Query<DelayParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = match params.id {
        Some(id) if is_valid_video_id(&id) => id,
        _ => return json_response(serde_json::json!({"error": "videoId invalide"}), StatusCode::BAD_REQUEST, origin),
    };
    let delay = params.delay.unwrap_or(0);
    let client = &state.client;
    server_log!("[debug-audio] Testing audio ranges for {}", id);

    let key = state.innertube_key.as_deref().unwrap_or("AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");
    let url = (|| async {
        if let Ok(data) = innertube_android_request(client, "player", key, serde_json::json!({ "videoId": id })).await {
            if data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("") == "OK" {
                if let Some(res) = pick_audio_format(&data, client, &state).await {
                    return Some(res.0);
                }
            }
        }
        None
    })().await;

    let mut results = serde_json::json!({"id": id});
    let url = match url {
        Some(u) => u,
        None => {
            results["error"] = serde_json::json!("no audio url");
            return json_response(results, StatusCode::OK, origin);
        }
    };
    results["host"] = serde_json::json!(url.split('/').nth(2).unwrap_or(""));
    results["total"] = serde_json::json!(0);

    let (s, g, cr) = debug_fetch_range(client, &url, "bytes=0-262143", 1_000_000).await;
    results["r_256k"] = serde_json::json!({"status": s, "got": g, "cr_total": cr});
    let total = cr;

    if total > 0 {
        results["total"] = serde_json::json!(total);
        let (s, g, _) = debug_fetch_range(client, &url, &format!("bytes=0-{}", total - 1), 1_500_000).await;
        results["r_full_bounded"] = serde_json::json!({"status": s, "got": g});
    }
    let (s, g, _) = debug_fetch_range(client, &url, "bytes=0-", 1_500_000).await;
    results["r_open"] = serde_json::json!({"status": s, "got": g});

    let mut chunks: Vec<serde_json::Value> = Vec::new();
    let mut start: u64 = 0;
    let mut ok_count = 0;
    loop {
        let end = start + 255999;
        let (s, g, cr) = debug_fetch_range(client, &url, &format!("bytes={}-{}", start, end), 1_000_000).await;
        chunks.push(serde_json::json!({"start": start, "status": s, "got": g, "cr_total": cr}));
        if s.starts_with("2") {
            ok_count += 1;
            start += 256000;
            if ok_count >= 8 || (total > 0 && start >= total) {
                break;
            }
        } else {
            break;
        }
    }
    results["chunks_256k"] = serde_json::json!(chunks);
    results["chunks_ok"] = serde_json::json!(ok_count);

    if ok_count > 0 && ok_count < 8 {
        if let Ok(data) = innertube_android_request(client, "player", key, serde_json::json!({ "videoId": id })).await {
            if data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("") == "OK" {
                if let Some(res) = pick_audio_format(&data, client, &state).await {
                    let fresh = res.0;
                    let (s, g, _) = debug_fetch_range(client, &fresh, "bytes=0-255999", 1_000_000).await;
                    results["fresh_url_after_cap"] = serde_json::json!({"status": s, "got": g, "host": fresh.split('/').nth(2).unwrap_or("")});
                }
            }
        }
    }

    if delay > 0 && ok_count > 0 {
        server_log!("[debug-audio] sleeping {}s before retry at high offset", delay);
        sleep(Duration::from_secs(delay)).await;
        let start = ok_count as u64 * 256_000;
        let mut arr: Vec<serde_json::Value> = Vec::new();
        for attempt in 1..=2 {
            let (u, _e, _t) = match resolve_audio_url(&state, &id).await {
                Some(x) => x,
                None => break,
            };
            let range = format!("bytes={}-{}", start, start + 255999);
            let (s, g, _) = debug_fetch_range(client, &u, &range, 1_000_000).await;
            arr.push(serde_json::json!({"attempt": attempt, "offset": start, "status": s, "got": g}));
            if s.starts_with("2") {
                break;
            }
            sleep(Duration::from_secs(5)).await;
        }
        results["after_delay"] = serde_json::json!(arr);
    }

    server_log!("[debug-audio] done for {}", id);
    json_response(results, StatusCode::OK, origin)
}

async fn handle_debug_audio2(
    State(state): State<ServerState>,
    Query(params): Query<IdParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = match params.id {
        Some(id) if is_valid_video_id(&id) => id,
        _ => return json_response(serde_json::json!({"error": "videoId invalide"}), StatusCode::BAD_REQUEST, origin),
    };
    let client = &state.client;
    let key = state.innertube_key.as_deref().unwrap_or("AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");
    let mut results = serde_json::json!({"id": id});
    server_log!("[debug-audio2] testing audio ranges multi-client pour {}", id);

    let clients: Vec<(String, String, String, String, String, serde_json::Value)> = vec![
        (
            "android_vr".to_string(), "ANDROID_VR".to_string(), "1.57.29".to_string(), "28".to_string(),
            "com.google.android.apps.youtube.vr.oculus/1.57.29 (Linux; U; Android 12; eureka-user Build/SQ3A.220605.009.A1) gzip".to_string(),
            serde_json::json!({ "videoId": id, "contentCheckOk": true, "racyCheckOk": true }),
        ),
        (
            "ios".to_string(), IOS_CLIENT_NAME.to_string(), IOS_CLIENT_VERSION.to_string(), "5".to_string(),
            "com.google.ios.youtube/21.10.2 (iPhone14,3; U; CPU iOS 18_2 like Mac OS X)".to_string(),
            serde_json::json!({ "videoId": id, "deviceMake": "Apple", "deviceModel": IOS_DEVICE_MODEL, "osName": "iPhone", "osVersion": "18.2" }),
        ),
        (
            "web_embedded".to_string(), "WEB_EMBEDDED_PLAYER".to_string(), "1.20240620".to_string(), "56".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36".to_string(),
            serde_json::json!({ "videoId": id, "contentCheckOk": true, "racyCheckOk": true,
                "playbackContext": { "contentPlaybackContext": { "signatureTimestamp": 20073 } } }),
        ),
        (
            "tv".to_string(), "TVHTML5".to_string(), "7.20240723.10.00".to_string(), "7".to_string(),
            "Mozilla/5.0".to_string(),
            serde_json::json!({ "videoId": id, "contentCheckOk": true, "racyCheckOk": true }),
        ),
        (
            "web".to_string(), "WEB".to_string(), "2.20240101.00.00".to_string(), "5".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36".to_string(),
            serde_json::json!({ "videoId": id, "contentCheckOk": true, "racyCheckOk": true }),
        ),
    ];

    let mut clients_out: Vec<serde_json::Value> = Vec::new();
    for (name, cname, cver, key_attr, ua, ctx) in clients {
        let data = innertube_client_request(client, "player", key, &cname, &cver, &key_attr, &ua, ctx).await;
        let data = match data {
            Ok(d) => d,
            Err(e) => {
                clients_out.push(serde_json::json!({"client": name, "status": format!("req_err:{}", e)}));
                continue;
            }
        };
        let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
        if status != "OK" {
            clients_out.push(serde_json::json!({"client": name, "status": status}));
            continue;
        }
        match pick_audio_format(&data, client, &state).await {
            Some((u, ext)) => {
                let r0 = debug_fetch_range(client, &u, "bytes=0-262143", 1_000_000).await;
                let r1m = debug_fetch_range(client, &u, "bytes=1048576-1310719", 1_000_000).await;
                let r20m = debug_fetch_range(client, &u, "bytes=20971520-21233663", 1_000_000).await;
                clients_out.push(serde_json::json!({
                    "client": name, "status": status, "ext": ext,
                    "host": u.split('/').nth(2).unwrap_or(""),
                    "r_256k@0": format!("{}:{}", r0.0, r0.1),
                    "r_256k@1M": format!("{}:{}", r1m.0, r1m.1),
                    "r_256k@20M": format!("{}:{}", r20m.0, r20m.1),
                    "cr_total": r0.2,
                }));
            }
            None => {
                clients_out.push(serde_json::json!({"client": name, "status": status, "audio": "aucun format audio"}));
            }
        }
        if let Some((u, ext, itag)) = pick_lowest_progressive(&data, client, &state).await {
            let r0 = debug_fetch_range(client, &u, "bytes=0-262143", 1_000_000).await;
            let r1m = debug_fetch_range(client, &u, "bytes=1048576-1310719", 1_000_000).await;
            let r20m = debug_fetch_range(client, &u, "bytes=20971520-21233663", 1_000_000).await;
            clients_out.push(serde_json::json!({
                "client": name, "type": "progressif", "itag": itag, "ext": ext,
                "host": u.split('/').nth(2).unwrap_or(""),
                "r_256k@0": format!("{}:{}", r0.0, r0.1),
                "r_256k@1M": format!("{}:{}", r1m.0, r1m.1),
                "r_256k@20M": format!("{}:{}", r20m.0, r20m.1),
                "cr_total": r0.2,
            }));
        }
    }
    results["clients"] = serde_json::json!(clients_out);

    match innertube_android_request(client, "player", key, serde_json::json!({ "videoId": id })).await {
        Ok(data) => {
            let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            if status == "OK" {
                if let Some((u, ext)) = pick_audio_format(&data, client, &state).await {
                    let r0 = debug_fetch_range(client, &u, "bytes=0-262143", 1_000_000).await;
                    let r1m = debug_fetch_range(client, &u, "bytes=1048576-1310719", 1_000_000).await;
                    clients_out.push(serde_json::json!({
                        "client": "android", "status": status, "ext": ext,
                        "host": u.split('/').nth(2).unwrap_or(""),
                        "r_256k@0": format!("{}:{}", r0.0, r0.1),
                        "r_256k@1M": format!("{}:{}", r1m.0, r1m.1),
                        "cr_total": r0.2,
                    }));
                }
                if let Some((u, ext, itag)) = pick_lowest_progressive(&data, client, &state).await {
                    let r0 = debug_fetch_range(client, &u, "bytes=0-262143", 1_000_000).await;
                    let r1m = debug_fetch_range(client, &u, "bytes=1048576-1310719", 1_000_000).await;
                    let r20m = debug_fetch_range(client, &u, "bytes=20971520-21233663", 1_000_000).await;
                    clients_out.push(serde_json::json!({
                        "client": "android", "type": "progressif", "itag": itag, "ext": ext,
                        "host": u.split('/').nth(2).unwrap_or(""),
                        "r_256k@0": format!("{}:{}", r0.0, r0.1),
                        "r_256k@1M": format!("{}:{}", r1m.0, r1m.1),
                        "r_256k@20M": format!("{}:{}", r20m.0, r20m.1),
                        "cr_total": r0.2,
                    }));
                }
            }
        }
        Err(e) => server_log!("[debug-audio2] android req_err: {}", e),
    }
    results["clients"] = serde_json::json!(clients_out);

    if let Some(u) = resolve_stream_url(&state, &id).await {
        let r0 = debug_fetch_range(client, &u, "bytes=0-262143", 1_000_000).await;
        let r1m = debug_fetch_range(client, &u, "bytes=1048576-1310719", 1_000_000).await;
        let r20m = debug_fetch_range(client, &u, "bytes=20971520-21233663", 1_000_000).await;
        results["muxed_stream"] = serde_json::json!({
            "host": u.split('/').nth(2).unwrap_or(""),
            "r_256k@0": format!("{}:{}", r0.0, r0.1),
            "r_256k@1M": format!("{}:{}", r1m.0, r1m.1),
            "r_256k@20M": format!("{}:{}", r20m.0, r20m.1),
        });
    }

    server_log!("[debug-audio2] done for {}", id);
    json_response(results, StatusCode::OK, origin)
}

async fn handle_debug_stream(
    State(state): State<ServerState>,
    Query(params): Query<IdParams>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let id = match params.id {
        Some(id) if is_valid_video_id(&id) => id,
        _ => return json_response(serde_json::json!({"error": "videoId invalide"}), StatusCode::BAD_REQUEST, origin),
    };
    let mut results = serde_json::json!({"id": id});

    let client = &state.client;

    server_log!("[debug] Testing stream for {}", id);

    let wp = watch_page_stream(client, &id).await;
    match wp {
        Ok(data) => {
            let has_streaming = data.get("streamingData").is_some();
            let status = data.get("playabilityStatus").and_then(|s| s.get("status")).and_then(|v| v.as_str()).unwrap_or("unknown");
            let reason = data.get("playabilityStatus").and_then(|s| s.get("reason")).and_then(|v| v.as_str()).unwrap_or("");
            results["watch_page_status"] = serde_json::json!(status);
            results["watch_page_reason"] = serde_json::json!(reason);
            results["has_streaming_data"] = serde_json::json!(has_streaming);
            if has_streaming {
                let streaming = data.get("streamingData").unwrap();
                let fmt_count = streaming.get("formats").and_then(|f| f.as_array()).map(|a| a.len()).unwrap_or(0);
                let adaptive_count = streaming.get("adaptiveFormats").and_then(|f| f.as_array()).map(|a| a.len()).unwrap_or(0);
                let dash_url = streaming.get("dashManifestUrl").and_then(|v| v.as_str()).map(String::from);
                let hls_url = streaming.get("hlsManifestUrl").and_then(|v| v.as_str()).map(String::from);
                let expir = streaming.get("expiresInSeconds").and_then(|v| v.as_str()).map(String::from);
                results["formats_count"] = serde_json::json!(fmt_count);
                results["adaptive_count"] = serde_json::json!(adaptive_count);
                if let Some(u) = dash_url { results["dash_url"] = serde_json::json!(u); }
                if let Some(u) = hls_url { results["hls_url"] = serde_json::json!(u); }
                if let Some(e) = expir { results["expires_in"] = serde_json::json!(e); }
                let streaming_keys: Vec<String> = streaming.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
                results["streaming_keys"] = serde_json::json!(streaming_keys);
                if let Some(url) = pick_stream_url_from_data(&data, client, &state).await {
                    results["resolved_url"] = serde_json::json!(url.chars().take(200).collect::<String>());
                    results["url_length"] = serde_json::json!(url.len());
                    server_log!("[debug] URL resolved OK, length={}", url.len());
                } else {
                    results["resolved_url"] = serde_json::json!("FAILED");
                    server_log!("[debug] pick_stream_url_from_data FAILED");
                }
            }
        }
        Err(e) => {
            results["watch_page_error"] = serde_json::json!(e);
            server_log!("[debug] watch_page_stream error: {}", e);
        }
    }

    json_response(results, StatusCode::OK, origin)
}

async fn handle_request_permissions(
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    #[cfg(target_os = "android")]
    {
        let _ = tokio::process::Command::new("/system/bin/am")
            .args([
                "start", "-a", "android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION",
                "-d", "package:com.johnsheer.mediacli"
            ])
            .output()
            .await;
        json_response(serde_json::json!({"ok": true, "message": "Settings ouvert."}), StatusCode::OK, origin)
    }
    #[cfg(not(target_os = "android"))]
    {
        json_response(serde_json::json!({"ok": true, "message": "Permissions OK sur desktop."}), StatusCode::OK, origin)
    }
}

// ─── SERVER STARTUP ───

pub async fn start_server(output_dir: PathBuf, resource_dir: Option<PathBuf>) {
    let innertube_key = std::env::var("YOUTUBE_INNERTUBE_KEY")
        .ok()
        .or_else(|| Some("AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8".to_string()));

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    server_log!("[server] state en construction");

    let state = ServerState {
        output_dir,
        resource_dir,
        search_cache: Arc::new(RwLock::new(HashMap::new())),
        stream_cache: Arc::new(RwLock::new(HashMap::new())),
        progress_map: Arc::new(RwLock::new(HashMap::new())),
        paused_set: Arc::new(RwLock::new(HashSet::new())),
        child_pids: Arc::new(RwLock::new(HashMap::new())),
        tor_enabled: Arc::new(RwLock::new(false)),
        innertube_key,
        player_script_cache: Arc::new(RwLock::new(None)),
        n_transform_cache: Arc::new(RwLock::new(None)),
        sig_ops_cache: Arc::new(RwLock::new(None)),
        client,
    };

    let app = Router::new()
        .route("/search", get(handle_search))
        .route("/thumb", get(handle_thumb))
        .route("/stream", get(handle_stream))
        .route("/stream-tor", get(handle_stream_tor))
        .route("/preload-stream", get(handle_preload_stream))
        .route("/local", get(handle_local))
        .route("/list-folder", get(handle_list_folder))
        .route("/scan-folders", get(handle_scan_folders))
        .route("/local-search", get(handle_local_search))
        .route("/download", post(handle_download).options(handle_options))
        .route("/download-pause", post(handle_pause).options(handle_options))
        .route("/download-resume", post(handle_resume).options(handle_options))
        .route("/progress", get(handle_progress))
        .route("/open-folder", post(handle_open_folder).options(handle_options))
        .route("/proxy", post(handle_proxy).options(handle_options))
        .route("/proxy-status", get(handle_proxy_status))
        .route("/user-dirs", get(handle_user_dirs))
        .route("/ping", get(handle_ping))
        .route("/netprobe", get(handle_netprobe))
        .route("/errlog", get(handle_errlog).options(handle_options))
        .route("/debug-stream", get(handle_debug_stream))
        .route("/debug-audio", get(handle_debug_audio))
        .route("/debug-audio2", get(handle_debug_audio2))
        .route("/debug-ffmpeg", get(handle_debug_ffmpeg))
        .route("/request-permissions", get(handle_request_permissions))
        .layer(middleware::from_fn(log_requests))
        .with_state(state);

    server_log!("[server] router ok");

    let addr = format!("127.0.0.1:{}", PORT);
    server_log!("[server] prepare serve (timer/rotation actifs)");

    {
        server_log!("[server] selftest outbound TCP 127.0.0.1:8787 (3s)...");
        match tokio::time::timeout(
            Duration::from_secs(3),
            tokio::net::TcpStream::connect(("127.0.0.1", PORT)),
        )
        .await
        {
            Ok(Ok(stream)) => {
                if let Ok(la) = stream.local_addr() {
                    server_log!("[server] selftest OUTBOUND OK local={}", la);
                }
                drop(stream);
            }
            Ok(Err(e)) => server_log!("[server] selftest OUTBOUND ERR {}", e),
            Err(_) => server_log!("[server] selftest OUTBOUND TIMEOUT => IO driver suspect"),
        }
    }

    {
        let hb_path = String::from("/storage/emulated/0/Download/mediacli_crash.txt");
        tokio::spawn(async move {
            let mut i: u32 = 0;
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                i += 1;
                let msg = format!("[server] heartbeat #{}\n", i);
                eprintln!("{}", msg.trim_end());
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&hb_path)
                {
                    use std::io::Write;
                    let _ = f.write_all(msg.as_bytes());
                }
            }
        });
    }

    loop {
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", PORT)).await {
            Ok(l) => l,
            Err(e) => {
                server_log!("[wdt] bind ERR {} — retry dans 2 s", e);
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };
        server_log!("[server] bind ok {} (cycle serve)", addr);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        *WATCHDOG_TX.lock().await = Some(tx);
        server_log!("[server] axum serve lancé");
        let _ = axum::serve(listener, app.clone())
            .with_graceful_shutdown(async move {
                let _ = rx.recv().await;
            })
            .await;
        server_log!("[wdt] serve terminé — rotation");
        tokio::time::sleep(Duration::from_millis(800)).await;
    }
}

/// Canal de rotation : le thread superviseur envoie un signal pour déclencher
/// l'arrêt gracieux + relance du serveur axum quand /ping ne répond plus.
static WATCHDOG_TX: std::sync::LazyLock<
    tokio::sync::Mutex<Option<tokio::sync::mpsc::UnboundedSender<()>>>,
> = std::sync::LazyLock::new(|| tokio::sync::Mutex::new(None));

/// Date (unix, secondes) de la dernière requête HTTP reçue par le serveur.
/// Permet au watchdog de ne JAMAIS tourner tant que le serveur reçoit du
/// trafic (une panne de sonde alors que l'UI parle au serveur = faux positif).
static LAST_HTTP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Nombre de requêtes HTTP en cours de traitement. Tant que > 0, le serveur
/// accepte et traite : les échecs de sonde sont des faux positifs et le
/// watchdog se met en veille (aucune rotation).
static ACTIVE_REQUESTS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Sonde simple d'un "GET /ping" en std bloquant depuis le thread superviseur.
fn probe_ping() -> bool {
    use std::io::{Read, Write};
    use std::net::Shutdown;
    let dst: std::net::SocketAddr = "127.0.0.1:8787".parse().unwrap();
    if let Ok(mut s) =
        std::net::TcpStream::connect_timeout(&dst, Duration::from_millis(800))
    {
        let _ = s.set_read_timeout(Some(Duration::from_secs(4)));
        let _ = s.write_all(b"GET /ping HTTP/1.0\r\nHost: watchdog\r\n\r\n");
        let mut buf = [0u8; 64];
        match s.read(&mut buf) {
            Ok(n) if n > 0 => true,
            _ => {
                let _ = s.shutdown(Shutdown::Both);
                false
            }
        }
    } else {
        false
    }
}

/// Espace libre (octets) sur le volume contenant `dir`, si mesurable.
#[cfg(unix)]
fn free_space_bytes(dir: &std::path::Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut vfs = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    let ret = unsafe { libc::statvfs(c.as_ptr(), vfs.as_mut_ptr()) };
    if ret != 0 {
        return None;
    }
    let vfs = unsafe { vfs.assume_init() };
    Some(vfs.f_bavail.saturating_mul(vfs.f_frsize))
}
#[cfg(not(unix))]
fn free_space_bytes(_dir: &std::path::Path) -> Option<u64> {
    None
}

/// Supprime les fichiers temporaires `.tmp_*` orphelins (crash, processus tué
/// par Android, redémarrage) qui consomment l'espace d'écriture. Appelé au
/// démarrage du serveur pour redonner un disque propre.
fn cleanup_orphan_temp(output_dir: &std::path::Path) {
    for sub in ["Audio", "Video"] {
        let dir = output_dir.join(sub);
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut removed = 0u32;
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with(".tmp_") {
                if std::fs::remove_file(e.path()).is_ok() {
                    removed += 1;
                }
            }
        }
        if removed > 0 {
            server_log!("[cleanup] {} fichier(s) temporaire(s) orphelin(s) supprimé(s) dans {}", removed, dir.display());
        }
    }
}

/// Démarre le serveur sur un runtime Tokio dédié (thread std), indépendant de
/// `tauri::async_runtime` dont le driver IO peut être défaillant sur Android.
pub fn run_server_sync(output_dir: PathBuf, resource_dir: Option<PathBuf>) -> ! {
    cleanup_orphan_temp(&output_dir);
    crashlog("[stdprobe] start");
    std::thread::spawn(|| {
        let listener = match std::net::TcpListener::bind("127.0.0.1:9090") {
            Ok(l) => l,
            Err(e) => {
                crashlog(&format!("[stdprobe] bind 9090 ERR {}", e));
                return;
            }
        };
        crashlog("[stdprobe] bind 9090 ok, serving blocking...");
        use std::io::Write;
        loop {
            match listener.accept() {
                Ok((mut sock, _)) => {
                    crashlog("[stdprobe] accepted conn");
                    let _ = sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nPONG\n");
                }
                Err(e) => crashlog(&format!("[stdprobe] accept ERR {}", e)),
            }
        }
    });
    std::thread::spawn(|| {
        use std::io::Read;
        crashlog("[stdprobe] outbound std connect to 9090...");
        match std::net::TcpStream::connect("127.0.0.1:9090") {
            Ok(mut s) => {
                let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
                let mut buf = [0u8; 64];
                let n = s.read(&mut buf).unwrap_or(0);
                let got = String::from_utf8_lossy(&buf[..n.min(buf.len())]).to_string();
                crashlog(&format!("[stdprobe] outbound std OK => {:?}", got));
            }
            Err(e) => crashlog(&format!("[stdprobe] outbound std ERR {}", e)),
        }
    });

    // ─── Superviseur / watchdog ───
    // Sonde /ping sur 8787 toutes les 10 s. Ne compte un échec que s'il survient
    // dans une fenêtre de 90 s (un device endormi gèle les sockets loopback sans
    // que le serveur soit mort : une sieste longue ne doit PAS déclencher de
    // rotation qui n'aurait aucun effet). Sur 3 échecs consécutifs rapprochés:
    // rotation gracieuse (nouveau bind + nouveau serve) avec cooldown 240 s.
    // Après 3 rotations, pause longue (5 min) avant de re-tester.
    // Le process n'est JAMAIS arrêté : une fois le serveur réchauffé, il reparle.
    std::thread::spawn(|| {
        let started = Instant::now();
        let mut fails: u32 = 0;
        let mut rotations: u32 = 0;
        let mut last_fail: Option<Instant> = None;
        let mut last_rotation: Option<Instant> = None;

        loop {
            std::thread::sleep(Duration::from_secs(10));
            // Si le serveur reçoit du trafic (< 90 s), il est vivant : les échecs
            // de sonde sont des faux positifs (chargement, sieste) — on ne compte
            // rien et on recommence.
            let now_secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let last_http = LAST_HTTP.load(std::sync::atomic::Ordering::Relaxed);
            // Requête en cours (stream, download, resolve...) : le serveur est
            // vivant par construction — aucune sonde, aucun comptage.
            if ACTIVE_REQUESTS.load(std::sync::atomic::Ordering::Relaxed) > 0 {
                fails = 0;
                last_fail = None;
                continue;
            }
            if last_http != 0 && now_secs.saturating_sub(last_http) < 90 {
                fails = 0;
                last_fail = None;
                continue;
            }
            if let Some(lf) = last_fail {
                if lf.elapsed() > Duration::from_secs(90) {
                    // Sieste du device / longue coupure : on repart de zéro.
                    fails = 0;
                    last_fail = None;
                }
            }
            if probe_ping() {
                fails = 0;
                last_fail = None;
                continue;
            }
            fails += 1;
            last_fail = Some(Instant::now());
            if fails >= 3 {
                // Période de grâce au démarrage : au boot, Android met ~2 min à provisionner
// le réseau de l'app (netd) — PENDANT CE TEMPS AUSSI le réseau loopback est
// en file d'attente : selftest, sondes et connexions WebView échouent tous.
// On n'agit donc JAMAIS pendant les 180 premières secondes.
                if started.elapsed() < Duration::from_secs(180) {
                    crashlog(&format!(
                        "[wdt] probe échouée #{}/{} — grâce démarrage {}s, on retarde",
                        fails, fails, started.elapsed().as_secs()
                    ));
                    fails = 0;
                    last_fail = None;
                    std::thread::sleep(Duration::from_secs(20));
                    continue;
                }
                // Cooldown entre rotations : ne jamais enchaîner sans répit.
                if let Some(lr) = last_rotation {
                    if lr.elapsed() < Duration::from_secs(240) {
                        crashlog(&format!(
                            "[wdt] probe échouée #{}/{} — cooldown rotation ({}s restantes), on retarde",
                            fails, fails, 240 - lr.elapsed().as_secs()
                        ));
                        fails = 0;
                        last_fail = None;
                        std::thread::sleep(Duration::from_secs(30));
                        continue;
                    }
                }
                if rotations >= 3 {
                    crashlog("[wdt] 3 rotations déjà tentées — pause longue 5 min avant re-test");
                    rotations = 0;
                    fails = 0;
                    last_fail = None;
                    std::thread::sleep(Duration::from_secs(300));
                    continue;
                }
                match WATCHDOG_TX.try_lock() {
                    Ok(mut guard) => {
                        if let Some(tx) = guard.take() {
                            let _ = tx.send(());
                            crashlog(&format!("[wdt] rotation demandée (signal envoyé, total {})", rotations + 1));
                            rotations += 1;
                            fails = 0;
                            last_fail = None;
                            last_rotation = Some(Instant::now());
                        } else {
                            crashlog("[wdt] aucun canal serveur enregistré (bind en cours ?)");
                            fails = 1;
                        }
                    }
                    Err(_) => {
                        fails = 1;
                    }
                }
            }
        }
    });

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(8)
        .enable_all()
        .build()
        .expect("build dedicated tokio runtime");
    rt.block_on(async move {
        {
            crashlog("[tokioprobe] outbound tokio 192.168.137.1:8080 (3s)...");
            match tokio::time::timeout(
                Duration::from_secs(3),
                tokio::net::TcpStream::connect("192.168.137.1:8080"),
            )
            .await
            {
                Ok(Ok(_s)) => crashlog("[tokioprobe] tokio->192.168.137.1:8080 CONNECT OK"),
                Ok(Err(e)) => crashlog(&format!("[tokioprobe] tokio->hotspot ERR {}", e)),
                Err(_) => crashlog("[tokioprobe] tokio->hotspot TIMEOUT"),
            }
        }
        start_server(output_dir, resource_dir).await;
    });
    std::process::exit(0);
}

fn crashlog(msg: &str) {
    const PATH: &str = "/storage/emulated/0/Download/mediacli_crash.txt";
    eprintln!("{}", msg.trim_end());
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(PATH) {
        let _ = f.write_all((msg.to_string() + "\n").as_bytes());
    }
}
