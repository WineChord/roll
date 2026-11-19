import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Crop: Codable {
    let source: String
    let output: String
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

enum CropError: Error {
    case invalidArguments
    case cannotOpenImage(String)
    case cannotCrop(String)
    case cannotCreateDestination(String)
}

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(
        Data("Usage: swift crop-screenshots.swift <manifest.json> <output-dir>\n".utf8)
    )
    exit(2)
}

let manifestURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(
    at: outputDirectory,
    withIntermediateDirectories: true
)

let decoder = JSONDecoder()
let crops = try decoder.decode([Crop].self, from: Data(contentsOf: manifestURL))
var imageCache: [String: CGImage] = [:]

for crop in crops {
    let image: CGImage
    if let cached = imageCache[crop.source] {
        image = cached
    } else {
        let sourceURL = URL(fileURLWithPath: crop.source)
        guard
            let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
            let loaded = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            throw CropError.cannotOpenImage(crop.source)
        }
        imageCache[crop.source] = loaded
        image = loaded
    }

    guard let cropped = image.cropping(
        to: CGRect(
            x: crop.x,
            y: crop.y,
            width: crop.width,
            height: crop.height
        )
    ) else {
        throw CropError.cannotCrop(crop.output)
    }

    let outputURL = outputDirectory.appendingPathComponent(crop.output)
    guard let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else {
        throw CropError.cannotCreateDestination(outputURL.path)
    }
    let options = [kCGImageDestinationLossyCompressionQuality: 0.76] as CFDictionary
    CGImageDestinationAddImage(destination, cropped, options)
    guard CGImageDestinationFinalize(destination) else {
        throw CropError.cannotCreateDestination(outputURL.path)
    }
}

print("Wrote \(crops.count) merchant crops to \(outputDirectory.path)")
