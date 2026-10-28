import Foundation
import CoreGraphics
import ImageIO
import Vision

/// Extracts local receipt text only. Call from a background queue; this never writes a ledger.
public enum AssetTrackerBillOCR {
    public static func recognize(data: Data) throws -> String {
        guard !data.isEmpty, data.count <= 12 * 1024 * 1024 else {
            throw failure("图片为空或超过 12 MB，请裁剪后重试", code: 1)
        }
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options),
              let type = CGImageSourceGetType(source) as String?,
              ["public.png", "public.jpeg", "public.heic", "public.heif"].contains(type),
              CGImageSourceGetCount(source) == 1,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue else {
            throw failure("无法读取图片，请选择完整的 PNG、JPEG 或 HEIC 单张账单截图", code: 2)
        }
        guard width > 0, height > 0, width <= 10_000, height <= 10_000,
              width <= 24_000_000 / height else {
            throw failure("图片像素过大，单边最多 10,000 像素且总计最多 2,400 万像素，请裁剪后重试", code: 3)
        }
        guard let image = CGImageSourceCreateImageAtIndex(source, 0, options) else {
            throw failure("图片内容损坏，无法识别", code: 2)
        }
        let orientationValue = (properties[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
        let orientation = CGImagePropertyOrientation(rawValue: orientationValue) ?? .up
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        request.preferBackgroundProcessing = true
        let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
        do {
            try handler.perform([request])
        } catch {
            throw failure("本机文字识别暂时不可用，请重试或粘贴账单文字（\(error.localizedDescription)）", code: 4)
        }
        let lines = (request.results ?? []).compactMap { observation -> Line? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let content = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            return content.isEmpty ? nil : Line(text: content, bounds: observation.boundingBox)
        }
        guard !lines.isEmpty else {
            throw failure("未识别到文字，请选择清晰的账单截图或粘贴文字", code: 5)
        }
        let result = readingOrder(lines).map(\.text).joined(separator: "\n")
        guard result.count <= 100_000 else {
            throw failure("识别文字过多，请裁剪为单张账单后重试", code: 6)
        }
        return result
    }

    private struct Line {
        let text: String
        let bounds: CGRect
    }

    // Vision coordinates start at the bottom left. Group a visual row before sorting
    // its columns to avoid a tolerance-based, non-transitive sort comparator.
    private static func readingOrder(_ lines: [Line]) -> [Line] {
        let vertical = lines.sorted {
            if $0.bounds.midY == $1.bounds.midY { return $0.bounds.minX < $1.bounds.minX }
            return $0.bounds.midY > $1.bounds.midY
        }
        var rows: [[Line]] = []
        for line in vertical {
            if let last = rows.last?.first,
               abs(last.bounds.midY - line.bounds.midY) <= min(last.bounds.height, line.bounds.height) * 0.5 {
                rows[rows.count - 1].append(line)
            } else {
                rows.append([line])
            }
        }
        return rows.flatMap { $0.sorted { $0.bounds.minX < $1.bounds.minX } }
    }

    private static func failure(_ message: String, code: Int) -> NSError {
        NSError(domain: "AssetTrackerBillOCR", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
