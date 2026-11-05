import AppKit
import Vision
for path in CommandLine.arguments.dropFirst() {
  guard let image = NSImage(contentsOfFile: path), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("[]"); continue }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
  var rows: [String] = []
  for r in request.results ?? [] {
    guard let c = r.topCandidates(1).first, c.confidence > 0.4 else { continue }
    let b = r.boundingBox
    let t = c.string.replacingOccurrences(of: "\"", with: "'")
    rows.append(String(format: "{\"t\":\"%@\",\"x\":%.3f,\"y\":%.3f,\"w\":%.3f,\"h\":%.3f}", t, b.minX, 1 - b.maxY, b.width, b.height))
  }
  print("[" + rows.joined(separator: ",") + "]")
}
