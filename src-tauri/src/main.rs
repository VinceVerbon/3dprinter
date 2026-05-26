// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Spawn the bundled Node helper sidecar and supervise it.
///
/// Stability contract for the packaged app:
///   * We pass `PARENT_PID` so the helper ties its lifetime to THIS process
///     (see helper/index.mjs). The helper no longer depends on PWA heartbeats,
///     so it can never be reaped out from under a live window, and it self-exits
///     promptly if the app crashes (no zombie).
///   * If the helper ever exits while the app is still running, we respawn it
///     (bounded retries) so a one-off crash auto-heals instead of leaving the
///     UI talking to a dead backend.
///
/// In `tauri dev` no sidecar is bundled (Vite's helperPlugin runs the helper on
/// :5174), so `sidecar()` fails gracefully and we just log it.
fn spawn_helper(handle: tauri::AppHandle, attempt: u32) {
    const MAX_ATTEMPTS: u32 = 10;
    if attempt > MAX_ATTEMPTS {
        eprintln!("[haspel] helper failed {attempt} times; giving up (UI will show backend offline)");
        return;
    }

    let resource_dir = handle.path().resource_dir().ok();
    let mut cmd = match handle.shell().sidecar("haspel-helper") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("[haspel] no sidecar ({e}); using dev helper on :5174");
            return;
        }
    };

    // The helper reads PROJECT_ROOT/data/{catalog,demo} for the read-only seed.
    if let Some(dir) = resource_dir {
        cmd = cmd.env("PROJECT_ROOT", dir.to_string_lossy().to_string());
    }
    // Tie the helper's lifetime to this process (watch-only; never signalled).
    cmd = cmd.env("PARENT_PID", std::process::id().to_string());

    match cmd.spawn() {
        Ok((mut rx, child)) => {
            tauri::async_runtime::spawn(async move {
                // Hold the child handle for as long as we read its events.
                let _child = child;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                            eprintln!("[helper] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[haspel] helper exited ({payload:?}); respawning…");
                            // Small backoff, then respawn. If the app itself is
                            // shutting down, the freshly-spawned helper sees the
                            // parent PID gone and exits within a few seconds.
                            std::thread::sleep(std::time::Duration::from_millis(800));
                            spawn_helper(handle.clone(), attempt + 1);
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => eprintln!("[haspel] sidecar spawn failed: {e}"),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            spawn_helper(app.handle().clone(), 0);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Haspel");
}
