import UIKit

final class SettingsViewController: UITableViewController {
    private var settings: Settings
    private let onChange: (Settings) -> Void

    private enum Toggle: Int { case dislikes, hideShorts, cleanLinks, sponsorBlock }

    init(settings: Settings, onChange: @escaping (Settings) -> Void) {
        self.settings = settings
        self.onChange = onChange
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Settings"
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(close))
    }

    @objc private func close() { dismiss(animated: true) }

    override func numberOfSections(in tableView: UITableView) -> Int { 2 }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? 3 : 1 + Settings.allCategories.count
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        section == 1 ? "SponsorBlock" : nil
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == 0
            ? "Open this screen with the gear button in the top bar, or by holding two fingers on the screen."
            : "Only the first characters of a hash of the video ID are sent, so the server never learns what you watch."
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        var content = cell.defaultContentConfiguration()

        if indexPath.section == 1 && indexPath.row > 0 {
            let category = Settings.allCategories[indexPath.row - 1]
            content.text = category.name
            content.textProperties.color = settings.sponsorBlock ? .label : .secondaryLabel
            cell.accessoryType = settings.skipCategories.contains(category.id) ? .checkmark : .none
            cell.selectionStyle = settings.sponsorBlock ? .default : .none
        } else {
            let toggle: Toggle = indexPath.section == 1 ? .sponsorBlock : (Toggle(rawValue: indexPath.row) ?? .dislikes)
            let toggleSwitch = UISwitch()
            toggleSwitch.tag = toggle.rawValue
            toggleSwitch.addTarget(self, action: #selector(switched(_:)), for: .valueChanged)
            switch toggle {
            case .dislikes: content.text = "Dislike counts"; toggleSwitch.isOn = settings.dislikes
            case .hideShorts: content.text = "Hide Shorts"; toggleSwitch.isOn = settings.hideShorts
            case .cleanLinks: content.text = "Remove tracking from shared links"; toggleSwitch.isOn = settings.cleanShareLinks
            case .sponsorBlock: content.text = "Skip segments"; toggleSwitch.isOn = settings.sponsorBlock
            }
            cell.accessoryView = toggleSwitch
            cell.selectionStyle = .none
        }
        cell.contentConfiguration = content
        return cell
    }

    @objc private func switched(_ sender: UISwitch) {
        guard let toggle = Toggle(rawValue: sender.tag) else { return }
        switch toggle {
        case .dislikes: settings.dislikes = sender.isOn
        case .hideShorts: settings.hideShorts = sender.isOn
        case .cleanLinks: settings.cleanShareLinks = sender.isOn
        case .sponsorBlock:
            settings.sponsorBlock = sender.isOn
            let rows = (1...Settings.allCategories.count).map { IndexPath(row: $0, section: 1) }
            tableView.reloadRows(at: rows, with: .none)
        }
        onChange(settings)
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard indexPath.section == 1, indexPath.row > 0, settings.sponsorBlock else { return }
        let id = Settings.allCategories[indexPath.row - 1].id
        if let index = settings.skipCategories.firstIndex(of: id) {
            settings.skipCategories.remove(at: index)
        } else {
            settings.skipCategories.append(id)
        }
        tableView.reloadRows(at: [indexPath], with: .none)
        onChange(settings)
    }
}
