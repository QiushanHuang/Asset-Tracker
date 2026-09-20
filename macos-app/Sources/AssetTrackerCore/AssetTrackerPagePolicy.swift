import Foundation

/// Native storage and file dialogs are available only to the bundled entry document.
public enum AssetTrackerPagePolicy {
    public static func allows(_ candidate: URL?, entryURL: URL) -> Bool {
        guard let candidate, candidate.isFileURL, entryURL.isFileURL,
              candidate.host == nil || candidate.host == "" || candidate.host == "localhost"
        else { return false }
        return candidate.standardizedFileURL.path == entryURL.standardizedFileURL.path
    }
}
