// swrm's window: a bare WebKitGTK view (the system one, no bundled browser) pointed at the local
// server. It starts the server if nobody is listening and stops it when the window closes, because
// an AppImage's files vanish once this process ends.
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::platform::unix::WindowExtUnix;
use tao::window::WindowBuilder;
use wry::{WebViewBuilder, WebViewBuilderExtUnix};

extern "C" {
    fn prctl(option: i32, arg2: u64, ...) -> i32;
}

fn listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

// Where node + the server live: next to the binary in an AppDir (usr/bin -> usr/lib/swrm),
// or the repo itself when run from `shell/target`.
fn app_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SWRM_ROOT") {
        return Some(PathBuf::from(p));
    }
    let exe = std::env::current_exe().ok()?;
    let bin = exe.parent()?;
    for rel in ["../lib/swrm", "../../.."] {
        let dir = bin.join(rel);
        if dir.join("bin/swrm.mjs").exists() {
            return dir.canonicalize().ok();
        }
    }
    None
}

fn start_server(port: u16) -> Option<Child> {
    let root = app_root()?;
    let bundled = root.join("node");
    let node = if bundled.exists() { bundled } else { PathBuf::from("node") };
    let mut cmd = Command::new(node);
    // If this window process dies for any reason, the kernel sends the server SIGTERM (it saves chats and exits).
    unsafe {
        cmd.pre_exec(|| {
            prctl(1, 15); // PR_SET_PDEATHSIG, SIGTERM
            Ok(())
        });
    }
    cmd
        // a 1 MB young generation keeps an idle server near 40 MB instead of ~115 MB
        .arg("--max-semi-space-size=1")
        .arg(root.join("bin/swrm.mjs"))
        .arg("--no-open")
        .current_dir(&root)
        .env("SWRM_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

// One window: if swrm is already open (Hyprland), bring it to the front instead of opening a second one.
fn focus_existing() -> bool {
    let out = match Command::new("hyprctl").args(["clients", "-j"]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return false,
    };
    if !out.contains("\"class\": \"swrm-shell\"") {
        return false;
    }
    let _ = Command::new("hyprctl").args(["dispatch", "hl.dsp.focus({ window = \"class:swrm-shell\" })"]).status();
    true
}

fn main() {
    // WebKitGTK's dmabuf renderer on Wayland shows stale frames: whole menus vanish or flash for one
    // frame at the end of animations (measured: 4 glitches in 17 s, 0 with this set). Must be set before GTK starts.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if std::env::var_os("SWRM_URL").is_none() && focus_existing() {
        return;
    }
    let port: u16 = std::env::var("SWRM_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4141);
    // SWRM_URL opens any page instead (used to test the webview itself): no server then.
    let url = std::env::var("SWRM_URL").ok();
    let mut child = if url.is_some() || listening(port) { None } else { start_server(port) };
    let t0 = Instant::now();
    while url.is_none() && !listening(port) && t0.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(60));
    }

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("swrm")
        .with_inner_size(LogicalSize::new(1480.0, 920.0))
        .with_min_inner_size(LogicalSize::new(720.0, 480.0))
        .build(&event_loop)
        .expect("window");
    // SWRM_INJECT=file.js runs a script in the page before it loads (used to drive the UI in tests).
    let inject = std::env::var("SWRM_INJECT").ok().and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default();
    let _webview = WebViewBuilder::new()
        .with_initialization_script(inject)
        .with_url(url.unwrap_or_else(|| format!("http://127.0.0.1:{port}")))
        .with_background_color((21, 21, 21, 255))
        .build_gtk(window.default_vbox().expect("vbox"))
        .expect("webview");

    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            if let Some(c) = child.as_mut() {
                // SIGTERM lets the server save chats and stop their processes.
                let _ = Command::new("kill").arg(c.id().to_string()).status();
                for _ in 0..30 {
                    if matches!(c.try_wait(), Ok(Some(_))) { break; }
                    std::thread::sleep(Duration::from_millis(100));
                }
                let _ = c.kill();
            }
            *flow = ControlFlow::Exit;
        }
    });
}
