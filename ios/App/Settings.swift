import Foundation

/// User settings. Saved in UserDefaults and handed to inject.js as `window.__RANCH_SETTINGS__`.
/// Property names must match the keys inject.js reads.
struct Settings: Codable {
    var sponsorBlock = true
    var skipCategories = ["sponsor", "selfpromo", "interaction"]
    var dislikes = true
    var hideShorts = false
    var cleanShareLinks = true

    static let allCategories: [(id: String, name: String)] = [
        ("sponsor", "Sponsors"),
        ("selfpromo", "Self-promotion"),
        ("interaction", "Subscribe reminders"),
        ("intro", "Intros"),
        ("outro", "Endcards and credits"),
        ("preview", "Previews and recaps"),
        ("filler", "Filler and jokes"),
        ("music_offtopic", "Non-music parts of music videos"),
    ]

    private static let key = "settings"

    static func load() -> Settings {
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONDecoder().decode(Settings.self, from: data) else { return Settings() }
        return saved
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }

    var json: String {
        (try? JSONEncoder().encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}
