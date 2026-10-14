// Dumps the macOS accessibility tree of a browser's web area as JSON. Read-only: AX attribute reads only, no activation, keys or clicks.
// Usage: axdump --app Safari|"Google Chrome" [--max-depth 60] [--max-nodes 5000]
// Exit codes: 0 ok, 1 no app/window/web area or bad usage, 2 accessibility permission missing.
import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String, _ code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data("axdump: \(message)\n".utf8))
  exit(code)
}

var appName = ""
var maxDepth = 60
var maxNodes = 5000
var maxStringLength = 500
var arguments = Array(CommandLine.arguments.dropFirst())
while !arguments.isEmpty {
  let flag = arguments.removeFirst()
  guard let value = arguments.first else { fail("missing value for \(flag)") }
  arguments.removeFirst()
  switch flag {
  case "--app": appName = value
  case "--max-depth": maxDepth = Int(value) ?? maxDepth
  case "--max-nodes": maxNodes = Int(value) ?? maxNodes
  case "--max-string-length": maxStringLength = Int(value) ?? maxStringLength
  default: fail("unknown flag \(flag)")
  }
}
if appName.isEmpty { fail("--app is required (Safari or \"Google Chrome\")") }
if maxStringLength < 1 || maxStringLength > 1000000 { fail("--max-string-length must be between 1 and 1000000") }

// Without the grant every call returns kAXErrorAPIDisabled. Do not prompt: the prompt would be a UI side effect.
if !AXIsProcessTrusted() {
  fail("accessibility permission missing. Allow the terminal app that runs this in System Settings > Privacy & Security > Accessibility, then run again.", 2)
}

guard let running = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == appName && $0.activationPolicy == .regular }) else {
  fail("\(appName) is not running")
}
let application = AXUIElementCreateApplication(running.processIdentifier)
AXUIElementSetMessagingTimeout(application, 3)

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func elements(_ element: AXUIElement, _ name: String) -> [AXUIElement] {
  (attribute(element, name) as? [AXUIElement]) ?? []
}
func isElement(_ value: AnyObject?) -> Bool {
  guard let value else { return false }
  return CFGetTypeID(value) == AXUIElementGetTypeID()
}
func string(_ element: AXUIElement, _ name: String) -> String? { attribute(element, name) as? String }

let window: AXUIElement? = {
  for name in ["AXFocusedWindow", "AXMainWindow"] {
    if let found = attribute(application, name), isElement(found) { return (found as! AXUIElement) }
  }
  return elements(application, "AXWindows").first
}()
guard let window else { fail("\(appName) has no window (or the window is not exposed to accessibility)") }

/** Breadth first, so the web area nearest the window root wins over any nested one. */
func findWebArea(_ root: AXUIElement) -> AXUIElement? {
  var queue = [root], seen = 0
  while !queue.isEmpty && seen < 20000 {
    let element = queue.removeFirst()
    seen += 1
    if string(element, "AXRole") == "AXWebArea" { return element }
    queue.append(contentsOf: elements(element, "AXChildren"))
  }
  return nil
}
guard let webArea = findWebArea(window) else {
  fail("no AXWebArea in the \(appName) window. Chrome exposes its web tree only while an assistive technology is active (VoiceOver on).")
}

let focused: AXUIElement? = { let f = attribute(application, "AXFocusedUIElement"); return isElement(f) ? (f as! AXUIElement) : nil }()

let wanted: [String] = [
  "AXRole", "AXSubrole", "AXRoleDescription", "AXTitle", "AXDescription", "AXValue", "AXHelp", "AXPlaceholderValue",
  "AXDOMIdentifier", "AXDOMClassList", "AXEnabled", "AXFocused", "AXSelected", "AXExpanded", "AXRequired", "AXVisited",
  "AXARIALive", "AXARIAAtomic", "AXARIASetSize", "AXARIAPosInSet", "AXARIALevel", "AXARIACurrent", "AXInvalid", "AXURL",
]

var stringTruncations = 0
func limited(_ s: String) -> String {
  if s.count <= maxStringLength { return s }
  stringTruncations += 1
  return String(s.prefix(maxStringLength)) + "…"
}
func json(_ value: AnyObject) -> Any? {
  switch value {
  case let s as String: return limited(s)
  case let n as NSNumber: return CFGetTypeID(n) == CFBooleanGetTypeID() ? n.boolValue : n
  case let u as URL: return u.absoluteString
  case let a as [AnyObject]: return a.compactMap(json)
  default:
    if CFGetTypeID(value) == AXUIElementGetTypeID() { return nil }
    let s = "\(value)"
    return limited(s)
  }
}

var nodeCount = 0
var truncated = false
var focusedPath: [Int]?

func dump(_ element: AXUIElement, depth: Int, path: [Int]) -> [String: Any] {
  nodeCount += 1
  if focusedPath == nil, let focused, CFEqual(element, focused) { focusedPath = path }
  var names: CFArray?
  let available = AXUIElementCopyAttributeNames(element, &names) == .success ? (names as? [String] ?? []) : []
  var node: [String: Any] = [:]
  for name in wanted where available.contains(name) {
    if let value = attribute(element, name), let converted = json(value) { node[name] = converted }
  }
  let children = available.contains("AXChildren") ? elements(element, "AXChildren") : []
  if depth >= maxDepth {
    if !children.isEmpty { node["childrenTruncated"] = children.count; truncated = true }
    return node
  }
  var out: [[String: Any]] = []
  for (index, child) in children.enumerated() {
    if nodeCount >= maxNodes { node["childrenTruncated"] = children.count - index; truncated = true; break }
    out.append(dump(child, depth: depth + 1, path: path + [index]))
  }
  if !out.isEmpty { node["children"] = out }
  return node
}

let tree = dump(webArea, depth: 0, path: [])
var result: [String: Any] = [
  "app": appName,
  "pid": Int(running.processIdentifier),
  "windowTitle": string(window, "AXTitle") ?? "",
  "timestamp": ISO8601DateFormatter().string(from: Date()),
  "maxDepth": maxDepth, "maxNodes": maxNodes, "maxStringLength": maxStringLength, "stringTruncations": stringTruncations, "nodeCount": nodeCount, "truncated": truncated,
  "root": tree,
]
// Path of child indices from the web area root; null when focus is outside the web area (address bar, toolbar) or none.
result["focusedPath"] = focusedPath ?? NSNull()
if let focused {
  result["focusedRole"] = string(focused, "AXRole") ?? NSNull()
}
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
