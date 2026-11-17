use std::{
  collections::HashMap,
  fs,
  path::PathBuf,
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
  },
  thread,
  time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Url, WebviewWindow};
#[cfg(not(target_os = "linux"))]
use tauri_plugin_notification::NotificationExt;

use crate::{get, home, main_window, post, show, Obeya};

const ROUTE: &str = "/api/desktop-notifications";
const NEEDS_YOU: &str = "/?needs-you";
const COOLDOWN: Duration = Duration::from_secs(60);
const ACTIVE_FOR: Duration = Duration::from_secs(30);
const MAX_EVENTS: usize = 512;

#[derive(Clone, Copy, Deserialize, Serialize)]
pub(crate) struct Settings {
  enabled: bool,
  sound: bool,
}

impl Default for Settings {
  fn default() -> Self {
    Self { enabled: true, sound: true }
  }
}

pub(crate) struct Notifications {
  settings: Mutex<Settings>,
  used: Mutex<Option<Instant>>,
  serving: AtomicBool,
}

pub fn installed() -> bool {
  if std::env::var_os("OBEYA_APP_CHECK").is_some() || std::env::var_os("OBEYA_SCRATCH").is_some() {
    return false;
  }
  #[cfg(target_os = "macos")]
  return std::env::current_exe()
    .ok()
    .is_some_and(|exe| exe.ancestors().nth(3).and_then(|p| p.extension()).is_some_and(|ext| ext == "app"));
  #[cfg(not(target_os = "macos"))]
  {
    option_env!("OBEYA_BUILT_CHECKOUT").is_some() || tauri::utils::platform::bundle_type().is_some()
  }
}

fn settings_path() -> PathBuf {
  home().join("desktop-notifications.json")
}

/// The command must come from the canvas currently served to the app. The remote capability
/// needs a port wildcard because a second Obeya can already occupy the usual port.
fn local_canvas(window: &WebviewWindow, obeya: &Obeya) -> bool {
  window.label() == "main"
    && window
      .url()
      .is_ok_and(|url| url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(obeya.port.load(Ordering::SeqCst)))
}

#[tauri::command]
pub fn notification_settings(
  window: WebviewWindow,
  state: State<'_, Notifications>,
  obeya: State<'_, Arc<Obeya>>,
  enabled: Option<bool>,
  sound: Option<bool>,
) -> Result<Settings, String> {
  if !installed() || !local_canvas(&window, &obeya) {
    return Err("Notifications are unavailable".into());
  }
  let mut current = state.settings.lock().unwrap();
  if enabled.is_some() || sound.is_some() {
    let settings = Settings {
      enabled: enabled.unwrap_or(current.enabled),
      sound: sound.unwrap_or(current.sound),
    };
    let path = settings_path();
    let temp = path.with_extension("tmp");
    let bytes = serde_json::to_vec(&settings).map_err(|e| e.to_string())?;
    fs::write(&temp, bytes).and_then(|_| fs::rename(temp, path)).map_err(|e| e.to_string())?;
    *current = settings;
  }
  Ok(*current)
}

#[tauri::command]
pub fn notification_activity(window: WebviewWindow, state: State<'_, Notifications>, obeya: State<'_, Arc<Obeya>>) {
  // This hot path only needs the port the shell is serving, not the entry on disk.
  if local_canvas(&window, &obeya) && window.is_focused().unwrap_or(false) {
    *state.used.lock().unwrap() = Some(Instant::now());
  }
}

#[tauri::command]
pub fn notification_sample(
  window: WebviewWindow,
  state: State<'_, Notifications>,
  obeya: State<'_, Arc<Obeya>>,
  title: String,
  body: String,
) -> Result<(), String> {
  let settings = *state.settings.lock().unwrap();
  if !local_canvas(&window, &obeya) || !state.serving.load(Ordering::Relaxed) || !settings.enabled || title.len() > 240 || body.len() > 600 {
    return Err("Notifications are unavailable".into());
  }
  notify(window.app_handle(), &Notice { title, body, next: None }, settings.sound)
}

#[derive(Clone, Deserialize)]
struct Notice {
  title: String,
  body: String,
  next: Option<String>,
}

#[cfg(not(target_os = "linux"))]
fn notify(app: &AppHandle, notice: &Notice, sound: bool) -> Result<(), String> {
  let mut builder = app.notification().builder().title(&notice.title).body(&notice.body).extra("next", &notice.next);
  #[cfg(target_os = "macos")]
  const SOUND: &str = "NSUserNotificationDefaultSoundName";
  #[cfg(windows)]
  const SOUND: &str = "Default";
  if sound {
    builder = builder.sound(SOUND);
  }
  builder.show().map_err(|e| e.to_string())
}

