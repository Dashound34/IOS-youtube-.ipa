import UIKit
import WebKit

final class WebViewController: UIViewController {
    private var webView: WKWebView!
    private var settings = Settings.load()
    private let refresh = UIRefreshControl()

    private static let home = URL(string: "https://m.youtube.com/")!
    private static let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    /// The only hosts inject.js may fetch from (through the native bridge, which avoids CORS/CSP problems).
    private static let bridgeHosts: Set<String> = ["sponsor.ajay.app", "returnyoutubedislikeapi.com"]
    /// Pages on these domains open inside the app; any other link opens in Safari.
    private static let internalDomains = ["youtube.com", "youtu.be", "youtube-nocookie.com", "google.com",
                                          "gstatic.com", "googleusercontent.com", "ytimg.com", "googlevideo.com", "ggpht.com"]

    private static let pageScript: String = {
        guard let url = Bundle.main.url(forResource: "inject", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return source
    }()

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "ranch")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "ranchFetch")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.customUserAgent = Self.userAgent
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        installUserScripts()

        refresh.addTarget(self, action: #selector(reloadPage), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        let press = UILongPressGestureRecognizer(target: self, action: #selector(twoFingerPress(_:)))
        press.numberOfTouchesRequired = 2
        press.minimumPressDuration = 0.6
        press.delegate = self
        webView.addGestureRecognizer(press)

        let root = UIView()
        root.backgroundColor = .systemBackground
        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: root.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.safeAreaLayoutGuide.trailingAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let url = Bundle.main.url(forResource: "blocklist", withExtension: "json"),
              let rules = try? String(contentsOf: url, encoding: .utf8) else {
            webView.load(URLRequest(url: Self.home))
            return
        }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "ranch-blocklist",
                                                                encodedContentRuleList: rules) { [weak self] list, error in
            guard let self = self else { return }
            if let list = list {
                self.webView.configuration.userContentController.add(list)
            } else if let error = error {
                NSLog("Blocklist failed to compile: \(error)")
            }
            self.webView.load(URLRequest(url: Self.home))
        }
    }

    private func installUserScripts() {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: "window.__RANCH_SETTINGS__ = \(settings.json);",
                                       injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: Self.pageScript,
                                       injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func applySettings(_ new: Settings) {
        settings = new
        settings.save()
        installUserScripts()
        webView.evaluateJavaScript("window.__ranchApplySettings && window.__ranchApplySettings(\(settings.json)); void 0")
    }

    @objc private func reloadPage() { webView.reload() }

    @objc private func twoFingerPress(_ gesture: UILongPressGestureRecognizer) {
        if gesture.state == .began { openSettings() }
    }

    private func openSettings() {
        guard presentedViewController == nil else { return }
        let vc = SettingsViewController(settings: settings) { [weak self] s in self?.applySettings(s) }
        present(UINavigationController(rootViewController: vc), animated: true)
    }

    static func isInternal(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return internalDomains.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// Messages are only accepted from the YouTube page itself, never from ad or embed iframes.
    private static func isTrusted(_ message: WKScriptMessage) -> Bool {
        let host = message.frameInfo.securityOrigin.host.lowercased()
        return message.frameInfo.isMainFrame && internalDomains.contains { host == $0 || host.hasSuffix("." + $0) }
    }
}

// MARK: - Navigation

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        switch scheme {
        case "http", "https":
            let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
            if !isMainFrame || Self.isInternal(url) {
                decisionHandler(.allow)
            } else {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            }
        case "about", "blob", "data":
            decisionHandler(.allow)
        case "vnd.youtube", "youtube":
            decisionHandler(.cancel) // "Open in app" prompts; we already are the app
        default:
            UIApplication.shared.open(url) // mailto:, tel:, other apps
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { refresh.endRefreshing() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { refresh.endRefreshing() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        refresh.endRefreshing()
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
}

extension WebViewController: WKUIDelegate {
    // Links with target=_blank: load YouTube pages here, send everything else to Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if Self.isInternal(url) { webView.load(navigationAction.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }
}

// MARK: - Bridge for inject.js

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard Self.isTrusted(message) else { return }
        if message.name == "ranch", (message.body as? String) == "openSettings" { openSettings() }
    }
}

extension WebViewController: WKScriptMessageHandlerWithReply {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard Self.isTrusted(message),
              let string = message.body as? String,
              let url = URL(string: string), url.scheme == "https",
              let host = url.host, Self.bridgeHosts.contains(host) else {
            replyHandler(nil, "Blocked")
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    replyHandler(nil, error.localizedDescription)
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                replyHandler(["status": status, "body": body], nil)
            }
        }.resume()
    }
}

extension WebViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}
