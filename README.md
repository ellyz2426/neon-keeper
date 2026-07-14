# Neon Keeper VR

A neon-drenched VR goalkeeper game built with [IWSDK](https://iwsdk.dev). Block, catch, and dive to save shots in a futuristic arena. Plays in VR headsets with motion controllers or in browser with mouse + keyboard.

## Play

**[Play Now](https://ellyz2426.github.io/neon-keeper/)**

## Features

### Gameplay
- **6 shot types**: Standard (sphere), Curve (swerving icosahedron), Power (fast cube), Split (divides mid-flight), Phantom (vanishes mid-air), Multi (3-shot disc spread)
- **Combo system**: x1-x5 multiplier with visual ring scaling, shield growth, and 4-tier milestone celebrations
- **Grip-catch bonus**: Catch shots for extra points
- **Boss waves**: Every 5th wave features an oversized 3-hit boss shot
- **4 power-ups**: Shield Expand, Slow Mo, Double Points, Magnet (floating orbs, 10s duration)
- **8 wave modifiers**: Fast Shots, Giant Balls, Tiny Goal, Mirror, Fog, Double Shots, Low Gravity, Speed Ramp
- **Dynamic difficulty adjustment**: Adapts to skill level in Arcade and Endless
- **Dive mechanic**: Lunge left/right for dramatic saves (Space/Q/E in browser)

### Game Modes (6)
| Mode | Description |
|------|-------------|
| **Arcade** | Wave-based, 3 lives, climb the leaderboard |
| **Challenge** | 10 scripted levels, 1 life, earn 0-3 stars per level |
| **Training** | Slow speed practice with trajectory preview lines |
| **Time Attack** | 60 seconds to save as many shots as possible |
| **Endless** | No wave breaks, difficulty never stops climbing |
| **Daily Challenge** | Seeded daily pattern: same for all players, 8 waves, 1 life, no power-ups |

### Controls

**VR (WebXR)**
- Dual-controller gauntlet blocking with grip-catch
- Haptic feedback on saves and goals
- All UI via spatial PanelUI panels

**Browser (Desktop)**
| Input | Action |
|-------|--------|
| Mouse | Aim gauntlets |
| WASD / Arrow Keys | Move gauntlets |
| Space | Dive down |
| Q / E | Dive left / right |

### Progression
- **30 achievements** across multiple categories
- **9-tier rank system**: Rookie to Mythic
- **Progressive unlocks**: Modes, Hard difficulty, and arena skins gated behind achievement milestones
- **Per-mode leaderboard**: Top 5 runs per mode with grades (S/A/B/C/D/F)
- **Career stats**: Per-mode, per-shot-type save rates, play time tracking
- **Challenge stars**: 0-3 per level, 30 total
- **Daily best tracking**: Compete against your own daily score
- **5 gauntlet colors**: Cyan, Green, Gold, Pink, White
- **4 arena skins**: Neon Classic, Cyber Red, Ocean Deep, Void
- All progress persisted via localStorage with automatic migration

### Audio
- **Generative background music**: Chord pad + bass drone + sequenced arpeggio, tempo scales with wave
- **22+ procedural SFX**: Per-shot-type approach sounds, save/catch/goal effects, power-up collection, dive whoosh, boss impact/defeat, streak chimes

### Visuals
- Neon arena with floor grid, wire walls, and starfield
- Goal frame with net (ripple effect on goals), corner spheres, energy lines, danger zone glow
- 4 beacon pillars with point lights
- 4 orbiting accent spheres, 40 ambient floating motes
- Per-mode environment color themes (5 unique palettes)
- Time Attack countdown ring with color transition
- Save shockwave rings, score popups, goal flash, camera shake, screen flash
- Arena reactivity: floor grid pulses with combo level
- Demo shots on main menu

### Technical
- Built with IWSDK 0.4.x (Three.js + ECS)
- 10 PanelUI spatial panels (`.uikitml` compiled to JSON)
- ~5,000+ lines TypeScript
- Dual-runtime: VR + browser with `browserControls: true`
- Zero external dependencies beyond IWSDK

## Development

```bash
npm install
npm run dev      # starts IWSDK dev server
npm run build    # production build to dist/
npx tsc --noEmit # type check
```

## Build Info

- **Version**: 1.0 (Build 109)
- **Deployed**: GitHub Pages

## License

MIT