// The Tauri plugin's Linux builder only exposes sound-name. Use its underlying library
// here so sound off also sends the Freedesktop suppress-sound hint.
#[cfg(target_os = "linux")]
fn notify(app: &AppHandle, notice: &Notice, sound: bool) -> Result<(), String> {
  use notify_rust::{get_capabilities, Hint, Notification, NotificationResponse};

  let mut notification = Notification::new();
  let entry = if option_env!("OBEYA_BUILT_CHECKOUT").is_some() {
    "obeya-checkout"
  } else {
    "Obeya"
  };
  notification
    .appname("Obeya")
    .summary(&notice.title)
    .icon("obeya")
    .hint(Hint::DesktopEntry(entry.into()))
    .action("default", "");
  if sound {
    notification.sound_name("message-new-instant");
  } else {
    notification.hint(Hint::SuppressSound(true));
  }
  let app = app.clone();
  let notice = notice.clone();
  thread::Builder::new()
    .name("notification".into())
    .spawn(move || {
      let body = if get_capabilities().is_ok_and(|caps| caps.iter().any(|cap| cap == "body-markup")) {
        notice.body.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
      } else {
        notice.body
      };
      let result = notification.body(&body).show().and_then(|handle| {
        handle.wait_for_response(|action: &NotificationResponse| {
          if matches!(action, NotificationResponse::Default) {
            activate(&app, notice.next);
          }
        })
      });
      if let Err(error) = result {
        eprintln!("Obeya notification: {error}");
      }
    })
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[derive(Deserialize)]
struct Event {
  id: u64,
  card: String,
}

#[derive(Deserialize)]
struct Feed {
  instance: String,
  seen: u64,
  events: Vec<Event>,
}

/// The first at once, then waits accumulated during a minute, with the latest reason per card.
#[derive(Default)]
struct Batches {
  deadline: Option<Instant>,
  next: HashMap<String, u64>,
}

impl Batches {
  fn add(&mut self, events: Vec<Event>, now: Instant) -> Vec<u64> {
    let mut ids = Vec::new();
    for event in events {
      if self.deadline.is_none() {
        self.delivered(now);
        ids.push(event.id);
      } else {
        self.next.insert(event.card, event.id);
      }
    }
    ids
  }

  fn due(&mut self, now: Instant) -> Option<Vec<u64>> {
    if self.deadline.is_some_and(|at| at <= now) {
      self.deadline = None;
      let mut ids: Vec<_> = self.next.drain().map(|(_, id)| id).collect();
      ids.sort_unstable();
      if ids.len() > MAX_EVENTS {
        ids.drain(..ids.len() - MAX_EVENTS);
      }
      return Some(ids);
    }
    None
  }

  fn delivered(&mut self, now: Instant) {
    self.deadline = Some(now + COOLDOWN);
  }
}

fn eligible(app: &AppHandle, state: &Notifications) -> Option<Settings> {
  let settings = *state.settings.lock().unwrap();
  if !settings.enabled {
    return None;
  }
  let used = state.used.lock().unwrap().is_some_and(|used| used.elapsed() < ACTIVE_FOR);
  let active =
    used && main_window(app).is_some_and(|w| w.is_focused().unwrap_or(false) && w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false));
  (!active).then_some(settings)
}

fn deliver(app: &AppHandle, port: u16, instance: &str, ids: Vec<u64>, state: &Notifications) -> bool {
  if ids.is_empty() {
    return false;
  }
  let request = serde_json::json!({ "instance": instance, "ids": ids });
  let expires = Instant::now() + Duration::from_secs(90);
  while eligible(app, state).is_some() {
    if let Some(value) = post(port, ROUTE, &request) {
      // A successful empty answer means the waits were resolved. A transport failure
      // below is retryable, including while the server restarts.
      let Ok(notice) = serde_json::from_value::<Notice>(value) else { return false };
      if let Some(current) = eligible(app, state) {
        return match notify(app, &notice, current.sound) {
          Ok(()) => true,
          Err(error) => {
            eprintln!("Obeya notification: {error}");
            false
          }
        };
      }
      return false;
    }
    if Instant::now() >= expires {
      return false;
    }
    thread::sleep(Duration::from_secs(2));
  }
  false
}

