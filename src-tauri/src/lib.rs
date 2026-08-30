#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unused_variables, unused_imports)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Manager;
use tauri::Emitter;

mod server;

// État de lecture global (mis à jour par le frontend) pour savoir si la fenêtre
// doit être masquée dans le tray ou réellement fermée.
static IS_PLAYING: AtomicBool = AtomicBool::new(false);

// Passe à true uniquement après confirmation de l'utilisateur (commande quit_app).
// Permet de laisser passer la fermeture réelle déclenchée par le frontend.
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

#[cfg(desktop)]
mod tray_state {
    use std::sync::{Mutex, OnceLock};
    use tauri::menu::MenuItem;

    pub struct TrayHandles {
        pub now_title: MenuItem<tauri::Wry>,
        pub now_artist: MenuItem<tauri::Wry>,
        pub play_pause: MenuItem<tauri::Wry>,
    }

    pub static TRAY: OnceLock<Mutex<Option<TrayHandles>>> = OnceLock::new();

    pub fn init() -> &'static Mutex<Option<TrayHandles>> {
        TRAY.get_or_init(|| Mutex::new(None))
    }

    pub fn set(handles: TrayHandles) {
        *init().lock().unwrap() = Some(handles);
    }

    pub fn update(playing: Option<bool>, title: Option<&str>, artist: Option<&str>) {
        let lock = init().lock().unwrap();
        let Some(h) = lock.as_ref() else { return };
        let t = title.unwrap_or("");
        let a = artist.unwrap_or("");
        if !t.is_empty() {
            let _ = h.now_title.set_text(&format!("  \u{266A} {}", t));
        } else {
            let _ = h.now_title.set_text("  \u{266A} Aucune piste");
        }
        if !a.is_empty() {
            let _ = h.now_artist.set_text(&format!("  {}", a));
        } else {
            let _ = h.now_artist.set_text("  MediaCLI");
        }
        if let Some(p) = playing {
            let _ = h.play_pause.set_text(if p { "\u{23F8}  Pause" } else { "\u{25B6}  Lecture" });
        }
    }
}

#[cfg(target_os = "windows")]
mod thumbbar {
    use std::sync::OnceLock;
    use tauri::Emitter as _;
    use tauri::Manager as _;
    use windows::core::*;
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::UI::Shell::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    static APP_HWND: OnceLock<isize> = OnceLock::new();
    static WINDOW_LABEL: OnceLock<String> = OnceLock::new();
    pub static TAURI_APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static BUTTONS_ADDED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub const ID_PREV: u32 = 9001;
    pub const ID_PLAY: u32 = 9002;
    pub const ID_NEXT: u32 = 9003;

    fn wide_tip(s: &str) -> [u16; 260] {
        let mut buf = [0u16; 260];
        let mut i = 0;
        for ch in s.encode_utf16() {
            if i < 259 {
                buf[i] = ch;
            }
            i += 1;
        }
        buf
    }

    const SZ: i32 = 16;

    unsafe fn new_icon(draw: unsafe fn(*mut [u32; 256])) -> HICON {
        let mut pixels = [0u32; 256];
        draw(&mut pixels as *mut [u32; 256]);

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SZ,
                biHeight: -SZ,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            bmiColors: [RGBQUAD::default(); 1],
        };

        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let hdc_screen = GetDC(None);
        let color_bmp = CreateDIBSection(
            hdc_screen,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        ).expect("CreateDIBSection failed");
        let _ = ReleaseDC(None, hdc_screen);

        let dst = &mut *(bits as *mut [u32; 256]);
        dst.copy_from_slice(&pixels);

        let mask_bits = vec![0u8; (SZ * SZ / 8) as usize];
        let mask_bmp = CreateBitmap(SZ, SZ, 1, 1, Some(mask_bits.as_ptr() as *const core::ffi::c_void));

