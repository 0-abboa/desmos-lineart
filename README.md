# Image to Line Art

Upload an image and turn it into black line art, rendered in the page as SVG.

## How it draws

Not contours of brightness regions - that was the first attempt and it produced blobby
outlines. This renders like an engraving:

1. The image is downsampled and converted to a darkness map, then blurred. The blur is
   the main quality control: detail that cannot be drawn cleanly is flattened into tone.
2. Three layers of **parallel hatch lines** at different angles (-45, +45, 0 degrees).
   Each hatch line is inked only where the local tone crosses a per-line threshold, so
   the *density* of lines carries the tone: light areas stay open paper, shadows build
   up cross-hatching.
3. An optional **edge pass** traces continuous contours along strong gradients, so
   features like glasses and jawlines read as single lines instead of dissolving.

Output modes: hatching + edges, hatching only, or edges only.

## Run

Serve the folder statically, or open `index.html` directly:

```bash
python3 -m http.server 8000
```

Pick an image, click **Draw image**. **Save as SVG** exports the result as vectors.

## Controls

| Control | Effect |
| --- | --- |
| Resolution | Max samples per side; higher keeps finer detail |
| Contrast | Gamma on the darkness map |
| Smoothing | Blur before hatching. Raise it when busy areas turn muddy; lower it for detail |
| Line spacing | Distance between hatch lines in pixels |
| Darkness floor | Below this brightness the paper stays blank (keeps backgrounds clean) |

## Notes

Everything runs client-side: no build step, no server, no dependencies, no third-party
requests. Desmos is not used - it is proprietary and its API key is licensed for
prototyping only.

## Files

- `index.html` - UI, image loading, SVG rendering
- `lineart.js` - tone map, hatch layers, edge tracing (no DOM, testable in Node)

## Known limits

Engraving-style hatching works best on images with clear form and a moderate tonal range.
On very detailed, low-contrast areas (foliage, fabric folds, busy backgrounds) hatches can
still read as texture rather than form. Raise **Smoothing** to trade detail for cleaner
lines.
