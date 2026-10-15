import AppKit
import CoreGraphics
import Darwin

struct CursorOverlayCapture {
  let frame: CGRect?
  let payload: [String: Any]
}

// A blank/solid image or several outlines cannot establish one visible reading location.
func overlayOutlineBounds(_ bitmap: NSBitmapImageRep, scale: Double) -> CGRect? {
  guard bitmap.hasAlpha, !bitmap.isPlanar, bitmap.bitsPerSample == 8, bitmap.samplesPerPixel == 4,
        bitmap.pixelsWide * bitmap.pixelsHigh <= 16000000, scale.isFinite, scale > 0,
        let pixels = bitmap.bitmapData else { return nil }
  let width = bitmap.pixelsWide, height = bitmap.pixelsHigh
  let alpha = bitmap.bitmapFormat.contains(.alphaFirst) ? 0 : 3
  func visible(_ x: Int, _ y: Int) -> Bool { pixels[y * bitmap.bytesPerRow + x * 4 + alpha] > 0 }
  var left = width, top = height, right = -1, bottom = -1
  for y in 0..<height { for x in 0..<width where visible(x, y) {
    left = min(left, x); top = min(top, y); right = max(right, x); bottom = max(bottom, y)
  } }
  let bandValue = ceil(6 * scale) // Includes rounded corners of the observed default VO outline.
  guard bandValue.isFinite, bandValue < Double(min(width, height)) / 2 else { return nil }
  let band = Int(bandValue)
  guard right - left > 2 * band, bottom - top > 2 * band else { return nil }
  for y in (top + band)...(bottom - band) {
    for x in (left + band)...(right - band) where visible(x, y) { return nil }
  }
  let midX = (left + right) / 2, midY = (top + bottom) / 2
  guard (top..<(top + band)).contains(where: { visible(midX, $0) }),
        ((bottom - band + 1)...bottom).contains(where: { visible(midX, $0) }),
        (left..<(left + band)).contains(where: { visible($0, midY) }),
        ((right - band + 1)...right).contains(where: { visible($0, midY) }) else { return nil }
  return CGRect(x: left, y: top, width: right - left + 1, height: bottom - top + 1)
}

func captureVoiceOverOverlay() -> CursorOverlayCapture {
  let started = Date().timeIntervalSince1970 * 1000
  var metadata: [String: Any] = ["protocol": "visible-vo-overlay-v1", "sourceClock": "guest-wall-clock", "startedAt": started]
  func unavailable(_ reason: String) -> CursorOverlayCapture {
    var payload = metadata
    payload["status"] = "unavailable"; payload["reason"] = reason
    payload["endedAt"] = Date().timeIntervalSince1970 * 1000
    return CursorOverlayCapture(frame: nil, payload: payload)
  }
  guard let voiceOver = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.VoiceOver").first else { return unavailable("VoiceOver process not found") }
  let all = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
  // Layer 2997 was verified by isolated captures on this macOS profile. A changed layer stays unobserved.
  let candidates = all.filter {
    ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == voiceOver.processIdentifier
      && ($0[kCGWindowLayer as String] as? Int) == 2997
      && ($0[kCGWindowIsOnscreen as String] as? Bool) == true
  }
  guard candidates.count == 1, let window = candidates.first,
        let id = window[kCGWindowNumber as String] as? NSNumber,
        let bounds = window[kCGWindowBounds as String] as? [String: NSNumber],
        let x = bounds["X"]?.doubleValue, let y = bounds["Y"]?.doubleValue,
        let width = bounds["Width"]?.doubleValue, let height = bounds["Height"]?.doubleValue,
        width > 0, height > 0 else { return unavailable("isolated cursor window missing or ambiguous") }
  metadata["window"] = ["id": id, "ownerPID": voiceOver.processIdentifier, "layer": 2997, "x": x, "y": y, "width": width, "height": height] as [String: Any]
  let path = FileManager.default.temporaryDirectory.appendingPathComponent("vo-overlay-\(UUID().uuidString).png")
  defer { try? FileManager.default.removeItem(at: path) }
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  process.arguments = ["-x", "-o", "-l\(id)", "-t", "png", path.path]
  process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
  do { try process.run() } catch { return unavailable("cursor window capture could not start") }
  let deadline = Date().addingTimeInterval(5)
  while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
  if process.isRunning {
    process.terminate(); Thread.sleep(forTimeInterval: 0.05)
    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    return unavailable("cursor window capture timed out")
  }
  guard process.terminationStatus == 0, let bytes = try? Data(contentsOf: path), bytes.count <= 2000000,
        let bitmap = NSBitmapImageRep(data: bytes) else { return unavailable("isolated cursor PNG unavailable") }
  metadata["pngBase64"] = bytes.base64EncodedString()
  metadata["pixelWidth"] = bitmap.pixelsWide; metadata["pixelHeight"] = bitmap.pixelsHigh
  let scale = Double(bitmap.pixelsWide) / width
  guard abs(Double(bitmap.pixelsHigh) / height - scale) < 0.001,
        let pixels = overlayOutlineBounds(bitmap, scale: scale) else { return unavailable("single hollow cursor outline not established") }
  let frame = CGRect(x: x + pixels.minX / scale, y: y + pixels.minY / scale, width: pixels.width / scale, height: pixels.height / scale)
  metadata["frame"] = ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
  metadata["status"] = "observed"
  metadata["endedAt"] = Date().timeIntervalSince1970 * 1000
  return CursorOverlayCapture(frame: frame, payload: metadata)
}
