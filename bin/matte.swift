// Person cut-out mask for every frame of a video, via Apple Vision person segmentation. Writes raw 8-bit gray frames
// (w x h each) to stdout for ffmpeg to merge as alpha. Usage: matte <video> <w> <h> [fast|balanced|accurate] [fromFrame] [toFrame] [startSec]
import AVFoundation
import CoreImage
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 4, let W = Int(args[2]), let H = Int(args[3]) else { FileHandle.standardError.write("usage: matte <video> <w> <h> [fast|balanced|accurate]\n".data(using: .utf8)!); exit(2) }
let level: VNGeneratePersonSegmentationRequest.QualityLevel = args.count > 4 && args[4] == "fast" ? .fast : args.count > 4 && args[4] == "accurate" ? .accurate : .balanced
let from = args.count > 5 ? Int(args[5]) ?? 0 : 0, upTo = args.count > 6 ? Int(args[6]) ?? Int.max : Int.max
// ffprobe's start_time: AVAssetReader hands back an extra blank frame before it when the mp4 has a B-frame delay.
let startSec = args.count > 7 ? Double(args[7]) ?? 0 : 0
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let track = asset.tracks(withMediaType: .video)[0]
let reader = try! AVAssetReader(asset: asset)
let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(output)
reader.startReading()
let req = VNGeneratePersonSegmentationRequest()
req.qualityLevel = level
req.outputPixelFormat = kCVPixelFormatType_OneComponent8
let ctx = CIContext(options: [.workingColorSpace: NSNull()])
let gray = CGColorSpaceCreateDeviceGray()
var buf = [UInt8](repeating: 0, count: W * H)
let out = FileHandle.standardOutput
var n = 0, i = -1
let t0 = Date()
while let sample = output.copyNextSampleBuffer(), let px = CMSampleBufferGetImageBuffer(sample) {
  if CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) < startSec - 0.005 { continue }
  i += 1
  if i < from { continue }
  if i >= upTo { break }
  try? VNImageRequestHandler(cvPixelBuffer: px, options: [:]).perform([req])
  guard let mask = req.results?.first?.pixelBuffer else { out.write(Data(buf)); n += 1; continue }
  let m = CIImage(cvPixelBuffer: mask)
  let scaled = m.transformed(by: CGAffineTransform(scaleX: CGFloat(W) / m.extent.width, y: CGFloat(H) / m.extent.height))
  ctx.render(scaled, toBitmap: &buf, rowBytes: W, bounds: CGRect(x: 0, y: 0, width: W, height: H), format: .L8, colorSpace: gray)
  out.write(Data(buf))
  n += 1
}
FileHandle.standardError.write("frames \(n) ms/frame \(String(format: "%.1f", Date().timeIntervalSince(t0) * 1000 / Double(max(n, 1))))\n".data(using: .utf8)!)
