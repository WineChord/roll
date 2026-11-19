import AppKit
import Foundation
import ImageIO
import Vision

struct OCRLine: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

enum OCRError: Error {
    case cannotOpenImage(URL)
    case noCGImage(URL)
}

func recognize(url: URL) throws -> [OCRLine] {
    guard
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        throw OCRError.cannotOpenImage(url)
    }

    let imageHeight = image.height
    let tileHeight = 2400
    var lines: [OCRLine] = []

    // Vision caps useful recognition dimensions for very tall pages. Tiling keeps
    // merchant text at a normal screen scale and preserves the source y position.
    for top in stride(from: 0, to: imageHeight, by: tileHeight) {
        let height = min(tileHeight, imageHeight - top)
        guard let tile = image.cropping(
            to: CGRect(x: 0, y: top, width: image.width, height: height)
        ) else {
            throw OCRError.noCGImage(url)
        }

        let scale = 2
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil,
            width: tile.width * scale,
            height: tile.height * scale,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw OCRError.noCGImage(url)
        }
        context.interpolationQuality = .high
        context.draw(
            tile,
            in: CGRect(
                x: 0,
                y: 0,
                width: tile.width * scale,
                height: tile.height * scale
            )
        )
        guard let enlarged = context.makeImage() else {
            throw OCRError.noCGImage(url)
        }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true
        request.minimumTextHeight = 0.0005

        let handler = VNImageRequestHandler(cgImage: enlarged, options: [:])
        try handler.perform([request])

        for observation in request.results ?? [] {
            guard let candidate = observation.topCandidates(1).first else {
                continue
            }
            let box = observation.boundingBox
            lines.append(
                OCRLine(
                    text: candidate.string,
                    confidence: candidate.confidence,
                    x: box.minX,
                    y: Double(top + Int((1 - box.maxY) * CGFloat(height)))
                        / Double(imageHeight),
                    width: box.width,
                    height: Double(box.height * CGFloat(height)) / Double(imageHeight)
                )
            )
        }
    }

    return lines
}

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write(
        Data("Usage: swift ocr-screenshots.swift <image> [image ...]\n".utf8)
    )
    exit(2)
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]

for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    do {
        let lines = try recognize(url: url)
        let wrapper: [String: Any] = [
            "image": url.lastPathComponent,
            "lines": try JSONSerialization.jsonObject(with: encoder.encode(lines))
        ]
        let data = try JSONSerialization.data(withJSONObject: wrapper, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        FileHandle.standardError.write(
            Data("\(url.path): \(error)\n".utf8)
        )
        exit(1)
    }
}
