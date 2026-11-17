#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

// The legacy backend owns this delegate and uses it for activation. Add the public
// foreground presentation callback without replacing the delegate or its click handling.
static BOOL present(id delegate, SEL selector, NSUserNotificationCenter *center, NSUserNotification *notification) {
  (void)delegate;
  (void)selector;
  (void)center;
  (void)notification;
  return YES;
}

void obeya_allow_foreground_notifications(void) {
  Class delegate = NSClassFromString(@"NotificationCenterDelegate");
  if (delegate) {
    class_addMethod(delegate, @selector(userNotificationCenter:shouldPresentNotification:),
                    (IMP)present, @encode(BOOL)[0] == 'c' ? "c@:@@" : "B@:@@");
  }
}
