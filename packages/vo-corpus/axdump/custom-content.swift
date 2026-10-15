import Accessibility
import Foundation

// Keep raw bytes beside the secure, bounded decoding; failures are observations, never an empty-content claim.
func captureCustomContent(_ value: AnyObject?, limit: (String) -> String) -> [String: Any] {
  guard let data = value as? Data else { return ["status": "unavailable"] }
  guard data.count <= 65536 else { return ["status": "too-large", "byteCount": data.count] }
  var result: [String: Any] = ["encoding": "nskeyedarchive", "byteCount": data.count, "rawBase64": data.base64EncodedString()]
  do {
    let decoded = try NSKeyedUnarchiver.unarchivedObject(ofClasses: [NSArray.self, AXCustomContent.self, NSAttributedString.self, NSDictionary.self, NSString.self, NSNumber.self], from: data)
    guard let entries = decoded as? [AXCustomContent] else { result["status"] = "unexpected-type"; return result }
    result["status"] = "observed"
    result["entries"] = entries.map { ["label": limit($0.label), "value": limit($0.value), "importance": $0.importance.rawValue] as [String: Any] }
  } catch {
    result["status"] = "decode-error"
    result["error"] = limit(String(describing: error))
  }
  return result
}
