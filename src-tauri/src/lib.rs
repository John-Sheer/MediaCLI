#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unused_variables, unused_imports)]

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::Emitter;

mod server;

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
fn set_thumbbar_playing(playing: bool) {
    #[cfg(target_os = "windows")]
    {
        if let Some(hwnd) = thumbbar::get_hwnd() {
            thumbbar::update_buttons(hwnd, playing);
        }
    }
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

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct InstallerHandle(tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
async fn download_apk(app: tauri::AppHandle, url: String) -> Result<String, String> {
    use std::io::Write;

    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("update.apk");

    let mut response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
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
    builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder = builder.plugin(
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
            .build()
    );

    builder
        .setup(|app| {
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
                            PathBuf::from("/storage/emulated/0/MediaCLI")
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
                {
                    let _ = std::fs::write("/storage/emulated/0/Download/mediacli_crash.txt", "spawning server...\n");
                }

                tauri::async_runtime::spawn(async move {
                    server::start_server(output_dir, Some(resource_dir)).await;
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
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
            set_thumbbar_playing,
            request_android_storage_permission,
            relaunch_app,
            download_apk,
            install_apk,
            can_install_apk,
            request_install_permission
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors du lancement de l'application Tauri");
}
