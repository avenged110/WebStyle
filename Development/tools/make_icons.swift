// make_icons.swift
// Renders WebStyle's toolbar/store icons: a blue rounded square with a white bold Helvetica "Aa".
// Usage: swift make_icons.swift <output folder>   (writes icon16/32/48/128.png)

import AppKit

func render(_ s: Int, to url: URL) throws {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: s, pixelsHigh: s, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let u = CGFloat(s) / 128
  let inset: CGFloat = 0 // fill the whole cell
  let rect = NSRect(x: inset*u, y: inset*u, width: (128 - 2*inset)*u, height: (128 - 2*inset)*u)
  NSColor(srgbRed: 0.18, green: 0.44, blue: 0.87, alpha: 1).setFill()
  NSBezierPath(roundedRect: rect, xRadius: 28*u, yRadius: 28*u).fill()

  let font = NSFont(name: "Helvetica-Bold", size: 79*u)!
  let text = NSAttributedString(string: "Aa", attributes: [.font: font, .foregroundColor: NSColor.white, .kern: -2*u])
  let size = text.size()
  text.draw(at: NSPoint(x: (CGFloat(s) - size.width)/2, y: (CGFloat(s) - size.height)/2 + 2*u))
  NSGraphicsContext.restoreGraphicsState()
  try rep.representation(using: .png, properties: [:])!.write(to: url)
}

let out = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
for s in [16, 32, 48, 128] { try render(s, to: out.appendingPathComponent("icon\(s).png")) }
