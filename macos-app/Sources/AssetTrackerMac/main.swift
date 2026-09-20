import AppKit
import AssetTrackerCore
import Foundation
import WebKit

@MainActor
final class AssetTrackerAppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var bridge: AssetTrackerHostBridge?
    private var entryURL: URL?

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
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 960),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        let isPreview = CommandLine.arguments.contains("--preview")
        window.title = isPreview ? "智能资产记账 · 独立预览账本" : "智能资产记账"
        window.minSize = NSSize(width: 520, height: 480)
        window.setFrameAutosaveName("AssetTrackerMainWindow")
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        self.window = window
        self.webView = webView
        let applicationSupportURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        // Preview launches never open or write the user's real ledger.
        let storageDirectoryURL = isPreview
            ? FileManager.default.temporaryDirectory.appendingPathComponent("AssetTrackerPreview-" + UUID().uuidString, isDirectory: true)
            : applicationSupportURL.appendingPathComponent("com.qiushan.AssetTracker", isDirectory: true)
        let bookStore = AssetTrackerBookStore(storageDirectoryURL: storageDirectoryURL)
        self.bridge = AssetTrackerHostBridge.attach(
            to: userContentController,
            webView: webView,
            hostWindow: window,
            bookStore: bookStore
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

        self.entryURL = indexURL
        webView.loadFileURL(indexURL, allowingReadAccessTo: resourcesRoot)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let entryURL,
              navigationAction.targetFrame?.isMainFrame == true,
              AssetTrackerPagePolicy.allows(navigationAction.request.url, entryURL: entryURL)
        else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame, let entryURL,
              AssetTrackerPagePolicy.allows(frame.request.url, entryURL: entryURL)
        else { completionHandler(false); return }
        let alert = NSAlert()
        alert.messageText = "确认账本操作"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        if let window {
            alert.beginSheetModal(for: window) { response in
                completionHandler(response == .alertFirstButtonReturn)
            }
        } else { completionHandler(false) }
    }

    private func presentFatalAlert(message: String) {
        let alert = NSAlert()
        alert.messageText = "智能资产记账启动失败"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = AssetTrackerAppDelegate()
    application.setActivationPolicy(.regular)
    application.delegate = delegate
    application.run()
}
