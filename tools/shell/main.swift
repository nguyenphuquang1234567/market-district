// Minimal native window for the game (WKWebView). Build: npm run shell   Run: open "build/Market District.app"
// Loads the local dev server; pass a different URL as the first argument if needed.
import Cocoa
import WebKit

final class Shell: NSObject, NSApplicationDelegate, WKUIDelegate {
  var window: NSWindow!
  var web: WKWebView!

  func applicationDidFinishLaunching(_ note: Notification) {
    let cfg = WKWebViewConfiguration()
    cfg.mediaTypesRequiringUserActionForPlayback = []
    web = WKWebView(frame: .zero, configuration: cfg)
    web.uiDelegate = self
    let args = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-") }
    let size = NSSize(width: 1600, height: 900)
    window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
    window.title = "Market District"
    window.contentView = web
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(web)
    NSApp.activate(ignoringOtherApps: true)
    web.load(URLRequest(url: URL(string: args.first ?? "http://localhost:5173/")!))
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  // WebKit asks the embedding app before capturing the mouse; grant it so aiming works like in a browser tab.
  @objc(_webViewDidRequestPointerLock:completionHandler:)
  func pointerLock(_ webView: WKWebView, completionHandler: @escaping (Bool) -> Void) {
    completionHandler(!CommandLine.arguments.contains("--no-lock"))
  }
}

let app = NSApplication.shared
let shell = Shell()
app.delegate = shell
app.setActivationPolicy(.regular)
app.run()
