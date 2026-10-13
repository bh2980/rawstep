// Prints the current keyboard input source ID, or selects one: `inputsource` / `inputsource com.apple.keylayout.ABC`.
// VoiceOver letter commands (VO+U, VO+Cmd+H) arrive as physical key codes, and with a Korean input source they do nothing,
// so collection switches to a Latin layout and restores the user's source afterwards.
import Carbon

func current() -> String {
  let source = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
  return Unmanaged<CFString>.fromOpaque(TISGetInputSourceProperty(source, kTISPropertyInputSourceID)).takeUnretainedValue() as String
}

let args = CommandLine.arguments.dropFirst()
guard let wanted = args.first else { print(current()); exit(0) }
let filter = [kTISPropertyInputSourceID as String: wanted] as CFDictionary
guard let sources = TISCreateInputSourceList(filter, false)?.takeRetainedValue() as? [TISInputSource], let source = sources.first else {
  FileHandle.standardError.write("inputsource: \(wanted) is not an enabled input source\n".data(using: .utf8)!)
  exit(1)
}
let status = TISSelectInputSource(source)
if status != noErr { FileHandle.standardError.write("inputsource: select failed (\(status))\n".data(using: .utf8)!); exit(1) }
print(current())