fn listen(app: &AppHandle, obeya: &Obeya) {
  let state = app.state::<Notifications>();
  let mut feed: Option<Feed> = None;
  let mut batches = Batches::default();
  loop {
    let port = obeya.port.load(Ordering::SeqCst);
    if port == 0 {
      thread::sleep(Duration::from_millis(100));
      continue;
    }
    let path = match &feed {
      Some(f) => {
        let hold = batches
          .deadline
          .map_or(50_000, |at| at.saturating_duration_since(Instant::now()).as_millis().min(50_000));
        format!("{ROUTE}?instance={}&seen={}&hold={}", f.instance, f.seen, hold)
      }
      None => ROUTE.into(),
    };
    let result = get(port, &path, Duration::from_secs(65)).and_then(|value| serde_json::from_value::<Feed>(value).ok());
    let Some(mut fresh) = result else {
      state.serving.store(false, Ordering::Relaxed);
      thread::sleep(Duration::from_secs(2));
      continue;
    };
    state.serving.store(true, Ordering::Relaxed);
    if feed.as_ref().is_some_and(|f| f.instance != fresh.instance) {
      // The old server's event IDs mean nothing here. Keep its last banner's rate limit.
      batches.next.clear();
    }
    if let Some(ids) = batches.due(Instant::now()) {
      if deliver(app, port, &fresh.instance, ids, &state) {
        batches.delivered(Instant::now());
      }
    }
    if eligible(app, &state).is_some() {
      let ids = batches.add(std::mem::take(&mut fresh.events), Instant::now());
      if !ids.is_empty() {
        if deliver(app, port, &fresh.instance, ids, &state) {
          batches.delivered(Instant::now());
        } else {
          // The rest of the burst need not wait a minute for an alert that never went out.
          batches.deadline = Some(Instant::now());
        }
      }
    }
    feed = Some(fresh);
  }
}

fn open(app: &AppHandle, obeya: &Obeya, next: Option<&str>) {
  show(app);
  let (Some(window), Some(base), Some(next)) = (main_window(app), obeya.url(), next) else {
    return;
  };
  let Ok(base) = Url::parse(&base) else { return };
  let Ok(mut target) = base.join(next) else { return };
  if target.origin() != base.origin() {
    return;
  }
  if next == NEEDS_YOU {
    // Open the list on the canvas already shown, including when several canvases are configured.
    if let Ok(current) = window.url() {
      if current.origin() == base.origin() && current.path().starts_with("/c/") {
        target.set_path(current.path().split("/card/").next().unwrap_or("/"));
      }
    }
  }
  let _ = window.navigate(target);
}

fn activate(app: &AppHandle, next: Option<String>) {
  let handle = app.clone();
  let _ = app.run_on_main_thread(move || {
    let obeya = handle.state::<Arc<Obeya>>();
    open(&handle, &obeya, next.as_deref());
  });
}

pub fn start(app: &AppHandle, obeya: Arc<Obeya>) -> tauri::Result<()> {
  // Manage the state even when off, so commands return a controlled error in developer builds.
  app.manage(Notifications {
    settings: Mutex::new(fs::read(settings_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()),
    used: Mutex::new(None),
    serving: AtomicBool::new(false),
  });
  if !installed() {
    return Ok(());
  }
  #[cfg(target_os = "macos")]
  {
    extern "C" {
      fn obeya_allow_foreground_notifications();
    }
    // SAFETY: this adds one method to the linked notification delegate before any deliveries.
    unsafe { obeya_allow_foreground_notifications() };
  }
  #[cfg(not(target_os = "linux"))]
  {
    let handle = app.clone();
    app
      .notification()
      .on_action(move |action| {
        if action.action_id() == "tap" {
          if let Some(notification) = action.notification() {
            let next = notification.extra().get("next").and_then(|value| value.as_str()).map(str::to_owned);
            activate(&handle, next);
          }
        }
      })
      .map_err(|e| tauri::Error::Anyhow(e.into()))?;
  }
  let app = app.clone();
  thread::spawn(move || listen(&app, &obeya));
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn event(id: u64, card: &str) -> Event {
    Event { id, card: card.into() }
  }

  #[test]
  fn first_notice_is_immediate_then_each_minute_batches_the_latest_wait_per_card() {
    let at = Instant::now();
    let mut batches = Batches::default();
    assert_eq!(batches.add(vec![event(1, "a"), event(2, "b")], at), [1]);
    assert!(batches.add(vec![event(3, "c"), event(4, "b")], at + Duration::from_secs(59)).is_empty());
    assert_eq!(batches.due(at + Duration::from_secs(59)), None);
    assert_eq!(batches.due(at + COOLDOWN), Some(vec![3, 4]));
    batches.delivered(at + COOLDOWN);
    assert!(batches.add(vec![event(5, "a")], at + COOLDOWN).is_empty());
    assert_eq!(batches.due(at + COOLDOWN * 2), Some(vec![5]));
    assert_eq!(batches.add(vec![event(6, "d")], at + COOLDOWN * 2), [6]);
  }
}
