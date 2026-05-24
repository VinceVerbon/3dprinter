// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Bundled read-only catalog/demo seed lives in the resource dir of
            // the installed app. The helper reads PROJECT_ROOT/data/{catalog,demo}.
            let resource_dir = handle.path().resource_dir().ok();

            // Spawn the bundled Node helper sidecar. In `tauri dev` no sidecar is
            // bundled (Vite's helperPlugin already runs the helper on :5174), so
            // this fails gracefully and we just log it.
            match handle.shell().sidecar("haspel-helper") {
                Ok(mut cmd) => {
                    if let Some(dir) = resource_dir {
                        cmd = cmd.env("PROJECT_ROOT", dir.to_string_lossy().to_string());
                    }
                    match cmd.spawn() {
                        Ok((mut rx, _child)) => {
                            tauri::async_runtime::spawn(async move {
                                while let Some(event) = rx.recv().await {
                                    if let CommandEvent::Stdout(line)
                                    | CommandEvent::Stderr(line) = event
                                    {
                                        eprintln!("[helper] {}", String::from_utf8_lossy(&line));
                                    }
                                }
                            });
                        }
                        Err(e) => eprintln!("[haspel] sidecar spawn failed: {e}"),
                    }
                }
                Err(e) => eprintln!("[haspel] no sidecar ({e}); using dev helper on :5174"),
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Haspel");
}
