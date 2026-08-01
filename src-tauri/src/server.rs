use async_stream::stream;
use axum::{
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
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
    collections::HashMap,
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
];

const WEB_CLIENT_NAME: &str = "WEB";
const WEB_CLIENT_VERSION: &str = "2.20240610.00.00";
const ANDROID_CLIENT_NAME: &str = "ANDROID";
const ANDROID_CLIENT_VERSION: &str = "19.09.37";
const TV_EMBEDDED_CLIENT_NAME: &str = "TVHTML5_SIMPLY_EMBEDDED_PLAYER";
const TV_EMBEDDED_CLIENT_VERSION: &str = "2.0";
const IOS_CLIENT_NAME: &str = "IOS";
const IOS_CLIENT_VERSION: &str = "19.09.3";
const IOS_DEVICE_MODEL: &str = "iPhone14,3";

#[derive(Clone)]
struct ServerState {
    output_dir: PathBuf,
    resource_dir: Option<PathBuf>,
    search_cache: Arc<RwLock<HashMap<String, (Instant, serde_json::Value)>>>,
    stream_cache: Arc<RwLock<HashMap<String, (Instant, String)>>>,
    progress_map: Arc<RwLock<HashMap<String, f64>>>,
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
struct IdParams {
    id: Option<String>,
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
    video_id: String,
    title: String,
    format: Option<String>,
}

#[derive(Deserialize)]
struct OpenFolderBody {
    folder: Option<String>,
}

#[derive(Deserialize)]
struct ProxyBody {
    action: Option<String>,
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
        .send()
        .await
        .map_err(|e| format!("InnerTube request failed: {}", e))?;
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
                "clientName": "ANDROID_TESTSUITE",
                "clientVersion": "1.9",
                "androidSdkVersion": 30,
                "hl": "en",
                "gl": "US",
                "osName": "Android",
                "osVersion": "11"
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
        .header("User-Agent", "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip")
        .header("X-YouTube-Client-Name", "30")
        .header("X-YouTube-Client-Version", "1.9")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("InnerTube Android request failed: {}", e))?;
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
        .send()
        .await
        .map_err(|e| format!("InnerTube {} request failed: {}", client_name, e))?;
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
    let mut results = Vec::new();
    let sections = data
        .pointer("/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for sec in &sections {
        let items = sec
            .pointer("/itemSectionRenderer/contents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for item in &items {
            if let Some(v) = item.get("videoRenderer") {
                let dur_text = v
                    .pointer("/lengthText/simpleText")
                    .and_then(|t| t.as_str())
                    .unwrap_or("0:00");
                let id = v
                    .get("videoId")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                let title = v
                    .pointer("/title/runs")
                    .and_then(|runs| runs.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .or_else(|| v.pointer("/title/simpleText").and_then(|t| t.as_str()).map(String::from))
                    .unwrap_or_else(|| "Sans titre".into());
                let thumbnail = v
                    .pointer("/thumbnail/thumbnails")
                    .and_then(|t| t.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t.get("url").and_then(|u| u.as_str()))
                    .map(String::from);
                let channel = v
                    .pointer("/ownerText/runs")
                    .and_then(|runs| runs.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .or_else(|| {
                        v.pointer("/shortBylineText/runs")
                            .and_then(|runs| runs.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                                    .collect::<Vec<_>>()
                                    .join("")
                            })
                    })
                    .unwrap_or_else(|| "Inconnu".into());
                results.push(SearchResult {
                    id,
                    title,
                    duration: parse_duration(dur_text),
                    thumbnail,
                    channel,
                });
                if results.len() >= limit {
                    break;
                }
            }
        }
        if results.len() >= limit {
            break;
        }
    }
    Ok(results)
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
            match resp.bytes().await {
                Ok(bytes) => {
                    server_log!("[proxy] OK {} bytes, status={}", bytes.len(), code);
                    (status, h, bytes.to_vec()).into_response()
                }
                Err(e) => {
                    server_log!("[proxy] bytes error: {}", e);
                    json_response(
                        serde_json::json!({"error": "Erreur de proxy stream."}),
                        StatusCode::BAD_GATEWAY,
                        origin,
                    )
                }
            }
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
        "com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)",
        serde_json::json!({ "videoId": video_id, "deviceMake": "Apple", "deviceModel": IOS_DEVICE_MODEL, "osName": "iPhone", "osVersion": "15.6.0.19G71" }),
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
        .map_err(|e| format!("InnerTube TV embedded request failed: {}", e))?;
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
    state
        .resource_dir
        .as_ref()
        .map(|d| {
            let p = d.join("ffmpeg.exe");
            if p.exists() {
                p.to_string_lossy().to_string()
            } else {
                let p = d.join("ffmpeg");
                if p.exists() {
                    p.to_string_lossy().to_string()
                } else {
                    "ffmpeg".into()
                }
            }
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
    .ok()?
    .ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Some(stdout);
        }
    }
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
            Ok(r) => {
                if !r.is_empty() {
                    Ok(r)
                } else {
                    Err("No results".into())
                }
            }
            Err(e) => Err(e),
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
    let target_dir = if fmt == "video" {
        state.output_dir.join("Video")
    } else {
        state.output_dir.join("Audio")
    };
    let _ = fs::create_dir_all(&target_dir);
    let safe_title = sanitize_filename(&body.title);

    let ytdlp = yt_dlp_path(&state);
    let has_ytdlp = new_cmd(&ytdlp)
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

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
            let output = new_cmd(&ytdlp).args(&args).output().await;
            match output {
                Ok(o) if o.status.success() => {}
                _ => {
                    state.progress_map.write().await.remove(&status_key);
                    return json_response(serde_json::json!({"success": false, "error": "Erreur de téléchargement audio"}), StatusCode::INTERNAL_SERVER_ERROR, origin);
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
            let conv_output = new_cmd(&ffmpeg)
                .args([
                    "-i", &temp_file.to_string_lossy(),
                    "-vn", "-acodec", "libmp3lame", "-q:a", "2",
                    &final_path.to_string_lossy(),
                    "-y", "-loglevel", "error",
                ])
                .output()
                .await;
            let _ = fs::remove_file(&temp_file);
            match conv_output {
                Ok(o) if o.status.success() => {
                    state.progress_map.write().await.insert(status_key, 100.0);
                    json_response(serde_json::json!({"success": true, "path": final_path.to_string_lossy()}), StatusCode::OK, origin)
                }
                _ => {
                    let err = conv_output
                        .ok()
                        .map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string())
                        .unwrap_or_else(|| "Erreur de conversion MP3".into());
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
            let output = new_cmd(&ytdlp).args(&args).output().await;
            match output {
                Ok(o) if o.status.success() => {
                    state.progress_map.write().await.insert(status_key, 100.0);
                    json_response(serde_json::json!({"success": true, "path": final_path.to_string_lossy()}), StatusCode::OK, origin)
                }
                _ => {
                    let err = output
                        .ok()
                        .map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string())
                        .unwrap_or_else(|| "Erreur vidéo".into());
                    json_response(serde_json::json!({"success": false, "error": err}), StatusCode::INTERNAL_SERVER_ERROR, origin)
                }
            }
        }
    } else {
        let ext = if fmt == "video" { "mp4" } else { "webm" };
        let final_path = target_dir.join(format!("{}.{}", safe_title, ext));

        match resolve_stream_url(&state, &body.video_id).await {
            Some(stream_url) => {
                state.progress_map.write().await.insert(status_key.clone(), 20.0);
                match state.client.get(&stream_url)
                    .header("User-Agent", UA)
                    .header("Referer", "https://www.youtube.com/")
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        match resp.bytes().await {
                            Ok(bytes) => {
                                let _ = fs::write(&final_path, &bytes);
                                state.progress_map.write().await.insert(status_key, 100.0);
                                json_response(serde_json::json!({"success": true, "path": final_path.to_string_lossy()}), StatusCode::OK, origin)
                            }
                            Err(e) => {
                                state.progress_map.write().await.remove(&status_key);
                                json_response(serde_json::json!({"success": false, "error": format!("Erreur de téléchargement: {}", e)}), StatusCode::INTERNAL_SERVER_ERROR, origin)
                            }
                        }
                    }
                    _ => {
                        state.progress_map.write().await.remove(&status_key);
                        json_response(serde_json::json!({"success": false, "error": "Erreur de téléchargement"}), StatusCode::INTERNAL_SERVER_ERROR, origin)
                    }
                }
            }
            None => {
                state.progress_map.write().await.remove(&status_key);
                json_response(serde_json::json!({"success": false, "error": "Aucun flux disponible pour le téléchargement"}), StatusCode::BAD_GATEWAY, origin)
            }
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
    json_response(serde_json::json!({"progress": progress}), StatusCode::OK, origin)
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
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("xdg-open").arg(&target).spawn();
    }
    json_response(serde_json::json!({"ok": true}), StatusCode::OK, origin)
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
) -> bool {
    if dirs.len() >= max || depth > max_depth {
        return false;
    }
    let entries = match fs::read_dir(base) {
        Ok(e) => e,
        Err(_) => return false,
    };
    let mut has_media_child = false;
    let base_key = base.to_string_lossy().to_string();
    for entry in entries.flatten() {
        if dirs.len() >= max {
            break;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let path = entry.path();
        if path.is_dir() {
            if EXCLUDED_DIRS.contains(&name_str.to_lowercase().as_str()) {
                continue;
            }
            if scan_walk(&path, depth + 1, dirs, seen, max, max_depth) {
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
    let mut dirs: Vec<FolderInfo> = Vec::new();
    let mut seen: HashMap<String, (bool, bool, usize)> = HashMap::new();
    let max = 5000;
    let max_depth = 6;

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
        for p in &["/storage/emulated/0/Music", "/storage/emulated/0/Movies", "/storage/emulated/0/Download", "/storage/emulated/0/DCIM", "/storage/emulated/0/Pictures", "/storage/emulated/0"] {
            let root = PathBuf::from(p);
            if root.exists() {
                roots.push(root);
            }
        }
    }

    for r in &roots {
        if dirs.len() >= max { break; }
        scan_walk(r, 0, &mut dirs, &mut seen, max, max_depth);
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
    json_response(serde_json::json!({"folders": dirs}), StatusCode::OK, origin)
}

async fn handle_ping(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let ytdlp = yt_dlp_path(&state);
    let version = new_cmd(&ytdlp)
        .args(["--version"])
        .output()
        .await
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
            } else {
                None
            }
        });
    json_response(
        serde_json::json!({
            "ok": true,
            "yt_dlp": version,
            "tor_enabled": *state.tor_enabled.read().await,
            "yt_dlp_path": ytdlp,
            "resource_dir": state.resource_dir.as_ref().map(|p| p.to_string_lossy().to_string()),
        }),
        StatusCode::OK,
        origin,
    )
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
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let state = ServerState {
        output_dir,
        resource_dir,
        search_cache: Arc::new(RwLock::new(HashMap::new())),
        stream_cache: Arc::new(RwLock::new(HashMap::new())),
        progress_map: Arc::new(RwLock::new(HashMap::new())),
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
        .route("/local", get(handle_local))
        .route("/list-folder", get(handle_list_folder))
        .route("/scan-folders", get(handle_scan_folders))
        .route("/download", post(handle_download))
        .route("/progress", get(handle_progress))
        .route("/open-folder", post(handle_open_folder))
        .route("/proxy", post(handle_proxy))
        .route("/proxy-status", get(handle_proxy_status))
        .route("/user-dirs", get(handle_user_dirs))
        .route("/ping", get(handle_ping))
        .route("/debug-stream", get(handle_debug_stream))
        .route("/request-permissions", get(handle_request_permissions))
        .with_state(state);

    let addr = format!("127.0.0.1:{}", PORT);
    println!("[server] Serveur MédiaCLI lancé sur http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
