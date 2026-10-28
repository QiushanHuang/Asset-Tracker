import AppKit
import CoreGraphics
import ImageIO
import XCTest
@testable import AssetTrackerCore

final class AssetTrackerBillOCRTests: XCTestCase {
    func testDamagedAndOversizedInputsAreRejectedBeforeRecognition() {
        XCTAssertThrowsError(try AssetTrackerBillOCR.recognize(data: Data("not an image".utf8))) { error in
            XCTAssertTrue(error.localizedDescription.contains("图片"))
        }
        XCTAssertThrowsError(try AssetTrackerBillOCR.recognize(data: Data(repeating: 0, count: 12 * 1024 * 1024 + 1))) { error in
            XCTAssertTrue(error.localizedDescription.contains("12 MB"))
        }
    }

    func testOversizedPixelDimensionsAreRejectedBeforeVision() throws {
        let data = try image(width: 10_001, height: 10, lines: [])
        XCTAssertThrowsError(try AssetTrackerBillOCR.recognize(data: data)) { error in
            XCTAssertTrue(error.localizedDescription.contains("像素"))
        }
    }

    func testSyntheticReceiptRecognizesDateAmountAndReadingOrder() throws {
        let data = try image(width: 1400, height: 750, lines: ["LOCAL RECEIPT", "DATE: 2026-10-02", "TOTAL: 32.50", "CASH PAYMENT"])
        let recognized = try AssetTrackerBillOCR.recognize(data: data)
        XCTAssertTrue(recognized.contains("2026-10-02"), recognized)
        XCTAssertTrue(recognized.contains("32.50"), recognized)
        let dateRange = try XCTUnwrap(recognized.range(of: "2026-10-02"))
        let amountRange = try XCTUnwrap(recognized.range(of: "32.50"))
        XCTAssertLessThan(dateRange.lowerBound, amountRange.lowerBound)
    }

    func testBlankImageProducesAnActionableNoTextError() throws {
        let data = try image(width: 800, height: 500, lines: [])
        XCTAssertThrowsError(try AssetTrackerBillOCR.recognize(data: data)) { error in
            XCTAssertEqual((error as NSError).code, 5, error.localizedDescription)
            XCTAssertTrue(error.localizedDescription.contains("未识别到文字"), error.localizedDescription)
        }
    }

    private func image(width: Int, height: Int, lines: [String]) throws -> Data {
        let bitmap = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        let graphics = try XCTUnwrap(NSGraphicsContext(bitmapImageRep: bitmap))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = graphics
        NSColor.white.setFill()
        NSRect(x: 0, y: 0, width: width, height: height).fill()
        for (index, line) in lines.enumerated() {
            (line as NSString).draw(at: NSPoint(x: 80, y: height - 130 - index * 130), withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: 60, weight: .regular), .foregroundColor: NSColor.black])
        }
        NSGraphicsContext.restoreGraphicsState()
        return try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
    }
}
