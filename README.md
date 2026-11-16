# Desmos Line Art

Upload an image and turn it into contour line art rendered live in Desmos.

The image is downscaled in-browser, converted to a darkness map, smoothed, and
traced with marching squares at several tone levels. Each traced curve becomes a
Desmos table of connected points, so the result is continuous outline curves
rather than one equation per pixel.

## Run

Serve the folder statically, or just open `index.html`:

```bash
python3 -m http.server 8000
```

Then pick an image and click **Draw image**.

## Desmos API key

`index.html` ships with `apiKey=***` as a placeholder. The calculator will not
load until you replace it with a key registered at https://www.desmos.com/api.
Keys are origin-restricted, so register whatever host you serve from.

## Controls

| Control | Effect |
| --- | --- |
| Resolution | Max samples per side for the trace grid |
| Contrast (gamma) | Pushes mid-tones darker or lighter before tracing |
| Tone levels | Number of iso-contours; more levels means more shading |
| Smoothing passes | 3x3 box blur passes; reduces noisy specks and hard edges |
| Min points per curve | Drops tiny fragments |

## Files

- `index.html` - UI, image loading, and Desmos rendering
- `contour.js` - blur and marching-squares contour tracing (no DOM, testable in Node)

## Notes

Everything runs client-side. There is no build step and no server component.