        let icon = CreateIconIndirect(&ICONINFO {
            fIcon: true.into(),
            hbmMask: mask_bmp,
            hbmColor: color_bmp,
            ..Default::default()
        })
        .expect("CreateIconIndirect failed");

        let _ = DeleteObject(color_bmp);
        let _ = DeleteObject(mask_bmp);
        icon
    }

    #[inline(always)]
    unsafe fn set_px(buf: *mut [u32; 256], x: i32, y: i32, r: u8, g: u8, b: u8, a: u8) {
        if x >= 0 && x < SZ && y >= 0 && y < SZ {
            (*buf)[(y * SZ + x) as usize] = (a as u32) << 24 | (r as u32) << 16 | (g as u32) << 8 | b as u32;
        }
    }

    unsafe fn draw_play(buf: *mut [u32; 256]) {
        for y in 0..SZ {
            for x in 0..SZ {
                if x >= 3 && x <= 13 {
                    let progress = (x - 3) as f64 / 10.0;
                    let half_h = 5.5 * (1.0 - progress);
                    let cy = 7.5;
                    if (y as f64) >= cy - half_h && (y as f64) <= cy + half_h {
                        set_px(buf, x, y, 255, 255, 255, 255);
                    }
                }
            }
        }
    }

    unsafe fn draw_pause(buf: *mut [u32; 256]) {
        for y in 0..SZ {
            for x in 0..SZ {
                if (x >= 4 && x <= 6) || (x >= 9 && x <= 11) {
                    if y >= 2 && y <= 13 {
                        set_px(buf, x, y, 255, 255, 255, 255);
                    }
                }
            }
        }
    }

    unsafe fn draw_prev(buf: *mut [u32; 256]) {
        for y in 0..SZ {
            for x in 0..SZ {
                if x >= 2 && x <= 3 && y >= 2 && y <= 12 {
                    set_px(buf, x, y, 255, 255, 255, 255);
                }
                if x >= 5 && x <= 12 {
                    let progress = (x - 5) as f64 / 7.0;
                    let half_h = 5.0 * progress;
                    let cy = 7.5;
                    if (y as f64) >= cy - half_h && (y as f64) <= cy + half_h {
                        set_px(buf, x, y, 255, 255, 255, 255);
                    }
                }
            }
        }
    }

    unsafe fn draw_next(buf: *mut [u32; 256]) {
        for y in 0..SZ {
            for x in 0..SZ {
                if x >= 12 && x <= 13 && y >= 2 && y <= 12 {
                    set_px(buf, x, y, 255, 255, 255, 255);
                }
                if x >= 3 && x <= 10 {
                    let progress = (x - 3) as f64 / 7.0;
                    let half_h = 5.0 * (1.0 - progress);
                    let cy = 7.5;
                    if (y as f64) >= cy - half_h && (y as f64) <= cy + half_h {
                        set_px(buf, x, y, 255, 255, 255, 255);
                    }
                }
            }
        }
    }

    pub fn update_buttons(hwnd: isize, playing: bool) {
        unsafe {
            let _ = CoInitializeEx(Some(std::ptr::null()), COINIT_APARTMENTTHREADED);

            let taskbar: ITaskbarList3 = match CoCreateInstance(
                &TaskbarList,
                None,
                CLSCTX_INPROC_SERVER,
            ) {
                Ok(t) => t,
                Err(_) => return,
            };

            let flags = THBF_ENABLED;
            let tip_prev = wide_tip("Précédent");
            let tip_play = wide_tip(if playing { "Pause" } else { "Lecture" });
            let tip_next = wide_tip("Suivant");
            let icon_prev = new_icon(draw_prev);
            let icon_play = new_icon(if playing { draw_pause } else { draw_play });
            let icon_next = new_icon(draw_next);

            let buttons: [THUMBBUTTON; 3] = [
                THUMBBUTTON {
                    dwMask: THB_TOOLTIP | THB_ICON,
                    iId: ID_PREV,
                    iBitmap: 0,
                    hIcon: icon_prev,
                    dwFlags: flags,
                    szTip: tip_prev,
                },
                THUMBBUTTON {
                    dwMask: THB_TOOLTIP | THB_ICON,
                    iId: ID_PLAY,
                    iBitmap: 0,
                    hIcon: icon_play,
                    dwFlags: flags,
                    szTip: tip_play,
                },
                THUMBBUTTON {
                    dwMask: THB_TOOLTIP | THB_ICON,
                    iId: ID_NEXT,
                    iBitmap: 0,
                    hIcon: icon_next,
                    dwFlags: flags,
                    szTip: tip_next,
                },
            ];

            let hwnd_ptr = HWND(hwnd);
            if !BUTTONS_ADDED.swap(true, std::sync::atomic::Ordering::SeqCst) {
                let _ = taskbar.ThumbBarAddButtons(hwnd_ptr, &buttons);
            } else {
                let _ = taskbar.ThumbBarUpdateButtons(hwnd_ptr, &buttons);
            }

            let _ = DestroyIcon(icon_prev);
            let _ = DestroyIcon(icon_play);
            let _ = DestroyIcon(icon_next);
            CoUninitialize();
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id_subclass: usize,
        _ref_data: usize,
    ) -> LRESULT {
        if msg == WM_COMMAND {
            let id = (wparam.0 & 0xFFFF) as u32;
            match id {
                ID_PREV | ID_PLAY | ID_NEXT => {
                    let action = match id {
                        9001 => "previous",
                        9002 => "toggle-play",
                        9003 => "next",
                        _ => unreachable!(),
                    };
                    if let Some(label) = WINDOW_LABEL.get() {
                        if let Some(app) = TAURI_APP.get() {
                            if let Some(win) = app.get_webview_window(label) {
                                let _ = win.emit("thumbbar-action", action);
                            }
                        }
                    }
                    return LRESULT(0);
                }
                _ => {}
            }
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    pub fn install_subclass(hwnd: isize) {
        unsafe {
            let _ = SetWindowSubclass(HWND(hwnd), Some(subclass_proc), 1, 0);
        }
    }

    pub fn set_app_handle(handle: tauri::AppHandle) {
        let _ = TAURI_APP.set(handle);
    }
    pub fn set_hwnd(hwnd: isize) {
        let _ = APP_HWND.set(hwnd);
    }
    pub fn set_window_label(label: &str) {
        let _ = WINDOW_LABEL.set(label.to_string());
    }
    pub fn get_hwnd() -> Option<isize> {
        APP_HWND.get().copied()
    }
}

#[tauri::command]
async fn set_playing_state(
    app: tauri::AppHandle,
    playing: bool,
    title: Option<String>,
    artist: Option<String>,
    position_ms: Option<f64>,
    duration_ms: Option<f64>,
) {
    eprintln!("[set_playing_state] playing={} title={:?} artist={:?} pos={:?} dur={:?}", playing, title, artist, position_ms, duration_ms);
    IS_PLAYING.store(playing, Ordering::SeqCst);
    #[cfg(desktop)]
    tray_state::update(Some(playing), title.as_deref(), artist.as_deref());
    #[cfg(target_os = "windows")]
    {
        if let Some(hwnd) = thumbbar::get_hwnd() {
            thumbbar::update_buttons(hwnd, playing);
        }
    }
    #[cfg(target_os = "android")]
    {
        if let Some(handle) = app.try_state::<BackgroundHandle>() {
            let _ = handle
                .0
                .run_mobile_plugin_async::<serde_json::Value>(
                    "setPlayback",
                    serde_json::json!({
                        "playing": playing,
                        "title": title.unwrap_or_default(),
                        "artist": artist.unwrap_or_default(),
                        "position_ms": position_ms.unwrap_or(0.0) as u64,
                        "duration_ms": duration_ms.unwrap_or(0.0) as u64,
                    }),
                )
                .await;
        }
    }
}

#[tauri::command]
async fn update_position(
    app: tauri::AppHandle,
    position_ms: f64,
    duration_ms: f64,
) {
    #[cfg(target_os = "android")]
    {
        if let Some(handle) = app.try_state::<BackgroundHandle>() {
            let _ = handle
                .0
                .run_mobile_plugin_async::<serde_json::Value>(
                    "updatePosition",
                    serde_json::json!({
                        "position_ms": position_ms as u64,
                        "duration_ms": duration_ms as u64,
                    }),
                )
                .await;
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, position_ms, duration_ms);
}

#[derive(serde::Serialize)]
struct BackgroundState {
    background: bool,
}

#[tauri::command]
async fn background_state(app: tauri::AppHandle) -> BackgroundState {
    #[cfg(target_os = "android")]
    {
        if let Some(handle) = app.try_state::<BackgroundHandle>() {
            let res = handle
                .0
                .run_mobile_plugin_async::<serde_json::Value>(
                    "backgroundState",
                    serde_json::json!({}),
                )
                .await;
            if let Ok(val) = res {
                let obj = val.as_object().cloned().unwrap_or_default();
                return BackgroundState {
                    background: obj.get("background").and_then(|v| v.as_bool()).unwrap_or(false),
                };
            }
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    BackgroundState { background: false }
}

#[tauri::command]
async fn set_orientation(app: tauri::AppHandle, landscape: bool) {
    #[cfg(target_os = "android")]
    {
        if let Some(handle) = app.try_state::<BackgroundHandle>() {
            let _ = handle
                .0
                .run_mobile_plugin_async::<serde_json::Value>(
                    "setOrientation",
                    serde_json::json!({ "landscape": landscape }),
                )
                .await;
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

#[tauri::command]
async fn select_folder_dialog(app: tauri::AppHandle) -> Option<String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = std::sync::mpsc::sync_channel::<Option<std::path::PathBuf>>(1);
        app.dialog().file().pick_folder(move |path| {
            let _ = tx.send(path.and_then(|p| p.into_path().ok()));
        });
        rx.recv().ok().flatten().map(|p| p.to_string_lossy().to_string())
    }
    #[cfg(not(desktop))]
    {
        None
    }
}

#[tauri::command]
async fn request_android_storage_permission() -> bool {
    true
}

// Affiche et ramène la fenêtre au premier plan (utilisé depuis le tray).
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

// Bascule afficher/masquer la fenêtre (clic gauche sur l'icône du tray).
#[cfg(desktop)]
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(true) = win.is_visible() {
            let _ = win.hide();
            return;
        }
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

// Configure l'icône de la barre système avec les contrôles de lecture.
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let sep_top = PredefinedMenuItem::separator(app)?;
    let now_title = MenuItem::with_id(app, "tray-now-title", "  \u{266A} Aucune piste", false, None::<&str>)?;
    let now_artist = MenuItem::with_id(app, "tray-now-artist", "  MediaCLI", false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let play = MenuItem::with_id(app, "tray-toggle-play", "\u{25B6}  Lecture", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "tray-previous", "\u{23EE}  Piste précédente", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "tray-next", "\u{23ED}  Piste suivante", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "tray-show", "\u{1F4E6}  Afficher", true, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "\u{274C}  Quitter", true, None::<&str>)?;

    tray_state::set(tray_state::TrayHandles {
        now_title: now_title.clone(),
        now_artist: now_artist.clone(),
        play_pause: play.clone(),
    });

    let menu = Menu::with_items(app, &[
        &sep_top, &now_title, &now_artist, &sep1,
        &play, &previous, &next, &sep2,
        &show, &sep3, &quit,
    ])?;

    TrayIconBuilder::with_id("mediacli-tray")
        .icon(
            app.default_window_icon()
                .expect("icône par défaut manquante")
                .clone(),
        )
        .tooltip("MediaCLI \u{2014} aucun morceau en lecture")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => show_main_window(app),
            "tray-toggle-play" => {
                let _ = app.emit("thumbbar-action", "toggle-play");
            }
            "tray-previous" => {
                let _ = app.emit("thumbbar-action", "previous");
            }
            "tray-next" => {
                let _ = app.emit("thumbbar-action", "next");
            }
            "tray-quit" => {
                if !QUIT_CONFIRMED.load(Ordering::SeqCst) {
                    show_main_window(app);
                    let _ = app.emit("quit-requested", ());
                } else {
                    app.exit(0);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct InstallerHandle(tauri::plugin::PluginHandle<tauri::Wry>);

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct BackgroundHandle(tauri::plugin::PluginHandle<tauri::Wry>);

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct StoragePermissionHandle(tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

// Fermeture réelle de l'application, appelée par le frontend SEULEMENT après
// confirmation de l'utilisateur. Sans ce passage, la fermeture native (croix OS,
// etc.) est interceptée et une demande de confirmation est envoyée au frontend.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
async fn download_apk(app: tauri::AppHandle, url: String) -> Result<String, String> {
    use std::io::Write;

    #[cfg(target_os = "android")]
    let client = {
        use rustls::crypto::aws_lc_rs;
        let mut roots = rustls::RootCertStore::empty();
        roots.add_parsable_certificates(webpki_root_certs::TLS_SERVER_ROOT_CERTS.iter().cloned());
        let config = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
            aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
        reqwest::Client::builder()
            .use_preconfigured_tls(config)
            .build()
            .map_err(|e| e.to_string())?
    };
    #[cfg(not(target_os = "android"))]
    let client = reqwest::Client::new();

    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("update.apk");

    let mut response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0) as u32
        } else {
            0
        };
        let _ = app.emit("apk-download-progress", percent);
    }

    Ok(dest.to_string_lossy().to_string())
}

#[cfg(target_os = "android")]
fn installer_handle(
    app: &tauri::AppHandle,
) -> Result<tauri::plugin::PluginHandle<tauri::Wry>, String> {
    app.try_state::<InstallerHandle>()
        .map(|s| s.0.clone())
        .ok_or_else(|| "plugin installer non initialisé".to_string())
}

#[cfg(target_os = "android")]
async fn prepare_android_binaries(app: &tauri::AppHandle) -> Option<PathBuf> {
    match installer_handle(app) {
        Ok(handle) => {
            match handle
                .run_mobile_plugin_async::<serde_json::Value>(
                    "copyBinary",
                    serde_json::json!({}),
                )
                .await
            {
                Ok(result) => match result.get("ffmpeg").and_then(|v| v.as_str()).map(PathBuf::from) {
                    Some(ffmpeg) => match ffmpeg.parent() {
                        Some(dir) => {
                            let dir = dir.to_path_buf();
                            eprintln!("[tauri] ffmpeg prêt dans {}", dir.display());
                            Some(dir)
                        }
                        None => {
                            eprintln!("[tauri] copyBinary ffmpeg sans parent: {:?}", ffmpeg);
                            None
                        }
                    },
                    None => {
                        eprintln!("[tauri] copyBinary sans champ ffmpeg: {:?}", result);
                        None
                    }
                },
                Err(e) => {
                    eprintln!("[tauri] copyBinary erreur: {}", e);
                    None
                }
            }
        }
        Err(e) => {
            eprintln!("[tauri] installer_handle: {}", e);
            None
        }
    }
}

#[tauri::command]
async fn install_apk(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = installer_handle(&app)?;
        handle
            .run_mobile_plugin_async::<serde_json::Value>(
                "install",
                serde_json::json!({ "path": path }),
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path);
        Err("Installation APK non disponible sur ce système".to_string())
    }
}

#[tauri::command]
async fn can_install_apk(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "android")]
    {
        match installer_handle(&app) {
            Ok(handle) => {
                if let Ok(value) = handle
                    .run_mobile_plugin_async::<serde_json::Value>(
                        "canInstall",
                        serde_json::json!({}),
                    )
                    .await
                {
                    return value
                        .get("can")
                        .and_then(|c| c.as_bool())
                        .unwrap_or(false);
                }
                false
            }
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
async fn request_install_permission(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = installer_handle(&app)?;
        handle
            .run_mobile_plugin_async::<serde_json::Value>(
                "requestInstallPermission",
                serde_json::json!({}),
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Non disponible sur ce système".to_string())
    }
}

#[cfg(target_os = "android")]
fn storage_permission_handle(
    app: &tauri::AppHandle,
) -> Result<tauri::plugin::PluginHandle<tauri::Wry>, String> {
    app.try_state::<StoragePermissionHandle>()
        .map(|s| s.0.clone())
        .ok_or_else(|| "plugin storagepermission non initialisé".to_string())
}

// Vrai accès "Tous les fichiers" (MANAGE_EXTERNAL_STORAGE) — obligatoire sur
// Android 11+ pour écrire dans /storage/emulated/0/MediaCLI. Le manifest le
// déclare, mais l'utilisateur doit l'accorder depuis les Paramètres système :
// cette commande vérifie l'état réel et déclenche l'écran de la permission.
#[tauri::command]
async fn has_all_files_access(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "android")]
    {
        match storage_permission_handle(&app) {
            Ok(handle) => {
                if let Ok(value) = handle
                    .run_mobile_plugin_async::<serde_json::Value>(
                        "hasAccess",
                        serde_json::json!({}),
                    )
                    .await
                {
                    return value
                        .get("has")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                }
                false
            }
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        true
    }
}

#[tauri::command]
async fn request_all_files_access(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let handle = storage_permission_handle(&app)?;
        handle
            .run_mobile_plugin_async::<serde_json::Value>(
                "requestAccess",
                serde_json::json!({}),
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(desktop)]
struct ServerChildProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg(desktop)]
fn resolve_resource_dir(app: &tauri::App) -> PathBuf {
    if let Some(dir) = app.path().resource_dir().ok() {
        if dir.join("yt-dlp.exe").exists() || dir.join("yt-dlp").exists() {
            return dir;
        }
        let res = dir.join("resources");
        if res.join("yt-dlp.exe").exists() || res.join("yt-dlp").exists() {
            return res;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let res = parent.join("resources");
            if res.join("yt-dlp.exe").exists() || res.join("yt-dlp").exists() {
                return res;
            }
            if parent.join("yt-dlp.exe").exists() || parent.join("yt-dlp").exists() {
                return parent.to_path_buf();
            }
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    {
        std::panic::set_hook(Box::new(|info| {
            let msg = format!("PANIC: {}\n", info);
            let _ = std::fs::write("/storage/emulated/0/Download/mediacli_crash.txt", &msg);
            eprintln!("{}", msg);
        }));
    }

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_shell::init());
    }
    builder = builder.plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder = builder
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("installer")
                .setup(|app, api| {
                    #[cfg(target_os = "android")]
                    {
                        let handle = api
                            .register_android_plugin("com.johnsheer.mediacli", "InstallerPlugin")
                            .map_err(|e| e.to_string())?;
                        app.manage(InstallerHandle(handle));
                    }
                    #[cfg(not(target_os = "android"))]
                    {
                        let _ = (app, api);
                    }
                    Ok(())
                })
                .build(),
        )
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("storagepermission")
                .setup(|app, api| {
                    #[cfg(target_os = "android")]
                    {
                        let handle = api
                            .register_android_plugin(
                                "com.johnsheer.mediacli",
                                "StoragePermissionPlugin",
                            )
                            .map_err(|e| e.to_string())?;
                        app.manage(StoragePermissionHandle(handle));
                    }
                    #[cfg(not(target_os = "android"))]
                    {
                        let _ = (app, api);
                    }
                    Ok(())
                })
                .build(),
        )
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("background")
                .setup(|app, api| {
                    #[cfg(target_os = "android")]
                    {
                        let bg_handle = api
                            .register_android_plugin("com.johnsheer.mediacli", "BackgroundPlugin")
                            .map_err(|e| e.to_string())?;
                        app.manage(BackgroundHandle(bg_handle));
                    }
                    #[cfg(not(target_os = "android"))]
                    {
                        let _ = (app, api);
                    }
                    Ok(())
                })
                .build(),
        );

    builder
        .setup(|app| {
            // Lecture en arrière-plan : icône tray pour contrôler la lecture
            // même quand la fenêtre est masquée.
            #[cfg(desktop)]
            setup_tray(app)?;

            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    match window.hwnd() {
                        Ok(hwnd) => {
                            let h = hwnd.0 as isize;
                            thumbbar::set_hwnd(h);
                            thumbbar::set_window_label("main");
                            thumbbar::set_app_handle(app.handle().clone());
                            thumbbar::install_subclass(h);
                            thumbbar::update_buttons(h, false);
                        }
                        Err(e) => {
                            eprintln!("[tauri] FAILED to get HWND: {:?}", e);
                        }
                    }
                }
            }

            {
                let output_dir = std::env::var("MEDIACLI_OUTPUT_DIR")
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| {
                        if cfg!(target_os = "android") {
                            // Depuis Android 11+, /storage/emulated/0/Android/data/<pkg>/...
                            // est inaccessible en écriture brute (EACCES). On utilise le
                            // dossier de bibliothèque public /storage/emulated/0/MediaCLI,
                            // le même que celui de l'app d'origine (les téléchargements y
                            // apparaissent directement dans la bibliothèque locale).
                            let app_dir = PathBuf::from("/storage/emulated/0/MediaCLI");
                            let _ = std::fs::create_dir_all(&app_dir);
                            app_dir
                        } else {
                            PathBuf::from("C:\\MediaCLI")
                        }
                    });
                let _ = std::fs::create_dir_all(&output_dir);

                #[cfg(desktop)]
                let resource_dir = {
                    let app_ref = app;
                    resolve_resource_dir(app_ref)
                };
                #[cfg(not(desktop))]
                let resource_dir = PathBuf::from(".");

                #[cfg(target_os = "android")]
                let app_handle_for_copy = app.handle().clone();

                #[cfg(target_os = "android")]
                {
                    let _ = std::fs::write("/storage/emulated/0/Download/mediacli_crash.txt", "spawning server...\n");
                }

                tauri::async_runtime::spawn(async move {
                    #[cfg(target_os = "android")]
                    let resource_dir = match prepare_android_binaries(&app_handle_for_copy).await {
                        Some(dir) => dir,
                        None => resource_dir,
                    };
                    std::thread::spawn(move || server::run_server_sync(output_dir, Some(resource_dir)));
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermeture en arrière-plan : si une piste est en cours de lecture,
            // on masque la fenêtre dans le tray au lieu de quitter l'application.
            // Sinon, toute fermeture qui provoquerait la sortie réelle de l'app
            // est d'abord soumise à une confirmation (event "quit-requested") :
            // le frontend affiche la modale et n'appelle quit_app qu'après accord.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if QUIT_CONFIRMED.load(Ordering::SeqCst) {
                    return;
                }
                if IS_PLAYING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                api.prevent_close();
                let _ = window.emit("quit-requested", ());
            }

            #[cfg(desktop)]
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<ServerChildProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            select_folder_dialog,
            set_playing_state,
            update_position,
            background_state,
            set_orientation,
            request_android_storage_permission,
            relaunch_app,
            quit_app,
            download_apk,
            install_apk,
            can_install_apk,
            request_install_permission,
            has_all_files_access,
            request_all_files_access
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors du lancement de l'application Tauri");
}
