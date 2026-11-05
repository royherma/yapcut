// Face and hand boxes every <step> s of a video, via Apple Vision. Prints JSON: [{t, face:[x,y,w,h]|null, hands:[[x,y,w,h]]}],
// boxes as fractions of the frame, origin top-left. Usage: faces <video> [step]
import AVFoundation
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 2 else { FileHandle.standardError.write("usage: faces <video> [step]\n".data(using: .utf8)!); exit(2) }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let step = args.count > 2 ? Double(args[2]) ?? 0.25 : 0.25
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 60)
gen.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 60)
gen.maximumSize = CGSize(width: 540, height: 960)
let dur = CMTimeGetSeconds(asset.duration)

func flip(_ r: CGRect) -> [Double] { [Double(r.minX), Double(1 - r.maxY), Double(r.width), Double(r.height)].map { ($0 * 1000).rounded() / 1000 } }

var out: [[String: Any]] = []
var t = 0.0
while t < dur {
  if let img = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) {
    let faces = VNDetectFaceRectanglesRequest(), hands = VNDetectHumanHandPoseRequest()
    hands.maximumHandCount = 2
    try? VNImageRequestHandler(cgImage: img, options: [:]).perform([faces, hands])
    let face = (faces.results ?? []).max { $0.boundingBox.width < $1.boundingBox.width }
    let handBoxes: [[Double]] = (hands.results ?? []).compactMap { obs in
      guard let pts = try? obs.recognizedPoints(.all) else { return nil }
      let ok = pts.values.filter { $0.confidence > 0.3 }
      guard ok.count >= 6 else { return nil }
      let xs = ok.map { $0.location.x }, ys = ok.map { $0.location.y }
      return flip(CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!))
    }
    out.append(["t": (t * 100).rounded() / 100, "face": face.map { flip($0.boundingBox) } ?? NSNull(), "hands": handBoxes])
  }
  t += step
}
let data = try JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(data)
