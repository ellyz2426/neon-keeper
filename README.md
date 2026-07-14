# Neon Keeper VR

A neon-drenched VR goalkeeper game built with [IWSDK](https://iwsdk.dev). Block, catch, and dive to save shots in a futuristic arena. Plays in VR headsets with motion controllers or in browser with mouse + keyboard.

## 🎮 Play

**[Play Now](https://ellyz2426.github.io/neon-keeper/)**

## Features

### Core Gameplay
- **6 shot types**: Standard, Curve (swerving), Power (fast/heavy), Split (divides mid-flight), Phantom (vanishes mid-air), Multi (3-shot spread)
- **4 game modes**: Arcade (endless, 3 lives), Challenge (10 scripted levels), Training (slow, infinite), Time Attack (60s)
- **3 difficulty levels** with dynamic difficulty adjustment in Arcade
- **Boss waves** every 5th wave — oversized shots requiring 3 hits to defeat
- **Wave modifiers**: Fast Shots, Giant Balls, Tiny Goal, Mirror Controls, Thick Fog

### VR Controls
- Dual-controller blocking with grip-catch bonus
- Haptic feedback on saves and goals
- Head-locked HUD via Follower component
- All UI via PanelUI spatial panels — no HTML overlays

### Browser Controls
- **Mouse**: Aim gauntlets (follows cursor position)
- **WASD / Arrow Keys**: Move gauntlets
- **Space / Q / E**: Dive left/right for extended reach
- Keyboard + mouse combine for precise control

### Progression
- **20 achievements** tracked across sessions
- **9-tier rank system**: Rookie → Mythic
- **Leaderboard**: Top 5 runs per mode with grade tracking
- **Per-mode career stats** with save rate, best streaks, play time
- **Gauntlet customization**: 5 color options (Cyan, Green, Gold, Pink, White)
- All progress persisted via localStorage

### Audio & Visuals
- **Generative background music**: Chord pad + bass drone + sequenced arpeggio, tempo scales with wave
- **16+ procedural SFX**: Per-shot-type approach sounds, save/catch/goal effects, power-up collection, dive whoosh, boss impact/defeat
- **Visual effects**: Save particles, score popups, goal flash + camera shake, net ripple, screen flash on milestones
- **Arena atmosphere**: Starfield, beacon pillars, orbiting accent spheres, 40 floating motes, neon floor ring
- **Arena reactivity**: Floor grid pulses with combo, save shockwave rings, per-mode color themes
- **Power-ups**: Shield Expand, Slow-Mo, Double Points, Magnet — floating orbs with 10s duration
- **Combo system**: Visual rings scale and color-shift with streak, shield discs grow, milestone celebrations at 5/10/15/20x

### Technical
- Built with IWSDK 0.4.x (Three.js + ECS)
- 9 PanelUI spatial panels (`.uikitml` compiled)
- ~3,400 lines TypeScript
- Dual-runtime: VR + browser with `browserControls: true`

## Development

```bash
npm install
npm run dev    # starts IWSDK dev server at https://127.0.0.1:8081
npm run build  # production build to dist/
```

## License

MIT
