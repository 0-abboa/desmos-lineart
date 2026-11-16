# Image to Line Art

Upload an image and turn it into black contour line art, rendered in the page.

The image is downscaled in-browser, converted to a darkness map, smoothed, and
traced with marching squares at several tone levels. Each traced curve becomes a
polyline, so the result is continuous outlines rather than a pixel grid or a
separate equation per pixel.

## Why it does not need Desmos

Desmos is **not** open source. Its graphing calculator is proprietary, and the
Desmos API key is licensed for prototyping only - production use requires a paid
agreement, and the embed shows a licensing modal.

So the default renderer is plain SVG written by `index.html` itself: no third
party code, no API key, no network requests. A Desmos option still exists for
people who hold a key, and it is loaded lazily only when ticked.

## Run

Serve the folder statically, or open `index.html` directly:

```bash
python3 -m http.server 8000
```

Pick an image, click **Draw image**.

## Controls

| Control | Effect |
| --- | --- |
| Resolution | Max samples per side for the trace grid |
| Contrast (gamma) | Pushes mid-tones darker or lighter before tracing |
| Tone levels | Number of iso-contours; more levels means more shading |
| Smoothing passes | 3x3 box blur passes; reduces specks and hard edges |
| Min points per curve | Drops tiny fragments |

**Save as SVG** exports the current drawing as a standalone vector file.

## Files

- `index.html` - UI, image loading, SVG renderer, optional Desmos embed
- `contour.js` - blur and marching-squares contour tracing (no DOM, testable in Node)

## Notes

Everything runs client-side. No build step, no server, no dependencies.
