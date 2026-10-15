func bitmap() -> NSBitmapImageRep {
  let image = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 100, pixelsHigh: 80, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  image.bitmapData!.initialize(repeating: 0, count: image.bytesPerRow * image.pixelsHigh)
  return image
}
func setAlpha(_ image: NSBitmapImageRep, _ x: Int, _ y: Int) { image.bitmapData![y * image.bytesPerRow + x * 4 + 3] = 255 }
func outline(_ image: NSBitmapImageRep, _ x: Int, _ y: Int, _ w: Int, _ h: Int) {
  for i in x..<(x + w) { setAlpha(image, i, y); setAlpha(image, i, y + h - 1) }
  for j in y..<(y + h) { setAlpha(image, x, j); setAlpha(image, x + w - 1, j) }
}
let blank = bitmap()
precondition(overlayOutlineBounds(blank, scale: 1) == nil)
let single = bitmap(); outline(single, 10, 20, 50, 30)
precondition(overlayOutlineBounds(single, scale: 1) == CGRect(x: 10, y: 20, width: 50, height: 30))
let solid = bitmap()
for y in 20..<50 { for x in 10..<60 { setAlpha(solid, x, y) } }
precondition(overlayOutlineBounds(solid, scale: 1) == nil)
let multiple = bitmap(); outline(multiple, 5, 5, 30, 25); outline(multiple, 55, 40, 30, 25)
precondition(overlayOutlineBounds(multiple, scale: 1) == nil)
precondition(overlayOutlineBounds(single, scale: .nan) == nil)
precondition(overlayOutlineBounds(single, scale: 1e308) == nil)
print("cursor outline cases passed")
