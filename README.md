# MMM-PlanesRadar

A [MagicMirror²](https://magicmirror.builders/) module that displays nearby aircraft
(like flightradar24) on an **old-style military radar scope** — a green phosphor
circle with a rotating sweep. Blips light up when the beam passes over them and
slowly fade, just like on a real PPI radar display.

Live aircraft positions come from the free [adsb.lol](https://adsb.lol) API —
no API key required. Positions are dead-reckoned between updates, so blips keep
moving smoothly across the scope.

## Features

- Classic PPI radar look: range rings, bearing ticks, crosshairs, rotating sweep with fading trail
- Blips glow when swept and decay afterwards (phosphor effect)
- Callsign + flight level labels and velocity vectors per aircraft
- Details table with the nearest contacts: callsign, aircraft type, distance, bearing, flight level, speed
- Configurable location, range, scope size, sweep speed and colors
- Status line with contact count, range and position
- No API key, no dependencies

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/przemekf/mmm-planes-radar MMM-PlanesRadar
```

> The folder name must be `MMM-PlanesRadar` (MagicMirror resolves modules by folder name).

No `npm install` needed — the module has no dependencies (Node ≥ 18 required,
which MagicMirror already requires).

## Configuration

Add to the `modules` array in `config/config.js`:

```js
{
    module: "MMM-PlanesRadar",
    position: "top_right",
    config: {
        lat: 52.2297,      // your latitude
        lon: 21.0122,      // your longitude
        range: 100         // radar range in km
    }
},
```

### Options

| Option           | Default                             | Description                                                       |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `lat`            | `52.2297`                           | Radar center latitude                                             |
| `lon`            | `21.0122`                           | Radar center longitude                                            |
| `range`          | `100`                               | Radar range in **km** (max ~460 km / 250 NM, API limit)           |
| `updateInterval` | `15`                                | Seconds between data fetches                                      |
| `size`           | `400`                               | Scope diameter in pixels                                          |
| `rotationTime`   | `4`                                 | Seconds per full sweep rotation                                   |
| `frameRate`      | `60`                                | Max redraws per second (1–60). Lower it (e.g. `30` or `24`) on low-power hardware like a Raspberry Pi |
| `rings`          | `4`                                 | Number of range rings                                             |
| `showLabels`     | `true`                              | Show callsign + flight level next to blips                        |
| `showInfo`       | `true`                              | Show status line (contacts / range / position) under the scope    |
| `showDetails`    | `true`                              | Show a table with the nearest contacts under the scope            |
| `detailsCount`   | `3`                                 | How many nearest contacts to list in the details table            |
| `showGround`     | `false`                             | Include aircraft on the ground                                    |
| `showEffects`    | `true`                              | Gradients and glow shadows. Set `false` for flat rendering — cheaper to draw on low-power hardware |
| `maxPlanes`      | `40`                                | Maximum number of aircraft drawn (nearest first)                  |
| `color`          | `"0, 255, 65"`                      | Phosphor color as an `"r, g, b"` string (e.g. amber: `"255, 176, 0"`) |
| `apiBase`        | `"https://api.adsb.lol/v2/point"`   | Data endpoint; `"https://api.airplanes.live/v2/point"` also works |

## How it works

- `node_helper.js` polls `GET {apiBase}/{lat}/{lon}/{radius_nm}` every
  `updateInterval` seconds and forwards the aircraft list to the front-end.
- The front-end renders the scope on a `<canvas>` at 60 fps. Each aircraft's
  position is extrapolated from its last reported ground speed and track, so
  movement stays smooth between API updates.
- When the sweep beam crosses a blip's bearing, its intensity resets to full
  and then decays exponentially — the classic phosphor afterglow.

## Performance

The static scope face (rings, ticks, labels, bezel) and the sweep trail are
pre-rendered to offscreen canvases once, so each animation frame only
composites two images and draws the blips. On low-power hardware (e.g. a
Raspberry Pi) additionally set `frameRate: 30` (or `24`) to halve the render
load — the sweep speed stays the same, it just redraws less often. Setting
`showEffects: false` removes the gradients and glow shadows (the per-blip
`shadowBlur` in particular is expensive), trading the phosphor look for a
flat, cheaper-to-draw scope.

## License

MIT
