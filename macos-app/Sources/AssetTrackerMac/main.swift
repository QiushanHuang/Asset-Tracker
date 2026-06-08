import AppKit
import Foundation
import WebKit

final class AssetTrackerAppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var bridge: AssetTrackerHostBridge?

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMainMenu()
        createMainWindow()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func configureMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "退出智能资产记账",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        NSApp.mainMenu = mainMenu
    }

    private func createMainWindow() {
        let configuration = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        configuration.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 960),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "智能资产记账"
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        self.window = window
        self.webView = webView
        self.bridge = AssetTrackerHostBridge.attach(
            to: userContentController,
            webView: webView,
            hostWindow: window
        )

        loadRootPage(in: webView)
    }

    private func loadRootPage(in webView: WKWebView) {
        guard
            let resourcesRoot = Bundle.main.resourceURL?.appendingPathComponent("Web"),
            let indexURL = Optional(resourcesRoot.appendingPathComponent("index.html")),
            FileManager.default.fileExists(atPath: indexURL.path)
        else {
            presentFatalAlert(message: "未找到应用内置网页资源，请重新构建应用。")
            return
        }

        webView.loadFileURL(indexURL, allowingReadAccessTo: resourcesRoot)
    }

    private func presentFatalAlert(message: String) {
        let alert = NSAlert()
        alert.messageText = "智能资产记账启动失败"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = AssetTrackerAppDelegate()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
