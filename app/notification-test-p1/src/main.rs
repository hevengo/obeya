use std::{thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
async fn notify(app: AppHandle, grouped: bool) -> Result<(), String> {
  let (title, body) = if grouped {
    (
      "3 cards need you",
      "Add CSV export to orders · Fix the checkout total · Update the invoice preview",
    )
  } else {
    ("Add CSV export to orders", "A question for you · Shop")
  };

  // The native timer keeps running after the webview leaves the foreground.
  tauri::async_runtime::spawn_blocking(move || {
    thread::sleep(Duration::from_secs(10));
    app.notification()
      .builder()
      .title(title)
      .body(body)
      .sound("NSUserNotificationDefaultSoundName")
      .show()
      .map_err(|error| error.to_string())
  })
  .await
  .map_err(|error| error.to_string())?
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![notify])
    .setup(|app| {
      let handle = app.handle().clone();
      app.notification().on_action(move |action| {
        let Some(title) = action.notification().and_then(|notification| notification.title()).map(str::to_owned) else {
          return;
        };
        if let Some(window) = handle.get_webview_window("main") {
          let _ = window.show();
          let _ = window.unminimize();
          let _ = window.set_focus();
          let _ = window.emit("notification-clicked", title);
        }
      })?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("could not run the notification test app");
}
