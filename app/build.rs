fn main() {
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
    println!("cargo:rerun-if-changed=src/notification-foreground.m");
    cc::Build::new()
      .file("src/notification-foreground.m")
      .flag("-Wno-deprecated-declarations")
      .compile("obeya-notification-foreground");
  }
  tauri_build::build();
}
