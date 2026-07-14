import {
	createSystem, World, Entity,
	PanelUI, PanelDocument, UIKitDocument, UIKit, eq,
	Follower, InputComponent,
	Mesh, Group, BoxGeometry, SphereGeometry, CylinderGeometry,
	MeshStandardMaterial, MeshBasicMaterial, LineBasicMaterial,
	Color, Vector3, Quaternion,
	AmbientLight, PointLight, DirectionalLight,
	BufferGeometry, Float32BufferAttribute,
	EdgesGeometry, LineSegments, AdditiveBlending,
	FogExp2,
	CanvasTexture, DoubleSide,
} from '@iwsdk/core';

// ── Types ──
type GameState = 'menu' | 'mode_select' | 'playing' | 'wave_complete' | 'game_over' | 'settings' | 'achievements' | 'stats' | 'leaderboard' | 'tutorial';
type GameMode = 'arcade' | 'challenge' | 'training' | 'timeattack' | 'endless' | 'daily';
type ShotType = 'standard' | 'curve' | 'power' | 'split' | 'phantom' | 'multi';
type Difficulty = 'easy' | 'normal' | 'hard';
type PowerUpType = 'shield_expand' | 'slow_mo' | 'double_points' | 'magnet';
type WaveModifier = 'normal' | 'fast_shots' | 'giant_balls' | 'tiny_goal' | 'mirror' | 'fog_thick' | 'double_shots' | 'low_gravity' | 'speed_ramp';
type TrainingShotOption = ShotType | 'all';

interface LeaderboardEntry {
	score: number;
	wave: number;
	grade: string;
	mode: GameMode;
	date: string;
	saves: number;
	catches: number;
}

interface PowerUp {
	mesh: Mesh;
	type: PowerUpType;
	pos: Vector3;
	alive: boolean;
	timer: number;
}

interface Shot {
	mesh: Mesh;
	trail: Group;
	type: ShotType;
	pos: Vector3;
	vel: Vector3;
	target: Vector3;
	speed: number;
	alive: boolean;
	blocked: boolean;
	splitDone: boolean;
	phantomTimer: number;
	visible: boolean;
	curvePhase: number;
	curveAmplitude: number;
	spawnZ: number;
	splitId: number;
	approachSoundPlayed: boolean;
	hitsRemaining: number;
	isBoss: boolean;
}

interface ModeStatEntry {
	gamesPlayed: number;
	bestScore: number;
	bestWave: number;
	totalSaves: number;
}

interface SaveData {
	gamesPlayed: number;
	totalSaves: number;
	totalCatches: number;
	totalGoals: number;
	bestWave: number;
	bestScore: number;
	bestStreak: number;
	achievements: boolean[];
	playTimeMs: number;
	powerSaves: number;
	gauntletColor: string;
	modeStats: Record<string, ModeStatEntry>;
	leaderboard: LeaderboardEntry[];
	challengeStars: number[];
	// R7: New fields
	shotStats: Record<string, { saves: number; goals: number }>;
	bossesDefeated: number;
	modifiersSeen: string[];
	// R8: New fields
	dailyBest: { date: string; score: number } | null;
	arenaSkin: string;
}

// ── Constants ──
const GOAL_WIDTH = 4;
const GOAL_HEIGHT = 2.8;
const GOAL_Z = 0.5;
const BLOCK_RADIUS = 0.5;
const SHOT_RADIUS = 0.18;
const SPAWN_Z = -25;

const ACHV_NAMES = [
	'First Save', 'Clean Sheet', 'Streak 5', 'Streak 10', 'Streak 20',
	'Catch Master', 'Catch Pro', 'Wave 5', 'Wave 10', 'Wave 15',
	'Wave 25', 'Score 1K', 'Score 5K', 'Score 10K', 'Score 25K',
	'Phantom Blocker', 'Power Stopper', 'Split Saver', 'Challenge Clear', 'Time Attack 50',
	// R7: 10 new achievements
	'Hard Mode Hero', 'Endless 100', 'Dive Save', 'Power Collector', 'Boss Slayer',
	'Perfect Challenge', 'Star Collector', 'Score 50K', 'Modifier Master', 'Veteran',
];
const ACHV_DESC = [
	'Block your first shot', 'Complete a wave without conceding', 'Get a 5-save streak',
	'Get a 10-save streak', 'Get a 20-save streak', 'Catch 10 shots', 'Catch 50 shots',
	'Reach wave 5', 'Reach wave 10', 'Reach wave 15', 'Reach wave 25',
	'Reach 1,000 points', 'Reach 5,000 points', 'Reach 10,000 points', 'Reach 25,000 points',
	'Save a phantom shot', 'Save 10 power shots', 'Save both halves of a split',
	'Complete challenge mode', 'Save 50+ in time attack',
	// R7
	'Complete wave 10 on Hard', 'Block 100 shots in Endless', 'Block a shot while diving',
	'Collect all 4 power-up types in one game', 'Defeat 5 boss shots total',
	'Get 3 stars on a challenge level', 'Earn all 30 challenge stars',
	'Reach 50,000 points', 'Complete a wave with every modifier type',
	'Play 50 games total',
];

const RANKS = ['Rookie', 'Defender', 'Guardian', 'Sentinel', 'Warden', 'Champion', 'Elite', 'Legend', 'Mythic'];

const DIFF_MULT: Record<Difficulty, number> = { easy: 0.6, normal: 1.0, hard: 1.5 };

// ── Audio helper ──
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
	if (!audioCtx) audioCtx = new AudioContext();
	return audioCtx;
}

function playSfx(type: string, vol = 0.3) {
	try {
		const ctx = getAudioCtx();
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol, ctx.currentTime);
		g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
		g.connect(ctx.destination);

		const o = ctx.createOscillator();
		if (type === 'save') {
			o.type = 'sine';
			o.frequency.setValueAtTime(880, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
		} else if (type === 'catch') {
			o.type = 'triangle';
			o.frequency.setValueAtTime(1200, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.15);
			g.gain.setValueAtTime(vol * 0.8, ctx.currentTime);
		} else if (type === 'goal') {
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(200, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.4);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
		} else if (type === 'launch') {
			o.type = 'sine';
			o.frequency.setValueAtTime(300, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.15);
			g.gain.setValueAtTime(vol * 0.4, ctx.currentTime);
		} else if (type === 'wave') {
			o.type = 'sine';
			o.frequency.setValueAtTime(440, ctx.currentTime);
			o.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
			o.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
		} else if (type === 'gameover') {
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(440, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.6);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
		} else if (type === 'click') {
			o.type = 'square';
			o.frequency.setValueAtTime(1000, ctx.currentTime);
			g.gain.setValueAtTime(vol * 0.3, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
		} else if (type === 'achieve') {
			o.type = 'sine';
			o.frequency.setValueAtTime(660, ctx.currentTime);
			o.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
			o.frequency.setValueAtTime(1100, ctx.currentTime + 0.2);
			o.frequency.setValueAtTime(1320, ctx.currentTime + 0.3);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
		} else if (type === 'split') {
			o.type = 'triangle';
			o.frequency.setValueAtTime(600, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.2);
		} else if (type === 'phantom') {
			o.type = 'sine';
			o.frequency.setValueAtTime(1500, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
			g.gain.setValueAtTime(vol * 0.5, ctx.currentTime);
		} else if (type === 'power') {
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(150, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
			g.gain.setValueAtTime(vol * 0.6, ctx.currentTime);
		} else if (type === 'multi') {
			// Rapid staccato burst - three quick tones
			o.type = 'square';
			o.frequency.setValueAtTime(500, ctx.currentTime);
			o.frequency.setValueAtTime(700, ctx.currentTime + 0.05);
			o.frequency.setValueAtTime(900, ctx.currentTime + 0.1);
			g.gain.setValueAtTime(vol * 0.5, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
		} else if (type === 'powerup') {
			// Ascending arpeggio for power-up collect
			o.type = 'sine';
			o.frequency.setValueAtTime(440, ctx.currentTime);
			o.frequency.setValueAtTime(660, ctx.currentTime + 0.06);
			o.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
			o.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
			g.gain.setValueAtTime(vol * 0.6, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
		} else if (type === 'dive') {
			// Quick whoosh for dive
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(200, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.08);
			g.gain.setValueAtTime(vol * 0.3, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
		} else if (type === 'bosshit') {
			// Heavy impact for boss hit
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(100, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.3);
			g.gain.setValueAtTime(vol * 0.8, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
		} else if (type === 'bossdefeat') {
			// Triumphant fanfare for boss defeat
			o.type = 'sine';
			o.frequency.setValueAtTime(440, ctx.currentTime);
			o.frequency.setValueAtTime(554, ctx.currentTime + 0.1);
			o.frequency.setValueAtTime(659, ctx.currentTime + 0.2);
			o.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
			g.gain.setValueAtTime(vol * 0.6, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
		} else {
			o.type = 'sine';
			o.frequency.setValueAtTime(440, ctx.currentTime);
		}
		o.connect(g);
		o.start();
		o.stop(ctx.currentTime + 0.6);
	} catch { /* audio not available */ }
}

function playAmbient() {
	// Legacy stub — replaced by MusicGenerator in R3
}

// ── R3: Per-shot-type approach sounds ──
function playApproachSfx(type: ShotType) {
	try {
		const ctx = getAudioCtx();
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.1, ctx.currentTime);
		g.connect(ctx.destination);
		const o = ctx.createOscillator();

		if (type === 'standard') {
			o.type = 'sine';
			o.frequency.setValueAtTime(300, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.1);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
			o.connect(g); o.start(); o.stop(ctx.currentTime + 0.12);
		} else if (type === 'curve') {
			o.type = 'triangle';
			o.frequency.setValueAtTime(400, ctx.currentTime);
			// Rapid vibrato via frequency modulation
			const lfo = ctx.createOscillator();
			const lfoGain = ctx.createGain();
			lfo.frequency.value = 20;
			lfoGain.gain.value = 80;
			lfo.connect(lfoGain);
			lfoGain.connect(o.frequency);
			lfo.start(); lfo.stop(ctx.currentTime + 0.15);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.17);
			o.connect(g); o.start(); o.stop(ctx.currentTime + 0.17);
		} else if (type === 'power') {
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(80, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.2);
			g.gain.setValueAtTime(0.12, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
			o.connect(g); o.start(); o.stop(ctx.currentTime + 0.22);
		} else if (type === 'phantom') {
			o.type = 'sine';
			o.frequency.setValueAtTime(2000, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.1);
			g.gain.setValueAtTime(0.06, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
			o.connect(g); o.start(); o.stop(ctx.currentTime + 0.12);
		} else if (type === 'split') {
			o.type = 'square';
			o.frequency.setValueAtTime(800, ctx.currentTime);
			o.frequency.setValueAtTime(1200, ctx.currentTime + 0.03);
			o.frequency.setValueAtTime(600, ctx.currentTime + 0.06);
			o.frequency.setValueAtTime(1000, ctx.currentTime + 0.08);
			g.gain.setValueAtTime(0.08, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
			o.connect(g); o.start(); o.stop(ctx.currentTime + 0.12);
		} else {
			// multi / default — sizzle
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(3000, ctx.currentTime);
			o.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.1);
			g.gain.setValueAtTime(0.07, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
			o.connect(g); o.start(); o.stop(ctx.currentTime + 0.12);
		}
	} catch { /* audio not available */ }
}

// ── R3: Generative background music ──
interface MusicNodes {
	bassOsc: OscillatorNode;
	bassGain: GainNode;
	padOscs: OscillatorNode[];
	padGains: GainNode[];
	padLFO: OscillatorNode;
	arpOsc: OscillatorNode;
	arpGain: GainNode;
	arpIntervalId: number;
	masterGain: GainNode;
}

let musicNodes: MusicNodes | null = null;

function startMusic(waveNum = 1) {
	try {
		if (musicNodes) return; // already playing
		const ctx = getAudioCtx();

		const masterGain = ctx.createGain();
		masterGain.gain.setValueAtTime(0.5, ctx.currentTime);
		masterGain.connect(ctx.destination);

		// Bass drone — 55 Hz sine
		const bassOsc = ctx.createOscillator();
		bassOsc.type = 'sine';
		bassOsc.frequency.setValueAtTime(55, ctx.currentTime);
		const bassGain = ctx.createGain();
		bassGain.gain.setValueAtTime(0.04, ctx.currentTime);
		bassOsc.connect(bassGain);
		bassGain.connect(masterGain);
		bassOsc.start();

		// Pad — 3 sine oscillators at chord tones with slow LFO detune
		const padFreqs = [146.83, 185, 220];
		const padOscs: OscillatorNode[] = [];
		const padGains: GainNode[] = [];
		const padLFO = ctx.createOscillator();
		padLFO.type = 'sine';
		padLFO.frequency.setValueAtTime(0.15, ctx.currentTime);
		padLFO.start();

		for (const freq of padFreqs) {
			const osc = ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(freq, ctx.currentTime);
			const lfoGain = ctx.createGain();
			lfoGain.gain.setValueAtTime(3, ctx.currentTime); // ±3 Hz detune
			padLFO.connect(lfoGain);
			lfoGain.connect(osc.frequency);
			const pGain = ctx.createGain();
			pGain.gain.setValueAtTime(0.02, ctx.currentTime);
			osc.connect(pGain);
			pGain.connect(masterGain);
			osc.start();
			padOscs.push(osc);
			padGains.push(pGain);
		}

		// Arpeggio — sequenced notes
		const arpNotes = [110, 146.83, 164.81, 220];
		let arpIndex = 0;
		const arpOsc = ctx.createOscillator();
		arpOsc.type = 'triangle';
		arpOsc.frequency.setValueAtTime(arpNotes[0], ctx.currentTime);
		const arpGain = ctx.createGain();
		arpGain.gain.setValueAtTime(0.03, ctx.currentTime);
		arpOsc.connect(arpGain);
		arpGain.connect(masterGain);
		arpOsc.start();

		const tempoMs = Math.max(150, 250 - (waveNum - 1) * 10);
		const arpIntervalId = window.setInterval(() => {
			arpIndex = (arpIndex + 1) % arpNotes.length;
			try {
				const now = ctx.currentTime;
				arpOsc.frequency.setValueAtTime(arpNotes[arpIndex], now);
				arpGain.gain.setValueAtTime(0.03, now);
				arpGain.gain.exponentialRampToValueAtTime(0.005, now + tempoMs / 1000 * 0.8);
			} catch { /* */ }
		}, tempoMs);

		musicNodes = { bassOsc, bassGain, padOscs, padGains, padLFO, arpOsc, arpGain, arpIntervalId, masterGain };
	} catch { /* audio not available */ }
}

function stopMusic() {
	if (!musicNodes) return;
	try {
		clearInterval(musicNodes.arpIntervalId);
		const ctx = getAudioCtx();
		const now = ctx.currentTime;
		musicNodes.masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
		const nodes = musicNodes;
		setTimeout(() => {
			try {
				nodes.bassOsc.stop();
				nodes.arpOsc.stop();
				nodes.padLFO.stop();
				for (const p of nodes.padOscs) p.stop();
			} catch { /* */ }
		}, 600);
		musicNodes = null;
	} catch { /* */ }
}

function updateMusicTempo(waveNum: number) {
	if (!musicNodes) return;
	try {
		clearInterval(musicNodes.arpIntervalId);
		const ctx = getAudioCtx();
		const arpNotes = [110, 146.83, 164.81, 220];
		let arpIndex = 0;
		const tempoMs = Math.max(150, 250 - (waveNum - 1) * 10);
		musicNodes.arpIntervalId = window.setInterval(() => {
			arpIndex = (arpIndex + 1) % arpNotes.length;
			try {
				const now = ctx.currentTime;
				musicNodes!.arpOsc.frequency.setValueAtTime(arpNotes[arpIndex], now);
				musicNodes!.arpGain.gain.setValueAtTime(0.03, now);
				musicNodes!.arpGain.gain.exponentialRampToValueAtTime(0.005, now + tempoMs / 1000 * 0.8);
			} catch { /* */ }
		}, tempoMs);
	} catch { /* */ }
}

// ── Score popup texture helper ──
function makePopupTexture(text: string, color: string): CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 128;
	const ctx2d = canvas.getContext('2d')!;
	ctx2d.clearRect(0, 0, 256, 128);
	ctx2d.font = 'bold 64px monospace';
	ctx2d.textAlign = 'center';
	ctx2d.textBaseline = 'middle';
	ctx2d.fillStyle = color;
	ctx2d.fillText(text, 128, 64);
	const tex = new CanvasTexture(canvas);
	return tex;
}

// ── R8: Seeded PRNG ──
function seededRandom(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
		return (s >>> 0) / 0xFFFFFFFF;
	};
}

function getDailySeed(): number {
	const d = new Date();
	return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function getTodayDateStr(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return y + '-' + m + '-' + dd;
}

// ── System ──
export class GameSystem extends createSystem({
	menuPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/main-menu.json')] },
	modePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/mode-select.json')] },
	hudPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/hud.json')] },
	scorecardPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/scorecard.json')] },
	gameOverPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/game-over.json')] },
	settingsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/settings.json')] },
	achvPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/achvlist.json')] },
	statsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/stats.json')] },
	lbPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/leaderboard.json')] },
	tutorialPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/tutorial.json')] },
}) {
	// ── World ref ──
	w!: World;
	scene: any = null;

	// ── Panel entities ──
	menuEntity!: Entity; modeEntity!: Entity; hudEntity!: Entity;
	scorecardEntity!: Entity; gameOverEntity!: Entity; settingsEntity!: Entity;
	achvEntity!: Entity; statsEntity!: Entity; lbEntity!: Entity; tutorialEntity!: Entity;

	// ── Panel docs ──
	menuDoc: UIKitDocument | null = null;
	modeDoc: UIKitDocument | null = null;
	hudDoc: UIKitDocument | null = null;
	scorecardDoc: UIKitDocument | null = null;
	gameOverDoc: UIKitDocument | null = null;
	settingsDoc: UIKitDocument | null = null;
	achvDoc: UIKitDocument | null = null;
	statsDoc: UIKitDocument | null = null;
	lbDoc: UIKitDocument | null = null;
	tutorialDoc: UIKitDocument | null = null;

	// ── Game state ──
	state: GameState = 'menu';
	mode: GameMode = 'arcade';
	difficulty: Difficulty = 'normal';
	score = 0;
	wave = 1;
	lives = 3;
	combo = 0;
	bestCombo = 0;
	waveSaves = 0;
	waveGoals = 0;
	waveCatches = 0;
	totalSaves = 0;
	totalCatches = 0;
	totalGoals = 0;
	timeLeft = 60;
	challengeLevel = 0;
	gameStartTime = 0;
	ambientStarted = false;

	// ── Settings ──
	sfxVol = 100;
	musicOn = true;
	particlesOn = true;

	// ── Shots ──
	shots: Shot[] = [];
	shotPool: Shot[] = [];
	waveShots = 0;
	waveShotsLaunched = 0;
	shotTimer = 0;
	shotInterval = 1.5;
	waveActive = false;

	// ── Scene objects ──
	goalGroup!: Group;
	floorGrid!: LineSegments;
	gauntletL!: Mesh;
	gauntletR!: Mesh;
	gauntletPosL = new Vector3(-0.3, 1.2, -0.5);
	gauntletPosR = new Vector3(0.3, 1.2, -0.5);
	particles: { mesh: Mesh; vel: Vector3; life: number }[] = [];
	scorePopups: { mesh: Mesh; vel: Vector3; life: number }[] = [];

	// ── R2: Goal flash ──
	goalPosts: Mesh[] = [];
	goalFlashTimer = 0;

	// ── R2: Camera shake ──
	cameraShakeTimer = 0;

	// ── R2: Gauntlet shields ──
	shieldL!: Mesh;
	shieldR!: Mesh;

	// ── R2: Orbiting accent spheres ──
	orbitSpheres: { mesh: Mesh; light: PointLight; angle: number; speed: number; radius: number; height: number }[] = [];

	// ── R2: Ambient floating motes ──
	ambientMotes: { mesh: Mesh; vel: Vector3 }[] = [];

	// ── R2: Wave preview ──
	wavePreviewTimer = 0;

	// ── R3: Split saver tracking ──
	splitIdCounter = 0;
	splitSaveTracker: Map<number, number> = new Map();

	// ── R3: Challenge queue ──
	challengeQueue: ShotType[] = [];

	// ── R3: Environment theme refs ──
	ambientLight!: AmbientLight;
	accentLights: PointLight[] = [];
	originalAccentColors: number[] = [];

	// ── R3: Goal net ripple ──
	goalNet!: LineSegments;
	goalNetOrigZ: Float32Array | null = null;
	netRippleTimer = 0;
	netRippleActive = false;

	// ── R6: Streak milestone effects ──
	checkStreakMilestone() {
		const milestones = [5, 10, 15, 20];
		for (const m of milestones) {
			if (this.combo >= m && !this.streakMilestonesHit.has(m)) {
				this.streakMilestonesHit.add(m);
				this.triggerStreakEffect(m);
			}
		}
	}

	triggerStreakEffect(milestone: number) {
		if (milestone >= 5) {
			// Gauntlet emissive spike (brief flash)
			const origIntL = (this.gauntletL.material as MeshStandardMaterial).emissiveIntensity;
			const origIntR = (this.gauntletR.material as MeshStandardMaterial).emissiveIntensity;
			(this.gauntletL.material as MeshStandardMaterial).emissiveIntensity = 3.0;
			(this.gauntletR.material as MeshStandardMaterial).emissiveIntensity = 3.0;
			setTimeout(() => {
				try {
					(this.gauntletL.material as MeshStandardMaterial).emissiveIntensity = origIntL;
					(this.gauntletR.material as MeshStandardMaterial).emissiveIntensity = origIntR;
				} catch { /* */ }
			}, 300);
			this.playStreakSfx(1); // 3-note ascending chime
		}
		if (milestone >= 10) {
			// Particle burst from gauntlets + screen flash
			if (this.particlesOn) {
				this.spawnSaveParticles(this.gauntletPosL, 0x00ffcc);
				this.spawnSaveParticles(this.gauntletPosR, 0x00ffcc);
			}
			this.triggerFlash(0x00ffcc, 0.25, 0.35);
			this.playStreakSfx(2); // bigger chime
		}
		if (milestone >= 15) {
			// Arena accent lights intensify briefly
			for (const al of this.accentLights) {
				const origI = al.intensity;
				al.intensity = origI * 3;
				setTimeout(() => { try { al.intensity = origI; } catch { /* */ } }, 500);
			}
			this.triggerFlash(0xffaa00, 0.3, 0.4);
			this.playStreakSfx(3);
		}
		if (milestone >= 20) {
			// Maximum celebration
			this.triggerFlash(0xff2200, 0.4, 0.5);
			this.playStreakSfx(4);
		}

		// HUD status text
		if (this.hudDoc) {
			const labels: Record<number, string> = {
				5: '5x STREAK!',
				10: '10x ON FIRE!',
				15: '15x DOMINATING!',
				20: 'UNSTOPPABLE',
			};
			this.setTxt(this.hudDoc, 'status', labels[milestone] || milestone + 'x STREAK!');
			this.wavePreviewTimer = 2.0;
		}
	}

	playStreakSfx(tier: number) {
		try {
			const ctx = getAudioCtx();
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.4, ctx.currentTime);
			g.connect(ctx.destination);
			const o = ctx.createOscillator();
			o.type = 'sine';

			if (tier === 1) {
				// 3-note ascending chime
				o.frequency.setValueAtTime(660, ctx.currentTime);
				o.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
				o.frequency.setValueAtTime(1100, ctx.currentTime + 0.16);
				g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
			} else if (tier === 2) {
				// 4-note rapid arpeggio
				o.frequency.setValueAtTime(440, ctx.currentTime);
				o.frequency.setValueAtTime(660, ctx.currentTime + 0.06);
				o.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
				o.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
				g.gain.setValueAtTime(0.5, ctx.currentTime);
				g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
			} else if (tier === 3) {
				// Rich chord
				o.frequency.setValueAtTime(440, ctx.currentTime);
				o.frequency.setValueAtTime(554, ctx.currentTime + 0.08);
				o.frequency.setValueAtTime(659, ctx.currentTime + 0.14);
				o.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
				o.frequency.setValueAtTime(1320, ctx.currentTime + 0.26);
				g.gain.setValueAtTime(0.5, ctx.currentTime);
				g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
			} else {
				// Epic fanfare
				o.frequency.setValueAtTime(440, ctx.currentTime);
				o.frequency.setValueAtTime(554, ctx.currentTime + 0.06);
				o.frequency.setValueAtTime(659, ctx.currentTime + 0.12);
				o.frequency.setValueAtTime(880, ctx.currentTime + 0.18);
				o.frequency.setValueAtTime(1100, ctx.currentTime + 0.24);
				o.frequency.setValueAtTime(1320, ctx.currentTime + 0.3);
				o.frequency.setValueAtTime(1760, ctx.currentTime + 0.36);
				g.gain.setValueAtTime(0.6, ctx.currentTime);
				g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
			}
			o.connect(g);
			o.start();
			o.stop(ctx.currentTime + 0.8);
		} catch { /* audio not available */ }
	}

	// ── R4: Power-up system ──
	powerUps: PowerUp[] = [];
	activePowerUp: PowerUpType | null = null;
	powerUpTimer = 0;
	powerUpSpawnedThisWave = false;

	// ── R4: Dive mechanic (browser mode) ──
	isDiving = false;
	diveTimer = 0;
	diveCooldown = 0;
	diveDirection = new Vector3();
	diveOriginL = new Vector3();
	diveOriginR = new Vector3();
	diveTargetL = new Vector3();
	diveTargetR = new Vector3();
	divePhase: 'lunge' | 'recover' = 'lunge';

	// ── R4: Wave modifiers ──
	currentModifier: WaveModifier = 'normal';
	modifierDisplayTimer = 0;
	originalGoalWidth = GOAL_WIDTH;

	// ── R4: Dynamic Difficulty Adjustment ──
	ddaMultiplier = 1.0;
	recentResults: boolean[] = [];

	// ── R4: Training shot selector ──
	trainingShotType: TrainingShotOption = 'all';

	// ── R4: Combo visual rings ──
	comboRingL!: Mesh;
	comboRingR!: Mesh;
	comboRingFlashTimer = 0;

	// ── R5: Shot warning indicators ──
	warningArrows: { mesh: Mesh; shotRef: Shot }[] = [];

	// ── R5: Boss wave ──
	bossSpawnedThisWave = false;
	bossDefeatedThisWave = false;

	// ── R5: Screen flash ──
	flashMesh!: Mesh;
	flashTimer = 0;
	flashDuration = 0;

	// ── R5: Gauntlet customization ──
	gauntletColor = 'Cyan';
	gauntletColorMap: Record<string, number> = {
		Cyan: 0x00ccff, Green: 0x00ff66, Gold: 0xffcc00, Pink: 0xff66cc, White: 0xeeeeff,
	};

	// ── R6: Mouse-aim control ──
	mouseAimEnabled = true;
	mouseNormX = 0;
	mouseNormY = 0.5;
	mouseListenerAdded = false;

	// ── R6: Arena reactivity ──
	floorGridMat!: LineBasicMaterial;
	arenaPulseTimer = 0;
	arenaPulseColor = 0x00ffcc;

	// ── R6: Countdown ──
	countdownTimer = 0;
	countdownActive = false;

	// ── R6: Leaderboard tab ──
	lbActiveTab: 'arcade' | 'challenge' | 'timeattack' | 'endless' | 'daily' = 'arcade';

	// ── R6: Save shockwave rings ──
	shockwaves: { mesh: LineSegments; life: number; maxLife: number }[] = [];

	// ── R6: Endless mode ──
	endlessShotsBlocked = 0;
	endlessInternalWave = 1;

	// ── R6: Streak milestones (only fire once per game) ──
	streakMilestonesHit: Set<number> = new Set();

	// ── R7: Per-game session shot stats ──
	gameSessionShotStats: Record<string, { saves: number; goals: number }> = {};

	// ── R7: Power-up collection tracking (per game) ──
	powerUpsCollectedThisGame: Set<string> = new Set();

	// ── R7: Training mode trajectory preview ──
	trainingPaths: { line: LineSegments; shotRef: Shot }[] = [];

	// ── R7: Goal decoration ──
	goalCornerSpheres: Mesh[] = [];
	goalEnergyLines: LineSegments[] = [];
	goalDangerZone: Mesh | null = null;

	// ── R8: Arena skin system ──
	arenaSkin = 'Neon Classic';
	beaconPillars: Mesh[] = [];
	beaconLights: PointLight[] = [];
	floorRingLine: LineSegments | null = null;
	neonFloorRingMat: LineBasicMaterial | null = null;

	// ── R8: Countdown ring (Time Attack) ──
	countdownRing: Mesh | null = null;
	countdownRingMat: MeshStandardMaterial | null = null;

	// ── R8: Menu demo shots ──
	demoShots: { mesh: Mesh; vel: Vector3; trail: Group }[] = [];
	demoShotTimer = 0;

	// ── R8: Daily challenge ──
	dailyRng: (() => number) | null = null;

	// ── R8: Leaderboard tab ──
	lbActiveTabR8: string = 'arcade';

	// ── R9: Achievement notification banner ──
	achvBannerMesh: Mesh | null = null;
	achvBannerTimer = 0;
	achvBannerQueue: string[] = [];

	// ── R9: Atmosphere particles ──
	atmosParticles: { mesh: Mesh; vel: Vector3; life: number; maxLife: number }[] = [];
	atmosSpawnTimer = 0;

	// ── R9: Near-miss spark effect ──
	nearMissSparks: { mesh: Mesh; vel: Vector3; life: number }[] = [];

	// ── R9: Reaction time tracking ──
	lastShotSpawnTime = 0;
	reactionTimes: number[] = [];
	avgReactionTime = 0;

	// ── R9: Session timer ──
	sessionElapsed = 0;

	// ── R9: Post-goal dramatic slowdown ──
	goalSlowdownTimer = 0;
	goalSlowdownActive = false;

	// ── Save data ──
	saveData!: SaveData;

	// ── Helpers ──
	tmpVec = new Vector3();

	initGame(world: World) {
		this.w = world;
		this.scene = world.scene as any;
		this.loadSave();
		this.buildScene();
		this.createPanels();
	}

	// ── Save / Load ──
	loadSave() {
		try {
			const raw = localStorage.getItem('neon-keeper-save');
			if (raw) {
				this.saveData = JSON.parse(raw);
				// Migrate: ensure new fields exist
				if (!this.saveData.gauntletColor) this.saveData.gauntletColor = 'Cyan';
				if (!this.saveData.modeStats) {
					this.saveData.modeStats = {
						arcade: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
						challenge: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
						training: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
						timeattack: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
						endless: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
					};
				}
				if (!this.saveData.modeStats.endless) {
					this.saveData.modeStats.endless = { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 };
				}
				if (!this.saveData.challengeStars) this.saveData.challengeStars = new Array(10).fill(0);
				if (!this.saveData.leaderboard) this.saveData.leaderboard = [];
				// R7: Migrate achievements array to 30
				if (this.saveData.achievements.length < 30) {
					while (this.saveData.achievements.length < 30) this.saveData.achievements.push(false);
				}
				// R7: Migrate new save data fields
				if (!this.saveData.shotStats) {
					this.saveData.shotStats = {
						standard: { saves: 0, goals: 0 }, curve: { saves: 0, goals: 0 },
						power: { saves: 0, goals: 0 }, split: { saves: 0, goals: 0 },
						phantom: { saves: 0, goals: 0 }, multi: { saves: 0, goals: 0 },
						boss: { saves: 0, goals: 0 },
					};
				}
				if (this.saveData.bossesDefeated === undefined) this.saveData.bossesDefeated = 0;
				if (!this.saveData.modifiersSeen) this.saveData.modifiersSeen = [];
				// R8: Migrate daily best and arena skin
				if (this.saveData.dailyBest === undefined) this.saveData.dailyBest = null;
				if (!this.saveData.arenaSkin) this.saveData.arenaSkin = 'Neon Classic';
				if (!this.saveData.modeStats.daily) {
					this.saveData.modeStats.daily = { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 };
				}
				this.gauntletColor = this.saveData.gauntletColor;
				this.arenaSkin = this.saveData.arenaSkin;
				return;
			}
		} catch { /* */ }
		this.saveData = {
			gamesPlayed: 0, totalSaves: 0, totalCatches: 0, totalGoals: 0,
			bestWave: 0, bestScore: 0, bestStreak: 0,
			achievements: new Array(30).fill(false), playTimeMs: 0, powerSaves: 0,
			gauntletColor: 'Cyan',
			modeStats: {
				arcade: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				challenge: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				training: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				timeattack: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				endless: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				daily: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
			},
			leaderboard: [],
			challengeStars: new Array(10).fill(0),
			// R7
			shotStats: {
				standard: { saves: 0, goals: 0 }, curve: { saves: 0, goals: 0 },
				power: { saves: 0, goals: 0 }, split: { saves: 0, goals: 0 },
				phantom: { saves: 0, goals: 0 }, multi: { saves: 0, goals: 0 },
				boss: { saves: 0, goals: 0 },
			},
			bossesDefeated: 0,
			modifiersSeen: [],
			// R8
			dailyBest: null,
			arenaSkin: 'Neon Classic',
		};
	}

	persistSave() {
		try { localStorage.setItem('neon-keeper-save', JSON.stringify(this.saveData)); } catch { /* */ }
	}

	// ── Scene ──
	buildScene() {
		// Fog
		this.scene.fog = new FogExp2(0x000811, 0.02);
		this.scene.background = new Color(0x000811);

		// Lights
		const amb = new AmbientLight(0x112233, 0.4);
		this.scene.add(amb);
		this.ambientLight = amb;
		const dir = new DirectionalLight(0x0088ff, 0.5);
		dir.position.set(5, 10, 5);
		this.scene.add(dir);

		// Accent lights
		const accents = [
			{ pos: [-3, 4, -10], color: 0x00ffcc },
			{ pos: [3, 4, -10], color: 0x00ccff },
			{ pos: [0, 6, -5], color: 0xcc44ff },
			{ pos: [-5, 2, -15], color: 0xff4466 },
			{ pos: [5, 2, -15], color: 0x44ff88 },
		];
		for (const a of accents) {
			const pl = new PointLight(a.color, 2, 25);
			pl.position.set(a.pos[0], a.pos[1], a.pos[2]);
			this.scene.add(pl);
			this.accentLights.push(pl);
			this.originalAccentColors.push(a.color);
		}

		// Floor grid
		this.buildFloorGrid();

		// Goal frame
		this.buildGoal();

		// Gauntlets (browser mode visual)
		this.buildGauntlets();

		// Stars
		this.buildStars();

		// Arena walls (wire)
		this.buildArena();

		// R2: Beacon pillars
		this.buildBeacons();

		// R2: Neon floor ring
		this.buildFloorRing();

		// R2: Orbiting accent spheres
		this.buildOrbitSpheres();

		// R2: Ambient floating motes
		this.buildAmbientMotes();

		// R5: Screen flash overlay
		this.buildFlashMesh();

		// R7: Goal decoration (corner spheres, energy lines, danger zone)
		this.buildGoalDecoration();

		// R8: Time Attack countdown ring
		this.buildCountdownRing();

		// R8: Apply saved arena skin
		if (this.arenaSkin !== 'Neon Classic') {
			this.applyArenaSkin(this.arenaSkin);
		}
	}

	buildFloorGrid() {
		const verts: number[] = [];
		const span = 30;
		const step = 1;
		for (let i = -span; i <= span; i += step) {
			verts.push(i, 0, -span, i, 0, span);
			verts.push(-span, 0, i, span, 0, i);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
		this.floorGridMat = new LineBasicMaterial({ color: 0x003344, transparent: true, opacity: 0.3 });
		this.floorGrid = new LineSegments(geo, this.floorGridMat);
		this.scene.add(this.floorGrid);
	}

	buildGoal() {
		this.goalGroup = new Group();
		const postMat = new MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.8 });
		const postGeo = new CylinderGeometry(0.06, 0.06, GOAL_HEIGHT, 8);
		const crossGeo = new CylinderGeometry(0.06, 0.06, GOAL_WIDTH + 0.12, 8);

		// Left post
		const lp = new Mesh(postGeo, postMat.clone());
		lp.position.set(-GOAL_WIDTH / 2, GOAL_HEIGHT / 2, GOAL_Z);
		this.goalGroup.add(lp);
		this.goalPosts.push(lp);

		// Right post
		const rp = new Mesh(postGeo, postMat.clone());
		rp.position.set(GOAL_WIDTH / 2, GOAL_HEIGHT / 2, GOAL_Z);
		this.goalGroup.add(rp);
		this.goalPosts.push(rp);

		// Crossbar
		const cb = new Mesh(crossGeo, postMat.clone());
		cb.rotation.z = Math.PI / 2;
		cb.position.set(0, GOAL_HEIGHT, GOAL_Z);
		this.goalGroup.add(cb);
		this.goalPosts.push(cb);

		// Goal net (wire)
		const netVerts: number[] = [];
		const netDepth = 1.5;
		const hw = GOAL_WIDTH / 2;
		for (let y = 0; y <= GOAL_HEIGHT; y += 0.4) {
			netVerts.push(-hw, y, GOAL_Z, -hw, y, GOAL_Z + netDepth);
			netVerts.push(hw, y, GOAL_Z, hw, y, GOAL_Z + netDepth);
			netVerts.push(-hw, y, GOAL_Z + netDepth, hw, y, GOAL_Z + netDepth);
		}
		for (let x = -hw; x <= hw; x += 0.5) {
			netVerts.push(x, 0, GOAL_Z, x, 0, GOAL_Z + netDepth);
			netVerts.push(x, GOAL_HEIGHT, GOAL_Z, x, GOAL_HEIGHT, GOAL_Z + netDepth);
		}
		for (let z = GOAL_Z; z <= GOAL_Z + netDepth; z += 0.3) {
			for (let x = -hw; x <= hw; x += 0.5) {
				netVerts.push(x, 0, z, x, GOAL_HEIGHT, z);
			}
		}
		const netGeo = new BufferGeometry();
		netGeo.setAttribute('position', new Float32BufferAttribute(netVerts, 3));
		const netMat = new LineBasicMaterial({ color: 0x004466, transparent: true, opacity: 0.15 });
		this.goalNet = new LineSegments(netGeo, netMat);
		this.goalGroup.add(this.goalNet);
		// R3: Store original z positions for net ripple
		const posAttr = netGeo.getAttribute('position');
		this.goalNetOrigZ = new Float32Array(posAttr.count);
		for (let i = 0; i < posAttr.count; i++) {
			this.goalNetOrigZ[i] = (posAttr as any).getZ(i);
		}

		// Goal line
		const lineVerts = [-hw, 0.01, GOAL_Z, hw, 0.01, GOAL_Z];
		const lineGeo = new BufferGeometry();
		lineGeo.setAttribute('position', new Float32BufferAttribute(lineVerts, 3));
		const lineMat = new LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.6 });
		this.goalGroup.add(new LineSegments(lineGeo, lineMat));

		this.scene.add(this.goalGroup);
	}

	buildGauntlets() {
		const gMat = new MeshStandardMaterial({ color: 0x00ccff, emissive: 0x00ccff, emissiveIntensity: 0.6, transparent: true, opacity: 0.8 });
		const gGeo = new SphereGeometry(0.15, 12, 8);

		this.gauntletL = new Mesh(gGeo, gMat);
		this.gauntletL.position.copy(this.gauntletPosL);
		this.scene.add(this.gauntletL);

		this.gauntletR = new Mesh(gGeo, gMat.clone());
		this.gauntletR.position.copy(this.gauntletPosR);
		this.scene.add(this.gauntletR);

		// Rings around gauntlets
		for (const g of [this.gauntletL, this.gauntletR]) {
			const ringGeo = new CylinderGeometry(0.25, 0.25, 0.02, 16, 1, true);
			const ringMat = new MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.4, side: 2 });
			const ring = new Mesh(ringGeo, ringMat);
			g.add(ring);
		}

		// R2: Energy shield discs
		const shieldGeo = new CylinderGeometry(0.2, 0.2, 0.01, 20, 1, false);
		const shieldMatL = new MeshBasicMaterial({
			color: 0x00ccff, transparent: true, opacity: 0.15, side: DoubleSide,
		});
		this.shieldL = new Mesh(shieldGeo, shieldMatL);
		this.shieldL.rotation.x = Math.PI / 2; // face forward
		this.shieldL.position.set(0, 0, -0.1);
		this.gauntletL.add(this.shieldL);

		const shieldMatR = new MeshBasicMaterial({
			color: 0x00ccff, transparent: true, opacity: 0.15, side: DoubleSide,
		});
		this.shieldR = new Mesh(shieldGeo, shieldMatR);
		this.shieldR.rotation.x = Math.PI / 2;
		this.shieldR.position.set(0, 0, -0.1);
		this.gauntletR.add(this.shieldR);

		// R4: Combo visual rings
		const comboRingGeo = new CylinderGeometry(0.3, 0.3, 0.015, 24, 1, true);
		const comboRingMatL = new MeshBasicMaterial({
			color: 0x00ccff, transparent: true, opacity: 0.0, side: 2,
		});
		this.comboRingL = new Mesh(comboRingGeo, comboRingMatL);
		this.gauntletL.add(this.comboRingL);

		const comboRingMatR = new MeshBasicMaterial({
			color: 0x00ccff, transparent: true, opacity: 0.0, side: 2,
		});
		this.comboRingR = new Mesh(comboRingGeo, comboRingMatR);
		this.gauntletR.add(this.comboRingR);
	}

	buildStars() {
		const count = 200;
		const verts: number[] = [];
		for (let i = 0; i < count; i++) {
			verts.push(
				(Math.random() - 0.5) * 100,
				20 + Math.random() * 40,
				(Math.random() - 0.5) * 100,
			);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
		const mat = new MeshBasicMaterial({ color: 0xffffff });
		const points = new LineSegments(geo, mat);
		this.scene.add(points);
	}

	buildArena() {
		const verts: number[] = [];
		const w = 8, h = 6, d = 30;
		// Side walls
		for (let z = 0; z >= -d; z -= 2) {
			verts.push(-w, 0, z, -w, h, z);
			verts.push(w, 0, z, w, h, z);
		}
		for (let y = 0; y <= h; y += 1) {
			verts.push(-w, y, 0, -w, y, -d);
			verts.push(w, y, 0, w, y, -d);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
		const mat = new LineBasicMaterial({ color: 0x002244, transparent: true, opacity: 0.15 });
		this.scene.add(new LineSegments(geo, mat));
	}

	// ── R2: Beacon pillars at arena corners ──
	buildBeacons() {
		const beaconH = 6;
		const positions = [
			[-7, 0, -1],
			[7, 0, -1],
			[-7, 0, -25],
			[7, 0, -25],
		];
		const colors = [0x00ffcc, 0x00ccff, 0xcc44ff, 0xff4466];
		for (let i = 0; i < 4; i++) {
			const [bx, _by, bz] = positions[i];
			const col = colors[i];

			// Pillar body
			const pillarGeo = new CylinderGeometry(0.08, 0.08, beaconH, 6);
			const pillarMat = new MeshStandardMaterial({
				color: col, emissive: col, emissiveIntensity: 0.5,
				transparent: true, opacity: 0.6,
			});
			const pillar = new Mesh(pillarGeo, pillarMat);
			pillar.position.set(bx, beaconH / 2, bz);
			this.scene.add(pillar);
			this.beaconPillars.push(pillar);

			// Top beacon sphere
			const topGeo = new SphereGeometry(0.15, 8, 6);
			const topMat = new MeshStandardMaterial({
				color: col, emissive: col, emissiveIntensity: 1.2,
			});
			const top = new Mesh(topGeo, topMat);
			top.position.set(bx, beaconH + 0.15, bz);
			this.scene.add(top);
			this.beaconPillars.push(top);

			// Point light at top
			const bl = new PointLight(col, 1.5, 15);
			bl.position.set(bx, beaconH + 0.3, bz);
			this.scene.add(bl);
			this.beaconLights.push(bl);
		}
	}

	// ── R2: Neon ring on arena floor ──
	buildFloorRing() {
		const segments = 64;
		const radius = 6;
		const verts: number[] = [];
		for (let i = 0; i < segments; i++) {
			const a0 = (i / segments) * Math.PI * 2;
			const a1 = ((i + 1) / segments) * Math.PI * 2;
			verts.push(
				Math.cos(a0) * radius, 0.02, Math.sin(a0) * radius - 12,
				Math.cos(a1) * radius, 0.02, Math.sin(a1) * radius - 12,
			);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
		const mat = new LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.25 });
		this.neonFloorRingMat = mat;
		const line = new LineSegments(geo, mat);
		this.floorRingLine = line;
		this.scene.add(line);
	}

	// ── R2: Orbiting accent spheres ──
	buildOrbitSpheres() {
		const configs = [
			{ radius: 5, height: 3.5, speed: 0.3, color: 0x00ffcc },
			{ radius: 6, height: 2.0, speed: -0.2, color: 0xcc44ff },
			{ radius: 4.5, height: 4.5, speed: 0.4, color: 0xff8800 },
			{ radius: 7, height: 1.5, speed: -0.15, color: 0x44ccff },
		];
		for (const c of configs) {
			const geo = new SphereGeometry(0.1, 8, 6);
			const mat = new MeshStandardMaterial({
				color: c.color, emissive: c.color, emissiveIntensity: 1.0,
				transparent: true, opacity: 0.7,
			});
			const mesh = new Mesh(geo, mat);
			mesh.position.set(c.radius, c.height, -12);
			this.scene.add(mesh);

			const light = new PointLight(c.color, 0.8, 10);
			light.position.copy(mesh.position);
			this.scene.add(light);

			this.orbitSpheres.push({
				mesh, light,
				angle: Math.random() * Math.PI * 2,
				speed: c.speed,
				radius: c.radius,
				height: c.height,
			});
		}
	}

	// ── R2: Ambient floating motes ──
	buildAmbientMotes() {
		for (let i = 0; i < 40; i++) {
			const geo = new SphereGeometry(0.03, 4, 3);
			const hue = Math.random();
			let color = 0x005566;
			if (hue < 0.3) color = 0x003355;
			else if (hue < 0.6) color = 0x004466;
			else color = 0x005577;

			const mat = new MeshBasicMaterial({
				color, transparent: true, opacity: 0.2 + Math.random() * 0.15,
			});
			const mesh = new Mesh(geo, mat);
			mesh.position.set(
				(Math.random() - 0.5) * 14,
				0.5 + Math.random() * 5,
				-Math.random() * 25,
			);
			this.scene.add(mesh);

			const vel = new Vector3(
				(Math.random() - 0.5) * 0.3,
				(Math.random() - 0.5) * 0.15,
				(Math.random() - 0.5) * 0.2,
			);
			this.ambientMotes.push({ mesh, vel });
		}
	}

	// ── R5: Screen flash overlay ──
	buildFlashMesh() {
		const geo = new BoxGeometry(20, 20, 0.001);
		const mat = new MeshBasicMaterial({
			color: 0xffffff, transparent: true, opacity: 0,
			depthWrite: false, side: DoubleSide,
		});
		this.flashMesh = new Mesh(geo, mat);
		this.flashMesh.position.set(0, 1.7, -0.5);
		this.flashMesh.visible = false;
		this.scene.add(this.flashMesh);
	}

	triggerFlash(color: number, intensity: number, duration: number) {
		const mat = this.flashMesh.material as MeshBasicMaterial;
		mat.color.set(color);
		mat.opacity = intensity;
		this.flashMesh.visible = true;
		this.flashTimer = duration;
		this.flashDuration = duration;
	}

	// ── Panels ──
	createPanels() {
		const panelZ = -1.8;
		const panelY = 1.5;
		const hideY = -50;

		// Menu (world-space, centered — starts visible)
		this.menuEntity = this.w.createTransformEntity(new Group());
		this.menuEntity.object3D!.position.set(0, panelY, panelZ);
		this.menuEntity.addComponent(PanelUI, { config: './ui/main-menu.json', maxWidth: 1.0 });

		// Mode select (hidden off-screen)
		this.modeEntity = this.w.createTransformEntity(new Group());
		this.modeEntity.object3D!.position.set(0, hideY, panelZ);
		this.modeEntity.addComponent(PanelUI, { config: './ui/mode-select.json', maxWidth: 1.0 });

		// HUD (head-locked — hidden off-screen)
		this.hudEntity = this.w.createTransformEntity(new Group());
		this.hudEntity.object3D!.position.set(0, hideY, panelZ);
		this.hudEntity.addComponent(PanelUI, { config: './ui/hud.json', maxWidth: 0.7 });
		this.hudEntity.addComponent(Follower, { target: this.w.player.head });
		this.hudEntity.object3D!.visible = false;
		const hudOff = this.hudEntity.getVectorView(Follower, 'offsetPosition');
		if (hudOff) { hudOff[0] = 0; hudOff[1] = 0.22; hudOff[2] = -1.0; }

		// Scorecard (hidden off-screen)
		this.scorecardEntity = this.w.createTransformEntity(new Group());
		this.scorecardEntity.object3D!.position.set(0, hideY, panelZ);
		this.scorecardEntity.addComponent(PanelUI, { config: './ui/scorecard.json', maxWidth: 0.9 });

		// Game over (hidden off-screen)
		this.gameOverEntity = this.w.createTransformEntity(new Group());
		this.gameOverEntity.object3D!.position.set(0, hideY, panelZ);
		this.gameOverEntity.addComponent(PanelUI, { config: './ui/game-over.json', maxWidth: 0.9 });

		// Settings (hidden off-screen)
		this.settingsEntity = this.w.createTransformEntity(new Group());
		this.settingsEntity.object3D!.position.set(0, hideY, panelZ);
		this.settingsEntity.addComponent(PanelUI, { config: './ui/settings.json', maxWidth: 0.9 });

		// Achievements (hidden off-screen)
		this.achvEntity = this.w.createTransformEntity(new Group());
		this.achvEntity.object3D!.position.set(0, hideY, panelZ);
		this.achvEntity.addComponent(PanelUI, { config: './ui/achvlist.json', maxWidth: 1.0 });

		// Stats (hidden off-screen)
		this.statsEntity = this.w.createTransformEntity(new Group());
		this.statsEntity.object3D!.position.set(0, hideY, panelZ);
		this.statsEntity.addComponent(PanelUI, { config: './ui/stats.json', maxWidth: 0.9 });

		// Leaderboard (hidden off-screen)
		this.lbEntity = this.w.createTransformEntity(new Group());
		this.lbEntity.object3D!.position.set(0, hideY, panelZ);
		this.lbEntity.addComponent(PanelUI, { config: './ui/leaderboard.json', maxWidth: 1.0 });

		// Tutorial (hidden off-screen)
		this.tutorialEntity = this.w.createTransformEntity(new Group());
		this.tutorialEntity.object3D!.position.set(0, hideY, panelZ);
		this.tutorialEntity.addComponent(PanelUI, { config: './ui/tutorial.json', maxWidth: 1.0 });
	}

	init() {
		// Panel qualify subscriptions
		this.queries.menuPanel.subscribe('qualify', (e) => {
			this.menuDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.menuDoc) return;
			this.bindMenu();
		});
		this.queries.modePanel.subscribe('qualify', (e) => {
			this.modeDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.modeDoc) return;
			this.bindModeSelect();
		});
		this.queries.hudPanel.subscribe('qualify', (e) => {
			this.hudDoc = PanelDocument.data.document[e.index] as UIKitDocument;
		});
		this.queries.scorecardPanel.subscribe('qualify', (e) => {
			this.scorecardDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.scorecardDoc) return;
			this.bindScorecard();
		});
		this.queries.gameOverPanel.subscribe('qualify', (e) => {
			this.gameOverDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.gameOverDoc) return;
			this.bindGameOver();
		});
		this.queries.settingsPanel.subscribe('qualify', (e) => {
			this.settingsDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.settingsDoc) return;
			this.bindSettings();
		});
		this.queries.achvPanel.subscribe('qualify', (e) => {
			this.achvDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.achvDoc) return;
			this.bindAchievements();
		});
		this.queries.statsPanel.subscribe('qualify', (e) => {
			this.statsDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.statsDoc) return;
			this.bindStats();
		});
		this.queries.lbPanel.subscribe('qualify', (e) => {
			this.lbDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.lbDoc) return;
			this.bindLeaderboard();
		});
		this.queries.tutorialPanel.subscribe('qualify', (e) => {
			this.tutorialDoc = PanelDocument.data.document[e.index] as UIKitDocument;
			if (!this.tutorialDoc) return;
			this.bindTutorial();
		});
	}

	// ── Panel bindings ──
	bindMenu() {
		const d = this.menuDoc!;
		(d.getElementById('btn-play') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('mode_select'); });
		(d.getElementById('btn-settings') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('settings'); });
		(d.getElementById('btn-achieve') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.refreshAchievements(); this.showState('achievements'); });
		(d.getElementById('btn-stats') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.refreshStats(); this.showState('stats'); });
		(d.getElementById('btn-leaderboard') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.refreshLeaderboard(); this.showState('leaderboard'); });
		(d.getElementById('btn-tutorial') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('tutorial'); });
		this.updateMenuLabels();
	}

	bindModeSelect() {
		const d = this.modeDoc!;
		(d.getElementById('btn-arcade') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			if (!this.isUnlocked('arcade')) return;
			this.startGame('arcade');
		});
		(d.getElementById('btn-challenge') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			if (!this.isUnlocked('challenge')) return;
			this.startGame('challenge');
		});
		(d.getElementById('btn-training') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			if (!this.isUnlocked('training')) return;
			this.startGame('training');
		});
		(d.getElementById('btn-timeattack') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			if (!this.isUnlocked('timeattack')) return;
			this.startGame('timeattack');
		});
		(d.getElementById('btn-endless') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			if (!this.isUnlocked('endless')) return;
			this.startGame('endless');
		});
		(d.getElementById('btn-daily') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			if (!this.isUnlocked('daily')) return;
			this.startGame('daily');
		});
		(d.getElementById('btn-back') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('menu'); });
	}

	bindScorecard() {
		const d = this.scorecardDoc!;
		(d.getElementById('sc-continue') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.nextWave(); });
		(d.getElementById('sc-menu') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('menu'); });
	}

	bindGameOver() {
		const d = this.gameOverDoc!;
		(d.getElementById('go-retry') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.startGame(this.mode); });
		(d.getElementById('go-menu') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('menu'); });
	}

	bindSettings() {
		const d = this.settingsDoc!;
		(d.getElementById('set-diff') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			const opts: Difficulty[] = this.isUnlocked('hard') ? ['easy', 'normal', 'hard'] : ['easy', 'normal'];
			const idx = (opts.indexOf(this.difficulty) + 1) % opts.length;
			this.difficulty = opts[idx];
			this.setTxt(d, 'set-diff', this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1));
		});
		(d.getElementById('set-sfx') as UIKit.Text)?.addEventListener('click', () => {
			this.sfxVol = (this.sfxVol + 25) % 125;
			this.setTxt(d, 'set-sfx', this.sfxVol + '%');
			playSfx('click', this.sfxVol / 100 * 0.3);
		});
		(d.getElementById('set-music') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			this.musicOn = !this.musicOn;
			this.setTxt(d, 'set-music', this.musicOn ? 'ON' : 'OFF');
		});
		(d.getElementById('set-particles') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			this.particlesOn = !this.particlesOn;
			this.setTxt(d, 'set-particles', this.particlesOn ? 'ON' : 'OFF');
		});
		(d.getElementById('set-back') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('menu'); });

		// R4: Training shot type selector
		(d.getElementById('set-train') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			const opts: TrainingShotOption[] = ['all', 'standard', 'curve', 'power', 'split', 'phantom', 'multi'];
			const idx = (opts.indexOf(this.trainingShotType) + 1) % opts.length;
			this.trainingShotType = opts[idx];
			this.setTxt(d, 'set-train', this.trainingShotType.toUpperCase());
		});

		// R5: Gauntlet color selector
		(d.getElementById('set-gauntlet') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			const opts = ['Cyan', 'Green', 'Gold', 'Pink', 'White'];
			const idx = (opts.indexOf(this.gauntletColor) + 1) % opts.length;
			this.gauntletColor = opts[idx];
			this.applyGauntletColor();
			this.setTxt(d, 'set-gauntlet', this.gauntletColor);
			this.saveData.gauntletColor = this.gauntletColor;
			this.persistSave();
		});

		// R8: Arena skin selector
		(d.getElementById('set-arena') as UIKit.Text)?.addEventListener('click', () => {
			playSfx('click');
			const allSkins = ['Neon Classic', 'Cyber Red', 'Ocean Deep', 'Void'];
			const available = allSkins.filter(s => this.isUnlocked('skin_' + s));
			if (available.length === 0) return;
			const idx = (available.indexOf(this.arenaSkin) + 1) % available.length;
			this.arenaSkin = available[idx];
			this.applyArenaSkin(this.arenaSkin);
			this.setTxt(d, 'set-arena', this.arenaSkin);
			this.saveData.arenaSkin = this.arenaSkin;
			this.persistSave();
		});
	}

	bindAchievements() {
		const d = this.achvDoc!;
		(d.getElementById('ach-back') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('menu'); });
		this.refreshAchievements();
	}

	bindStats() {
		const d = this.statsDoc!;
		(d.getElementById('st-back') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('menu'); });
		this.refreshStats();
	}

	bindLeaderboard() {
		const d = this.lbDoc!;
		(d.getElementById('lb-back') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('menu'); });
		(d.getElementById('lb-tab-arcade') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.lbActiveTab = 'arcade'; this.refreshLeaderboard(); });
		(d.getElementById('lb-tab-challenge') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.lbActiveTab = 'challenge'; this.refreshLeaderboard(); });
		(d.getElementById('lb-tab-timeattack') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.lbActiveTab = 'timeattack'; this.refreshLeaderboard(); });
		(d.getElementById('lb-tab-endless') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.lbActiveTab = 'endless'; this.refreshLeaderboard(); });
		(d.getElementById('lb-tab-daily') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.lbActiveTab = 'daily'; this.refreshLeaderboard(); });
		this.refreshLeaderboard();
	}

	bindTutorial() {
		const d = this.tutorialDoc!;
		(d.getElementById('tut-back') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('menu'); });
	}

	refreshLeaderboard() {
		if (!this.lbDoc) return;
		const d = this.lbDoc;
		const tab = this.lbActiveTab;
		const titles: Record<string, string> = { arcade: 'ARCADE', challenge: 'CHALLENGE', timeattack: 'TIME ATTACK', endless: 'ENDLESS', daily: 'DAILY' };
		this.setTxt(d, 'lb-mode-title', titles[tab] || 'ARCADE');

		// Filter entries for this mode, sorted by score desc
		const entries = (this.saveData.leaderboard || [])
			.filter(e => e.mode === tab)
			.sort((a, b) => b.score - a.score)
			.slice(0, 5);

		for (let i = 0; i < 5; i++) {
			if (i < entries.length) {
				const e = entries[i];
				this.setTxt(d, 'lb-rank-' + i, String(i + 1));
				this.setTxt(d, 'lb-score-' + i, String(e.score));
				this.setTxt(d, 'lb-wave-' + i, String(e.wave));
				this.setTxt(d, 'lb-grade-' + i, e.grade);
				this.setTxt(d, 'lb-date-' + i, e.date);
			} else {
				this.setTxt(d, 'lb-rank-' + i, String(i + 1));
				this.setTxt(d, 'lb-score-' + i, '---');
				this.setTxt(d, 'lb-wave-' + i, '--');
				this.setTxt(d, 'lb-grade-' + i, '--');
				this.setTxt(d, 'lb-date-' + i, '--');
			}
		}

		const best = entries.length > 0 ? entries[0].score : 0;
		this.setTxt(d, 'lb-personal', 'Your best: ' + (best > 0 ? String(best) : '---'));
	}

	recordLeaderboard() {
		if (this.mode === 'training') return;
		if (!this.saveData.leaderboard) this.saveData.leaderboard = [];
		const now = new Date();
		const dateStr = (now.getMonth() + 1) + '/' + now.getDate();
		const entry: LeaderboardEntry = {
			score: this.score,
			wave: this.wave,
			grade: this.getGrade(),
			mode: this.mode,
			date: dateStr,
			saves: this.totalSaves,
			catches: this.totalCatches,
		};
		this.saveData.leaderboard.push(entry);
		// Keep max 50 entries total to avoid localStorage bloat
		if (this.saveData.leaderboard.length > 50) {
			// Remove oldest low-score entries
			this.saveData.leaderboard.sort((a, b) => b.score - a.score);
			this.saveData.leaderboard = this.saveData.leaderboard.slice(0, 50);
		}
	}

	// ── UI Helpers ──
	setTxt(doc: UIKitDocument, id: string, text: string) {
		(doc.getElementById(id) as UIKit.Text | undefined)?.setProperties({ text });
	}

	updateMenuLabels() {
		if (!this.menuDoc) return;
		const rank = this.getRank();
		this.setTxt(this.menuDoc, 'rank-label', 'Rank: ' + rank);
		this.setTxt(this.menuDoc, 'best-label', 'Best Wave: ' + (this.saveData.bestWave || '--'));
		// R8: Play time
		const mins = Math.floor(this.saveData.playTimeMs / 60000);
		const timeStr = mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
		this.setTxt(this.menuDoc, 'playtime-label', 'Play Time: ' + timeStr);
		this.setTxt(this.menuDoc, 'version-label', 'v1.0 - Build 109');
	}

	updateChallengeStarsDisplay(totalStars: number) {
		if (!this.modeDoc) return;
		this.setTxt(this.modeDoc, 'challenge-desc', '10 preset patterns - ' + totalStars + '/30 Stars');
	}

	updateHud() {
		if (!this.hudDoc) return;
		this.setTxt(this.hudDoc, 'score', String(this.score));
		this.setTxt(this.hudDoc, 'wave', String(this.wave));
		this.setTxt(this.hudDoc, 'combo', 'x' + Math.max(1, Math.floor(1 + this.combo * 0.5)));
		this.setTxt(this.hudDoc, 'lives', this.mode === 'training' ? '--' : String(this.lives));
		if (this.mode === 'timeattack') {
			this.setTxt(this.hudDoc, 'timer', Math.ceil(this.timeLeft) + 's');
		} else if (this.mode === 'challenge') {
			this.setTxt(this.hudDoc, 'timer', 'Challenge ' + this.challengeLevel + '/10');
		} else if (this.mode === 'daily') {
			this.setTxt(this.hudDoc, 'timer', 'DAILY ' + getTodayDateStr());
		} else if (this.mode === 'endless') {
			this.setTxt(this.hudDoc, 'timer', 'Endless W' + this.endlessInternalWave);
		} else {
			this.setTxt(this.hudDoc, 'timer', this.mode === 'training' ? 'Training Mode' : '');
		}
		// R6: Shot counter
		if (this.mode === 'endless') {
			this.setTxt(this.hudDoc, 'shots-left', 'BLOCKED: ' + this.endlessShotsBlocked);
		} else if (this.mode === 'timeattack') {
			this.setTxt(this.hudDoc, 'shots-left', 'SAVES: ' + this.totalSaves);
		} else if (this.mode === 'daily') {
			this.setTxt(this.hudDoc, 'shots-left', 'WAVE: ' + this.wave + '/8');
		} else if (this.mode === 'training') {
			this.setTxt(this.hudDoc, 'shots-left', 'SHOTS: ' + this.waveShotsLaunched + '/' + this.waveShots);
		} else {
			this.setTxt(this.hudDoc, 'shots-left', 'SHOTS: ' + this.waveShotsLaunched + '/' + this.waveShots);
		}
		// R9: Session elapsed time
		const secs = Math.floor(this.sessionElapsed);
		const m = Math.floor(secs / 60);
		const ss = String(secs % 60).padStart(2, '0');
		this.setTxt(this.hudDoc, 'session-time', m + ':' + ss);
	}

	refreshAchievements() {
		if (!this.achvDoc) return;
		let unlocked = 0;
		for (let i = 0; i < 30; i++) {
			const done = this.saveData.achievements[i];
			if (done) unlocked++;
			const prefix = done ? '[*] ' : '[ ] ';
			const color = done ? '#ffaa00' : '#334455';
			const el = this.achvDoc.getElementById('ach-' + i) as UIKit.Text | undefined;
			el?.setProperties({ text: prefix + ACHV_NAMES[i] + ' - ' + ACHV_DESC[i], color });
		}
		this.setTxt(this.achvDoc, 'ach-count', unlocked + ' / 30 Unlocked');
	}

	refreshStats() {
		if (!this.statsDoc) return;
		const s = this.saveData;
		this.setTxt(this.statsDoc, 'st-games', String(s.gamesPlayed));
		this.setTxt(this.statsDoc, 'st-saves', String(s.totalSaves));
		this.setTxt(this.statsDoc, 'st-catches', String(s.totalCatches));
		this.setTxt(this.statsDoc, 'st-conceded', String(s.totalGoals));
		const total = s.totalSaves + s.totalGoals;
		this.setTxt(this.statsDoc, 'st-rate', total > 0 ? Math.round(s.totalSaves / total * 100) + '%' : '0%');
		this.setTxt(this.statsDoc, 'st-bestwave', String(s.bestWave));
		this.setTxt(this.statsDoc, 'st-bestscore', String(s.bestScore));
		this.setTxt(this.statsDoc, 'st-beststreak', String(s.bestStreak));
		const mins = Math.floor(s.playTimeMs / 60000);
		this.setTxt(this.statsDoc, 'st-time', mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm');

		// R5: Per-mode bests
		if (s.modeStats) {
			const ms = s.modeStats;
			this.setTxt(this.statsDoc, 'st-arcade-best', ms.arcade ? String(ms.arcade.bestScore) : '0');
			this.setTxt(this.statsDoc, 'st-challenge-best', ms.challenge ? String(ms.challenge.bestScore) : '0');
			this.setTxt(this.statsDoc, 'st-training-best', ms.training ? String(ms.training.bestScore) : '0');
			this.setTxt(this.statsDoc, 'st-timeattack-best', ms.timeattack ? String(ms.timeattack.bestScore) : '0');
			this.setTxt(this.statsDoc, 'st-endless-best', ms.endless ? String(ms.endless.bestScore) : '0');
			this.setTxt(this.statsDoc, 'st-daily-best', ms.daily ? String(ms.daily.bestScore) : '0');
		}

		// R7: Per-shot-type save rates
		if (s.shotStats) {
			const shotTypes = ['standard', 'curve', 'power', 'split', 'phantom', 'multi', 'boss'];
			for (const st of shotTypes) {
				const entry = s.shotStats[st];
				if (entry) {
					const stTotal = entry.saves + entry.goals;
					const rate = stTotal > 0 ? Math.round(entry.saves / stTotal * 100) : 0;
					const display = stTotal > 0
						? st.charAt(0).toUpperCase() + st.slice(1) + ': ' + rate + '% (' + entry.saves + '/' + stTotal + ')'
						: '';
					this.setTxt(this.statsDoc, 'st-' + st + '-rate', display);
				} else {
					this.setTxt(this.statsDoc, 'st-' + st + '-rate', '');
				}
			}
		}
	}

	getRank(): string {
		const total = this.saveData.totalSaves + this.saveData.achievements.filter(Boolean).length * 5;
		if (total >= 500) return RANKS[8];
		if (total >= 300) return RANKS[7];
		if (total >= 200) return RANKS[6];
		if (total >= 150) return RANKS[5];
		if (total >= 100) return RANKS[4];
		if (total >= 60) return RANKS[3];
		if (total >= 30) return RANKS[2];
		if (total >= 10) return RANKS[1];
		return RANKS[0];
	}

	// ── State management ──
	showState(s: GameState) {
		this.state = s;
		const showY = 1.5;
		const hideY = -50;
		const panelZ = -1.8;

		this.menuEntity.object3D!.position.set(0, s === 'menu' ? showY : hideY, panelZ);
		this.modeEntity.object3D!.position.set(0, s === 'mode_select' ? showY : hideY, panelZ);
		this.scorecardEntity.object3D!.position.set(0, s === 'wave_complete' ? showY : hideY, panelZ);
		this.gameOverEntity.object3D!.position.set(0, s === 'game_over' ? showY : hideY, panelZ);
		this.settingsEntity.object3D!.position.set(0, s === 'settings' ? showY : hideY, panelZ);
		this.achvEntity.object3D!.position.set(0, s === 'achievements' ? showY : hideY, panelZ);
		this.statsEntity.object3D!.position.set(0, s === 'stats' ? showY : hideY, panelZ);
		this.lbEntity.object3D!.position.set(0, s === 'leaderboard' ? showY : hideY, panelZ);
		this.tutorialEntity.object3D!.position.set(0, s === 'tutorial' ? showY : hideY, panelZ);

		// HUD uses Follower, so toggle visible
		this.hudEntity.object3D!.visible = s === 'playing';

		// Show/hide goal based on game state
		this.goalGroup.visible = s === 'playing' || s === 'wave_complete' || s === 'game_over';

		// R8: Show/hide countdown ring
		if (this.countdownRing) {
			this.countdownRing.visible = s === 'playing' && this.mode === 'timeattack';
		}

		if (s === 'menu') {
			this.updateMenuLabels();
			this.clearShots();
			this.clearPowerUps(); // R4
			this.removeWaveModifier(); // R4
			this.clearWarningArrows(); // R5
			this.applyArenaSkin(this.arenaSkin); // R8: Apply arena skin in menu
			stopMusic(); // R3: stop generative music
			// R8: Spawn demo shots
			this.spawnDemoShots();
		} else {
			// R8: Clear demo shots when leaving menu
			this.clearDemoShots();
		}
		// R6: Update challenge stars on mode select
		if (s === 'mode_select' && this.modeDoc) {
			const totalStars = (this.saveData.challengeStars || []).reduce((a: number, b: number) => a + b, 0);
			const descEl = this.modeDoc.getElementById('endless-desc') as UIKit.Text | undefined;
			// Update challenge desc with stars
			const chalDesc = this.modeDoc.getElementById('btn-challenge');
			// Set via direct text elements if available
			if (totalStars > 0) {
				// Find the description text inside challenge container
				this.updateChallengeStarsDisplay(totalStars);
			}
			// R8: Update progressive unlock visuals
			this.refreshModeSelectLocks();
			// R8: Update daily best on daily button
			this.updateDailyButtonDesc();
		}
		// R8: Update arena skin label on settings show
		if (s === 'settings' && this.settingsDoc) {
			this.setTxt(this.settingsDoc, 'set-arena', this.arenaSkin);
			// R8: Update difficulty lock
			this.refreshDifficultyLock();
		}
	}

	// ── Game flow ──
	startGame(mode: GameMode) {
		this.mode = mode;
		this.score = 0;
		this.wave = 1;
		this.combo = 0;
		this.bestCombo = 0;
		this.totalSaves = 0;
		this.totalCatches = 0;
		this.totalGoals = 0;
		this.challengeLevel = mode === 'challenge' ? 1 : 0;
		this.gameStartTime = performance.now();

		if (mode === 'arcade') this.lives = 3;
		else if (mode === 'challenge') this.lives = 1;
		else if (mode === 'training') this.lives = 999;
		else if (mode === 'endless') this.lives = 3;
		else if (mode === 'daily') this.lives = 1;
		else this.lives = 999; // timeattack

		this.timeLeft = mode === 'timeattack' ? 60 : 0;

		// R6: Reset endless counters
		this.endlessShotsBlocked = 0;
		this.endlessInternalWave = 1;

		// R6: Reset streak milestones
		this.streakMilestonesHit = new Set();

		// R8: Initialize daily RNG
		if (mode === 'daily') {
			this.dailyRng = seededRandom(getDailySeed());
		} else {
			this.dailyRng = null;
		}

		// R3: Apply mode-specific environment theme
		this.applyModeTheme(mode);

		// R3: Start generative music (replaces old ambient)
		if (this.musicOn) {
			stopMusic();
			startMusic(this.wave);
		}

		// R3: Reset split tracker
		this.splitSaveTracker.clear();
		this.splitIdCounter = 0;

		// R4: Reset DDA
		this.ddaMultiplier = 1.0;
		this.recentResults = [];

		// R4: Clear power-ups
		this.clearPowerUps();
		this.activePowerUp = null;
		this.powerUpTimer = 0;

		// R7: Reset per-game session shot stats
		this.gameSessionShotStats = {
			standard: { saves: 0, goals: 0 }, curve: { saves: 0, goals: 0 },
			power: { saves: 0, goals: 0 }, split: { saves: 0, goals: 0 },
			phantom: { saves: 0, goals: 0 }, multi: { saves: 0, goals: 0 },
			boss: { saves: 0, goals: 0 },
		};

		// R7: Reset power-up collection tracker
		this.powerUpsCollectedThisGame = new Set();

		// R7: Clear training paths
		this.clearTrainingPaths();

		// R4: Reset dive
		this.isDiving = false;
		this.diveTimer = 0;
		this.diveCooldown = 0;

		// R4: Reset modifier
		this.removeWaveModifier();

		// R5: Reset boss state
		this.bossSpawnedThisWave = false;
		this.bossDefeatedThisWave = false;
		this.clearWarningArrows();

		this.showState('playing');
		this.beginWave();
	}

	beginWave() {
		this.waveSaves = 0;
		this.waveGoals = 0;
		this.waveCatches = 0;
		this.waveShotsLaunched = 0;
		this.shotTimer = 1.0; // initial delay
		this.waveActive = false; // R6: wait for countdown
		this.powerUpSpawnedThisWave = false;

		// R3: Reset split tracker per wave
		this.splitSaveTracker.clear();

		// R5: Reset boss state per wave
		this.bossSpawnedThisWave = false;
		this.bossDefeatedThisWave = false;
		this.clearWarningArrows();

		// R5: Wave start flash
		this.triggerFlash(0x00ccff, 0.15, 0.3);

		// R4: Remove previous modifier, maybe apply new one (not in endless or daily)
		this.removeWaveModifier();
		if (this.mode === 'daily') {
			// R8: Daily mode — seeded modifier per wave
			if (this.dailyRng && this.wave >= 2) {
				const mods: WaveModifier[] = ['fast_shots', 'giant_balls', 'tiny_goal', 'mirror', 'fog_thick', 'double_shots', 'low_gravity', 'speed_ramp'];
				const modIdx = Math.floor(this.dailyRng() * mods.length);
				this.currentModifier = mods[modIdx];
				this.applyWaveModifier();
				this.modifierDisplayTimer = 3.0;
			}
		} else if (this.wave >= 3 && this.mode !== 'training' && this.mode !== 'endless' && Math.random() < 0.3) {
			const mods: WaveModifier[] = ['fast_shots', 'giant_balls', 'tiny_goal', 'mirror', 'fog_thick', 'double_shots', 'low_gravity', 'speed_ramp'];
			this.currentModifier = mods[Math.floor(Math.random() * mods.length)];
			this.applyWaveModifier();
			this.modifierDisplayTimer = 3.0;
			// R7: Track modifier for Modifier Master achievement
			if (!this.saveData.modifiersSeen) this.saveData.modifiersSeen = [];
			if (!this.saveData.modifiersSeen.includes(this.currentModifier)) {
				this.saveData.modifiersSeen.push(this.currentModifier);
				this.persistSave();
			}
		}

		const dm = DIFF_MULT[this.difficulty];
		const w = this.wave;

		// R3: Challenge mode uses scripted formations
		this.challengeQueue = [];
		if (this.mode === 'challenge') {
			this.buildChallengeQueue(this.challengeLevel);
			this.waveShots = this.challengeQueue.length;
			this.shotInterval = Math.max(0.5, 1.5 - this.challengeLevel * 0.08) / dm;
		} else if (this.mode === 'daily') {
			// R8: Daily challenge — seeded shot generation
			this.buildDailyWaveQueue();
			this.waveShots = this.challengeQueue.length;
			this.shotInterval = Math.max(0.5, 1.3 - this.wave * 0.05) / dm;
		} else if (this.mode === 'timeattack') {
			this.waveShots = 999; // continuous
			this.shotInterval = Math.max(0.4, 1.2 - w * 0.05) / dm;
		} else if (this.mode === 'training') {
			this.waveShots = 5;
			this.shotInterval = 2.5;
		} else if (this.mode === 'endless') {
			this.waveShots = 999; // continuous — no wave breaks
			this.shotInterval = Math.max(0.3, 1.5 - this.endlessInternalWave * 0.03) / dm;
		} else {
			this.waveShots = Math.min(4 + w * 2, 30);
			this.shotInterval = Math.max(0.4, 1.5 - w * 0.06) / dm;
		}

		// R4: Apply DDA to shot interval (arcade and endless)
		if (this.mode === 'arcade' || this.mode === 'endless') {
			this.shotInterval /= this.ddaMultiplier;
		}

		playSfx('wave');

		// R3: Update music tempo with wave
		updateMusicTempo(w);

		// R2: Wave preview — show incoming shot types on HUD
		this.wavePreviewTimer = 2.0;
		const types = this.getShotTypes();
		const typeNames = types.map(t => t.charAt(0).toUpperCase() + t.slice(1));
		let previewText = 'WAVE ' + w + ': ' + typeNames.join(' + ');
		// R4: Append modifier info
		if (this.currentModifier !== 'normal') {
			const modNames: Record<WaveModifier, string> = {
				normal: '', fast_shots: 'FAST!', giant_balls: 'GIANT!',
				tiny_goal: 'TINY GOAL!', mirror: 'MIRROR!', fog_thick: 'FOG!',
				double_shots: 'DOUBLE!', low_gravity: 'LOW GRAV!', speed_ramp: 'SPEED RAMP!',
			};
			previewText += ' [' + modNames[this.currentModifier] + ']';
		}
		// R5: Boss wave indicator
		if (this.mode === 'arcade' && w % 5 === 0 && w > 0) {
			previewText = 'BOSS INCOMING! WAVE ' + w;
			this.wavePreviewTimer = 2.5;
		}
		if (this.hudDoc) {
			this.setTxt(this.hudDoc, 'status', previewText);
		}

		// R6: Start countdown (wave goes active after countdown ends)
		this.startCountdown();

		this.updateHud();
	}

	endWave() {
		this.waveActive = false;
		this.removeWaveModifier(); // R4: clean up modifier

		if (this.mode === 'challenge') {
			// R6: Calculate challenge stars
			const levelIdx = this.challengeLevel - 1; // 0-based
			if (levelIdx >= 0 && levelIdx < 10) {
				let stars = 1; // completed
				if (this.waveGoals === 0) stars = 3;
				else if (this.waveGoals === 1) stars = 2;
				// Only upgrade, never downgrade
				if (!this.saveData.challengeStars) this.saveData.challengeStars = new Array(10).fill(0);
				if (stars > this.saveData.challengeStars[levelIdx]) {
					this.saveData.challengeStars[levelIdx] = stars;
					this.persistSave();
				}
				// R7: Perfect Challenge — 3 stars on any level
				if (stars >= 3) this.unlockAchievement(25);
				// R7: Star Collector — all 30 stars
				const totalStars = this.saveData.challengeStars.reduce((a: number, b: number) => a + b, 0);
				if (totalStars >= 30) this.unlockAchievement(26);
			}
			this.challengeLevel++;
			if (this.challengeLevel > 10) {
				this.unlockAchievement(18); // Challenge Clear
				this.endGame();
				return;
			}
		}

		if (this.mode === 'timeattack') {
			this.endGame();
			return;
		}

		// R8: Daily challenge — 8 waves total
		if (this.mode === 'daily') {
			if (this.wave >= 8) {
				this.endGame();
				return;
			}
		}

		// R6: Endless mode never ends waves (safety check)
		if (this.mode === 'endless') return;

		if (this.waveGoals === 0) this.unlockAchievement(1); // Clean Sheet

		// R7: Hard Mode Hero — wave 10 on hard
		if (this.difficulty === 'hard' && this.wave >= 10) {
			this.unlockAchievement(20);
		}

		// R7: Modifier Master — completed wave with every modifier type at least once
		if (this.saveData.modifiersSeen && this.saveData.modifiersSeen.length >= 8) {
			this.unlockAchievement(28);
		}

		// Show scorecard
		if (this.scorecardDoc) {
			let title = '';
			if (this.mode === 'challenge') {
				const levelIdx = this.challengeLevel - 2; // we already incremented
				const stars = (this.saveData.challengeStars && levelIdx >= 0 && levelIdx < 10) ? this.saveData.challengeStars[levelIdx] : 0;
				const starStr = '*'.repeat(stars);
				title = 'CHALLENGE ' + (this.challengeLevel - 1) + ' CLEAR ' + starStr;
			} else {
				title = 'WAVE ' + this.wave + ' COMPLETE';
			}
			this.setTxt(this.scorecardDoc, 'sc-title', title);
			this.setTxt(this.scorecardDoc, 'sc-saves', String(this.waveSaves));
			this.setTxt(this.scorecardDoc, 'sc-goals', String(this.waveGoals));
			this.setTxt(this.scorecardDoc, 'sc-catches', String(this.waveCatches));
			this.setTxt(this.scorecardDoc, 'sc-streak', String(this.bestCombo));
			this.setTxt(this.scorecardDoc, 'sc-score', String(this.score));
		}
		this.showState('wave_complete');
	}

	nextWave() {
		this.wave++;
		this.showState('playing');
		this.beginWave();
	}

	endGame() {
		this.waveActive = false;
		this.clearShots();
		this.clearWarningArrows(); // R5

		// Update save data
		this.saveData.gamesPlayed++;
		this.saveData.totalSaves += this.totalSaves;
		this.saveData.totalCatches += this.totalCatches;
		this.saveData.totalGoals += this.totalGoals;
		if (this.wave > this.saveData.bestWave) this.saveData.bestWave = this.wave;
		if (this.score > this.saveData.bestScore) this.saveData.bestScore = this.score;
		if (this.bestCombo > this.saveData.bestStreak) this.saveData.bestStreak = this.bestCombo;
		this.saveData.playTimeMs += performance.now() - this.gameStartTime;

		// R6: Record leaderboard entry
		this.recordLeaderboard();

		// R8: Daily best tracking
		if (this.mode === 'daily') {
			const today = getTodayDateStr();
			if (!this.saveData.dailyBest || this.saveData.dailyBest.date !== today || this.score > this.saveData.dailyBest.score) {
				this.saveData.dailyBest = { date: today, score: this.score };
			}
		}

		// R5: Update per-mode stats
		if (!this.saveData.modeStats) {
			this.saveData.modeStats = {
				arcade: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				challenge: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				training: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				timeattack: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				endless: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
				daily: { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 },
			};
		}
		if (!this.saveData.modeStats.endless) {
			this.saveData.modeStats.endless = { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 };
		}
		if (!this.saveData.modeStats.daily) {
			this.saveData.modeStats.daily = { gamesPlayed: 0, bestScore: 0, bestWave: 0, totalSaves: 0 };
		}
		const ms = this.saveData.modeStats[this.mode];
		if (ms) {
			ms.gamesPlayed++;
			if (this.score > ms.bestScore) ms.bestScore = this.score;
			if (this.wave > ms.bestWave) ms.bestWave = this.wave;
			ms.totalSaves += this.totalSaves;
		}

		this.persistSave();

		// R7: Veteran — 50 games
		if (this.saveData.gamesPlayed >= 50) this.unlockAchievement(29);

		// R7: Clear training paths on game end
		this.clearTrainingPaths();

		// Show game over
		if (this.gameOverDoc) {
			this.setTxt(this.gameOverDoc, 'go-score', String(this.score));
			this.setTxt(this.gameOverDoc, 'go-waves', this.mode === 'endless' ? String(this.endlessInternalWave) : String(this.wave));
			this.setTxt(this.gameOverDoc, 'go-saves', String(this.totalSaves));
			this.setTxt(this.gameOverDoc, 'go-catches', String(this.totalCatches));
			this.setTxt(this.gameOverDoc, 'go-streak', String(this.bestCombo));
			const total = this.totalSaves + this.totalGoals;
			this.setTxt(this.gameOverDoc, 'go-rate', total > 0 ? Math.round(this.totalSaves / total * 100) + '%' : '0%');
			const isRecord = this.score >= this.saveData.bestScore;

			// R5: Grade system
			const grade = this.getGrade();
			const gradeColor = this.getGradeColor(grade);
			const tip = this.getGradeTip();
			let recordText = 'GRADE: ' + grade;
			if (isRecord) recordText = 'NEW RECORD! GRADE: ' + grade;
			this.setTxt(this.gameOverDoc, 'go-record', recordText);

			// R5: Show tip
			this.setTxt(this.gameOverDoc, 'go-tip', tip);

			// R5: Set grade color
			const gradeEl = this.gameOverDoc.getElementById('go-record') as UIKit.Text | undefined;
			gradeEl?.setProperties({ color: gradeColor });

			// R7: Per-shot-type breakdown on game over
			const goShotTypes = ['standard', 'curve', 'power', 'split', 'phantom', 'multi'];
			for (const st of goShotTypes) {
				const entry = this.gameSessionShotStats[st];
				if (entry && (entry.saves + entry.goals) > 0) {
					const stTotal = entry.saves + entry.goals;
					this.setTxt(this.gameOverDoc, 'go-stat-' + st,
						st.charAt(0).toUpperCase() + st.slice(1) + ': ' + entry.saves + '/' + stTotal);
				} else {
					this.setTxt(this.gameOverDoc, 'go-stat-' + st, '');
				}
			}
		}
		this.showState('game_over');
		playSfx('gameover');

		// R5: Game over flash
		this.triggerFlash(0xff4444, 0.3, 0.4);
	}

	// ── Shots ──
	getShotTypes(): ShotType[] {
		// R6: Endless mode — all types from the start
		if (this.mode === 'endless') return ['standard', 'curve', 'power', 'split', 'phantom', 'multi'];
		// R8: Daily mode — all types from the start
		if (this.mode === 'daily') return ['standard', 'curve', 'power', 'split', 'phantom', 'multi'];
		const w = this.wave;
		const types: ShotType[] = ['standard'];
		if (w >= 3 || this.mode === 'challenge') types.push('curve');
		if (w >= 5 || (this.mode === 'challenge' && this.challengeLevel >= 3)) types.push('power');
		if (w >= 8 || (this.mode === 'challenge' && this.challengeLevel >= 5)) types.push('split');
		if (w >= 12 || (this.mode === 'challenge' && this.challengeLevel >= 7)) types.push('phantom');
		if (w >= 15 || (this.mode === 'challenge' && this.challengeLevel >= 9)) types.push('multi');
		return types;
	}

	spawnShot(type?: ShotType) {
		// R9: Track shot spawn time for reaction time measurement
		this.lastShotSpawnTime = performance.now();

		// R3: Challenge mode pops from scripted queue
		if (this.mode === 'challenge' && this.challengeQueue.length > 0 && !type) {
			type = this.challengeQueue.shift()!;
		}
		// R4: Training mode uses selected shot type
		if (this.mode === 'training' && this.trainingShotType !== 'all' && !type) {
			type = this.trainingShotType;
		}
		const types = this.getShotTypes();
		if (!type) type = types[Math.floor(Math.random() * types.length)];

		// R2: Multi-shot spawns 3 spread shots and returns
		if (type === 'multi') {
			this.spawnMultiShots();
			return;
		}

		const dm = DIFF_MULT[this.difficulty];
		const targetX = (Math.random() - 0.5) * (GOAL_WIDTH - 0.4);
		const targetY = 0.3 + Math.random() * (GOAL_HEIGHT - 0.6);
		const target = new Vector3(targetX, targetY, GOAL_Z);

		const spawnX = (Math.random() - 0.5) * 6;
		const spawnY = 1 + Math.random() * 2.5;
		const spawnZ = SPAWN_Z + Math.random() * 5;
		const pos = new Vector3(spawnX, spawnY, spawnZ);

		let speed = 8;
		if (type === 'power') speed = 14;
		else if (type === 'curve') speed = 7;
		else if (type === 'phantom') speed = 9;
		else if (type === 'split') speed = 7.5;
		if (this.mode === 'training') speed *= 0.5;
		speed *= dm;

		// R4: DDA multiplier (arcade + endless)
		if (this.mode === 'arcade' || this.mode === 'endless') {
			speed *= this.ddaMultiplier;
		}

		// R6: Endless progressive speed multiplier
		if (this.mode === 'endless') {
			speed *= Math.min(2.5, 1.0 + this.endlessInternalWave * 0.05);
		}

		// R4: Wave modifier — fast_shots
		if (this.currentModifier === 'fast_shots') {
			speed *= 1.5;
		} else if (this.currentModifier === 'giant_balls') {
			speed *= 0.7;
		}

		// R4: Power-up — slow_mo
		if (this.activePowerUp === 'slow_mo') {
			speed *= 0.5;
		}

		const dir = target.clone().sub(pos).normalize();
		const vel = dir.multiplyScalar(speed);

		// Mesh
		let radius = type === 'power' ? SHOT_RADIUS * 0.8 : SHOT_RADIUS;
		// R4: Wave modifier — giant_balls
		if (this.currentModifier === 'giant_balls') {
			radius *= 2.0;
		}

		let color = 0x00ffcc;
		if (type === 'curve') color = 0xffaa00;
		else if (type === 'power') color = 0xff4444;
		else if (type === 'split') color = 0xcc44ff;
		else if (type === 'phantom') color = 0x44ccff;

		// R6: Visual shot differentiation — different geometry per shot type
		let geo: SphereGeometry | BoxGeometry | CylinderGeometry;
		let mesh: Mesh;
		const mat = new MeshStandardMaterial({
			color, emissive: color, emissiveIntensity: 1.0,
			transparent: true, opacity: 0.9,
		});

		if (type === 'curve') {
			// Low-poly angular look
			geo = new SphereGeometry(radius, 4, 3);
			mesh = new Mesh(geo, mat);
		} else if (type === 'power') {
			// Glowing cube, slightly larger
			const boxGeo = new BoxGeometry(radius * 2.2, radius * 2.2, radius * 2.2);
			mesh = new Mesh(boxGeo, mat);
		} else if (type === 'split') {
			// Two small spheres connected with a thin cylinder
			const groupMesh = new Group();
			const subGeo = new SphereGeometry(radius * 0.6, 8, 6);
			const subL = new Mesh(subGeo, mat);
			subL.position.set(-0.1, 0, 0);
			groupMesh.add(subL);
			const subR = new Mesh(subGeo, mat.clone());
			subR.position.set(0.1, 0, 0);
			groupMesh.add(subR);
			const connGeo = new CylinderGeometry(0.02, 0.02, 0.2, 6);
			const connMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
			const conn = new Mesh(connGeo, connMat);
			conn.rotation.z = Math.PI / 2;
			groupMesh.add(conn);
			groupMesh.position.copy(pos);
			this.scene.add(groupMesh);
			// Use a tiny invisible mesh as the shot mesh reference for position tracking
			const phantomGeo = new SphereGeometry(0.001, 2, 2);
			mesh = new Mesh(phantomGeo, new MeshBasicMaterial({ visible: false }));
			mesh.position.copy(pos);
			mesh.userData.splitGroup = groupMesh;
			this.scene.add(mesh);
		} else if (type === 'phantom') {
			// Sphere with wireframe overlay
			geo = new SphereGeometry(radius, 10, 8);
			mesh = new Mesh(geo, mat);
			const edgesGeo = new EdgesGeometry(geo);
			const edgeMat = new LineBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0.6 });
			const wireframe = new LineSegments(edgesGeo, edgeMat);
			mesh.add(wireframe);
		} else {
			// Standard sphere
			geo = new SphereGeometry(radius, 10, 8);
			mesh = new Mesh(geo, mat);
		}

		if (type !== 'split') {
			mesh.position.copy(pos);
			this.scene.add(mesh);
		}

		// Trail
		const trail = new Group();
		const trailColors: Record<ShotType, number> = {
			standard: 0x00ffcc, curve: 0xffaa00, power: 0xff4444,
			split: 0xcc44ff, phantom: 0x44ccff, multi: 0xff8800,
		};
		const trailColor = trailColors[type] || color;
		for (let i = 0; i < 5; i++) {
			const tGeo = new SphereGeometry(radius * (1 - i * 0.15), 6, 4);
			const tMat = new MeshBasicMaterial({
				color: trailColor, transparent: true, opacity: 0.3 - i * 0.05,
			});
			const tMesh = new Mesh(tGeo, tMat);
			trail.add(tMesh);
		}
		// R6: Curve shot gets extra spiral trail markers
		if (type === 'curve') {
			for (let i = 0; i < 3; i++) {
				const sGeo = new SphereGeometry(radius * 0.4, 4, 3);
				const sMat = new MeshBasicMaterial({
					color: 0xffdd44, transparent: true, opacity: 0.15,
				});
				trail.add(new Mesh(sGeo, sMat));
			}
		}
		this.scene.add(trail);

		const shot: Shot = {
			mesh, trail, type, pos: pos.clone(), vel: vel.clone(),
			target: target.clone(), speed, alive: true, blocked: false,
			splitDone: false, phantomTimer: 0, visible: true,
			curvePhase: Math.random() * Math.PI * 2,
			curveAmplitude: 1.5 + Math.random() * 1.5,
			spawnZ: pos.z,
			splitId: 0,
			approachSoundPlayed: false,
			hitsRemaining: 1,
			isBoss: false,
		};

		this.shots.push(shot);
		this.waveShotsLaunched++;
		playSfx('launch');

		// R7: Training mode trajectory preview
		if (this.mode === 'training') {
			this.addTrainingPath(shot);
		}

		// R7: Double shots modifier — spawn buddy shot after 0.5s
		if (this.currentModifier === 'double_shots') {
			const buddyTargetX = target.x + (Math.random() - 0.5) * 1.0;
			const buddyTargetY = Math.max(0.3, Math.min(GOAL_HEIGHT - 0.3, target.y + (Math.random() - 0.5) * 0.6));
			setTimeout(() => {
				if (this.state === 'playing' && this.waveActive) {
					const buddyTarget = new Vector3(buddyTargetX, buddyTargetY, GOAL_Z);
					const buddyPos = new Vector3(pos.x + (Math.random() - 0.5) * 2, pos.y, spawnZ);
					const buddyDir = buddyTarget.clone().sub(buddyPos).normalize();
					const buddyVel = buddyDir.multiplyScalar(speed * 0.9);
					const buddyGeo = new SphereGeometry(SHOT_RADIUS * 0.8, 8, 6);
					const buddyMat = new MeshStandardMaterial({
						color, emissive: color, emissiveIntensity: 0.8,
						transparent: true, opacity: 0.7,
					});
					const buddyMesh = new Mesh(buddyGeo, buddyMat);
					buddyMesh.position.copy(buddyPos);
					this.scene.add(buddyMesh);
					const buddyTrail = new Group();
					this.scene.add(buddyTrail);
					this.shots.push({
						mesh: buddyMesh, trail: buddyTrail, type: type!, pos: buddyPos.clone(),
						vel: buddyVel, target: buddyTarget, speed: speed * 0.9,
						alive: true, blocked: false, splitDone: true, phantomTimer: 0,
						visible: true, curvePhase: 0, curveAmplitude: 0, spawnZ: buddyPos.z,
						splitId: 0, approachSoundPlayed: false, hitsRemaining: 1, isBoss: false,
					});
				}
			}, 500);
		}
	}

	// ── R2: Multi-shot — 3 spread shots ──
	spawnMultiShots() {
		const dm = DIFF_MULT[this.difficulty];
		const baseSpeed = 6 * dm;
		const color = 0xff8800;
		const radius = SHOT_RADIUS * 0.65;

		const spawnX = (Math.random() - 0.5) * 4;
		const spawnY = 1.5 + Math.random() * 1.5;
		const spawnZ = SPAWN_Z + Math.random() * 3;
		const basePos = new Vector3(spawnX, spawnY, spawnZ);

		const offsets = [-1.2, 0, 1.2]; // spread across goal width

		for (let i = 0; i < 3; i++) {
			const targetX = offsets[i] + (Math.random() - 0.5) * 0.5;
			const targetY = 0.4 + Math.random() * (GOAL_HEIGHT - 0.8);
			const target = new Vector3(targetX, targetY, GOAL_Z);

			const pos = basePos.clone();
			pos.x += offsets[i] * 0.3;

			const dir = target.clone().sub(pos).normalize();
			const vel = dir.multiplyScalar(baseSpeed);

			// R6: Multi shots use flat cylinder (disc) shape
			const geo = new CylinderGeometry(radius, radius, 0.04, 12);
			const mat = new MeshStandardMaterial({
				color, emissive: color, emissiveIntensity: 1.0,
				transparent: true, opacity: 0.9,
			});
			const mesh = new Mesh(geo, mat);
			mesh.position.copy(pos);
			this.scene.add(mesh);

			const trail = new Group();
			for (let t = 0; t < 3; t++) {
				const tGeo = new SphereGeometry(radius * (1 - t * 0.2), 4, 3);
				const tMat = new MeshBasicMaterial({
					color, transparent: true, opacity: 0.25 - t * 0.06,
				});
				trail.add(new Mesh(tGeo, tMat));
			}
			this.scene.add(trail);

			this.shots.push({
				mesh, trail, type: 'standard', pos: pos.clone(), vel: vel.clone(),
				target, speed: baseSpeed, alive: true, blocked: false,
				splitDone: true, phantomTimer: 0, visible: true,
				curvePhase: 0, curveAmplitude: 0, spawnZ: pos.z,
				splitId: 0, approachSoundPlayed: false,
				hitsRemaining: 1, isBoss: false,
			});
		}

		this.waveShotsLaunched++;
		playSfx('multi');
	}

	spawnSplitChildren(parent: Shot) {
		this.splitIdCounter++;
		const currentSplitId = this.splitIdCounter;
		for (let i = 0; i < 2; i++) {
			const offset = i === 0 ? -0.8 : 0.8;
			const newTarget = parent.target.clone();
			newTarget.x += offset;

			const pos = parent.pos.clone();
			const dir = newTarget.clone().sub(pos).normalize();
			const vel = dir.multiplyScalar(parent.speed * 0.9);

			const geo = new SphereGeometry(SHOT_RADIUS * 0.7, 8, 6);
			const mat = new MeshStandardMaterial({
				color: 0xcc44ff, emissive: 0xcc44ff, emissiveIntensity: 1.0,
				transparent: true, opacity: 0.9,
			});
			const mesh = new Mesh(geo, mat);
			mesh.position.copy(pos);
			this.scene.add(mesh);

			const trail = new Group();
			this.scene.add(trail);

			this.shots.push({
				mesh, trail, type: 'standard', pos: pos.clone(), vel: vel.clone(),
				target: newTarget, speed: parent.speed * 0.9, alive: true, blocked: false,
				splitDone: true, phantomTimer: 0, visible: true,
				curvePhase: 0, curveAmplitude: 0, spawnZ: pos.z,
				splitId: currentSplitId, approachSoundPlayed: false,
				hitsRemaining: 1, isBoss: false,
			});
		}
		playSfx('split');
	}

	clearShots() {
		for (const s of this.shots) {
			if (s.mesh.userData.splitGroup) {
				this.scene.remove(s.mesh.userData.splitGroup);
			}
			this.scene.remove(s.mesh);
			this.scene.remove(s.trail);
		}
		this.shots = [];
		// R7: Also clear training paths
		this.clearTrainingPaths();
	}

	// ── Collision ──
	checkBlock(shot: Shot): { blocked: boolean; isCatch: boolean } {
		if (!shot.alive || shot.blocked) return { blocked: false, isCatch: false };

		// R4: Effective block radius (power-ups + dive)
		let effectiveRadius = BLOCK_RADIUS;
		if (this.activePowerUp === 'shield_expand') effectiveRadius *= 2.0;
		if (this.activePowerUp === 'magnet') effectiveRadius *= 3.0;
		if (this.isDiving) effectiveRadius *= 1.5;

		// XR controllers
		const rightGrip = this.w.playerSpaceEntities?.gripSpaces?.right?.object3D;
		const leftGrip = this.w.playerSpaceEntities?.gripSpaces?.left?.object3D;

		let isCatch = false;
		const rightGp = this.w.input?.xr?.gamepads?.right;
		const leftGp = this.w.input?.xr?.gamepads?.left;
		const gripHeld = (rightGp?.getButtonPressed(InputComponent.Squeeze)) || (leftGp?.getButtonPressed(InputComponent.Squeeze));

		if (rightGrip) {
			this.tmpVec.set(0, 0, 0);
			rightGrip.getWorldPosition(this.tmpVec);
			if (shot.pos.distanceTo(this.tmpVec) < effectiveRadius) {
				isCatch = !!gripHeld;
				return { blocked: true, isCatch };
			}
		}
		if (leftGrip) {
			this.tmpVec.set(0, 0, 0);
			leftGrip.getWorldPosition(this.tmpVec);
			if (shot.pos.distanceTo(this.tmpVec) < effectiveRadius) {
				isCatch = !!gripHeld;
				return { blocked: true, isCatch };
			}
		}

		// Browser mode: use gauntlet positions
		if (!rightGrip && !leftGrip) {
			if (shot.pos.distanceTo(this.gauntletPosL) < effectiveRadius) return { blocked: true, isCatch: false };
			if (shot.pos.distanceTo(this.gauntletPosR) < effectiveRadius) return { blocked: true, isCatch: false };
		}

		return { blocked: false, isCatch: false };
	}

	onSave(shot: Shot, isCatch: boolean) {
		// R5: Boss hit logic — if boss still has hits remaining, bounce it back
		if (shot.isBoss && shot.hitsRemaining > 1) {
			shot.hitsRemaining--;
			// Change color to show damage: 3→green, 2→yellow, 1→red
			const dmgColors = [0xff2200, 0xffaa00, 0x44ff00]; // 1, 2, 3 hits
			const newColor = dmgColors[shot.hitsRemaining - 1] || 0xff2200;
			const mat = shot.mesh.material as MeshStandardMaterial;
			mat.color.set(newColor);
			mat.emissive.set(newColor);
			// Bounce back slightly
			shot.vel.z = -Math.abs(shot.vel.z) * 0.4;
			shot.vel.y = 2;
			shot.pos.z -= 2;
			playSfx('bosshit');
			this.rumble('right', 0.8, 60);
			this.rumble('left', 0.8, 60);
			// Score partial hit
			this.score += 100;
			this.spawnScorePopup(shot.pos, '+100', '#ffaa00');
			if (this.particlesOn) this.spawnSaveParticles(shot.pos, newColor);
			this.updateHud();
			return;
		}

		shot.blocked = true;
		shot.alive = false;
		// R6: Clean up split group if present
		if (shot.mesh.userData.splitGroup) {
			this.scene.remove(shot.mesh.userData.splitGroup);
		}
		this.scene.remove(shot.mesh);
		this.scene.remove(shot.trail);

		this.combo++;
		if (this.combo > this.bestCombo) this.bestCombo = this.combo;
		this.waveSaves++;
		this.totalSaves++;


		// R7: Track per-shot-type stats (both session and career)
		const statKey = shot.isBoss ? 'boss' : shot.type;
		if (!this.gameSessionShotStats[statKey]) this.gameSessionShotStats[statKey] = { saves: 0, goals: 0 };
		this.gameSessionShotStats[statKey].saves++;
		if (this.saveData.shotStats) {
			if (!this.saveData.shotStats[statKey]) this.saveData.shotStats[statKey] = { saves: 0, goals: 0 };
			this.saveData.shotStats[statKey].saves++;
		}

		// Score
		const multi = Math.floor(1 + this.combo * 0.5);
		let base = 100;
		if (shot.type === 'curve') base = 150;
		else if (shot.type === 'power') base = 200;
		else if (shot.type === 'phantom') base = 250;
		else if (shot.type === 'split') base = 125;

		if (isCatch) {
			base += 50;
			this.waveCatches++;
			this.totalCatches++;
			playSfx('catch');
		} else {
			playSfx('save');
		}

		// R4: Double points power-up
		let earnMulti = 1;
		if (this.activePowerUp === 'double_points') earnMulti = 2;

		// R6: Endless mode 1.5x base multiplier
		if (this.mode === 'endless') earnMulti *= 1.5;

		// R5: Boss gives 500 base
		if (shot.isBoss) base = 500;

		const earned = base * multi * earnMulti;
		this.score += earned;

		// R5: Boss defeated effects
		if (shot.isBoss) {
			this.bossDefeatedThisWave = true;
			playSfx('bossdefeat');
			this.triggerFlash(0xffffff, 0.4, 0.5);
			if (this.hudDoc) this.setTxt(this.hudDoc, 'status', 'BOSS DEFEATED!');
			this.wavePreviewTimer = 2.0; // show for 2s
			// R7: Boss Slayer achievement — track across all games
			this.saveData.bossesDefeated = (this.saveData.bossesDefeated || 0) + 1;
			if (this.saveData.bossesDefeated >= 5) this.unlockAchievement(24);
		}

		// R7: Dive Save achievement
		if (this.isDiving) this.unlockAchievement(22);

		// R4: DDA tracking (arcade + endless)
		if (this.mode === 'arcade' || this.mode === 'endless') {
			this.recentResults.push(true);
			if (this.recentResults.length > 10) this.recentResults.shift();
			this.updateDDA();
		}

		// R6: Track endless shots blocked + internal wave progression
		if (this.mode === 'endless') {
			this.endlessShotsBlocked++;
			// R7: Endless 100 achievement
			if (this.endlessShotsBlocked >= 100) this.unlockAchievement(21);
			if (this.endlessShotsBlocked % 10 === 0) {
				this.endlessInternalWave++;
				// Increase difficulty
				const dm = DIFF_MULT[this.difficulty];
				this.shotInterval = Math.max(0.3, 1.5 - this.endlessInternalWave * 0.03) / dm;
				// Recalc speed for future shots
				playSfx('wave');
				if (this.hudDoc) {
					this.setTxt(this.hudDoc, 'status', 'WAVE ' + this.endlessInternalWave);
					this.wavePreviewTimer = 1.5;
				}
				updateMusicTempo(this.endlessInternalWave);
			}
			// Boss every 30 blocked shots
			if (this.endlessShotsBlocked > 0 && this.endlessShotsBlocked % 30 === 0 && !this.bossSpawnedThisWave) {
				this.spawnBossShot();
			}
		}

		// Particles
		if (this.particlesOn) this.spawnSaveParticles(shot.pos, shot.type === 'power' ? 0xff4444 : 0x00ffcc);

		// R6: Arena pulse and shockwave on save
		this.triggerArenaPulse(shot.type === 'power' ? 0xff4444 : 0x00ffcc);
		if (this.particlesOn) this.spawnShockwave(shot.pos, 0x00ffcc);

		// R2: Score popup
		const popColor = isCatch ? '#ffdd00' : '#00ffcc';
		const popText = '+' + earned;
		this.spawnScorePopup(shot.pos, popText, popColor);

		// Haptics
		this.rumble('right', 0.5, 40);
		this.rumble('left', 0.5, 40);

		// Check achievements
		this.unlockAchievement(0); // First Save
		if (this.combo >= 5) this.unlockAchievement(2);
		if (this.combo >= 10) this.unlockAchievement(3);
		if (this.combo >= 20) this.unlockAchievement(4);

		// R6: Combo milestone celebrations (enhanced streak effects)
		this.checkStreakMilestone();
		if (this.totalCatches >= 10) this.unlockAchievement(5);
		if (this.totalCatches >= 50) this.unlockAchievement(6);
		if (shot.type === 'phantom') this.unlockAchievement(15);
		if (shot.type === 'power') {
			this.saveData.powerSaves++;
			if (this.saveData.powerSaves >= 10) this.unlockAchievement(16);
		}
		if (this.score >= 1000) this.unlockAchievement(11);
		if (this.score >= 5000) this.unlockAchievement(12);
		if (this.score >= 10000) this.unlockAchievement(13);
		if (this.score >= 25000) this.unlockAchievement(14);
		// R7: Score 50K
		if (this.score >= 50000) this.unlockAchievement(27);

		// R3: Split saver tracking
		if (shot.splitId > 0) {
			const count = (this.splitSaveTracker.get(shot.splitId) || 0) + 1;
			this.splitSaveTracker.set(shot.splitId, count);
			if (count >= 2) this.unlockAchievement(17); // Split Saver
		}

		this.updateHud();
	}

	onGoal(shot: Shot) {
		shot.alive = false;
		// R6: Clean up split group if present
		if (shot.mesh.userData.splitGroup) {
			this.scene.remove(shot.mesh.userData.splitGroup);
		}
		this.scene.remove(shot.mesh);
		this.scene.remove(shot.trail);

		this.combo = 0;
		this.comboRingFlashTimer = 0.3; // R4: flash red on combo reset
		this.waveGoals++;
		this.totalGoals++;

		// R7: Track per-shot-type goals (both session and career)
		const goalStatKey = shot.isBoss ? 'boss' : shot.type;
		if (!this.gameSessionShotStats[goalStatKey]) this.gameSessionShotStats[goalStatKey] = { saves: 0, goals: 0 };
		this.gameSessionShotStats[goalStatKey].goals++;
		if (this.saveData.shotStats) {
			if (!this.saveData.shotStats[goalStatKey]) this.saveData.shotStats[goalStatKey] = { saves: 0, goals: 0 };
			this.saveData.shotStats[goalStatKey].goals++;
		}
		if (this.mode !== 'training' && this.mode !== 'timeattack') this.lives--;

		playSfx('goal');
		if (this.particlesOn) this.spawnSaveParticles(shot.pos, 0xff4444);

		// R4: DDA tracking (arcade + endless)
		if (this.mode === 'arcade' || this.mode === 'endless') {
			this.recentResults.push(false);
			if (this.recentResults.length > 10) this.recentResults.shift();
			this.updateDDA();
		}

		// R2: Goal flash — turn posts red
		this.goalFlashTimer = 0.5;
		for (const post of this.goalPosts) {
			const m = post.material as MeshStandardMaterial;
			m.color.set(0xff0000);
			m.emissive.set(0xff0000);
			m.emissiveIntensity = 2.0;
		}

		// R2: Camera shake
		this.cameraShakeTimer = 0.3;

		// R3: Trigger net ripple
		this.netRippleActive = true;
		this.netRippleTimer = 0;

		// R2: Goal popup
		this.spawnScorePopup(shot.pos, '-1 LIFE', '#ff4444');

		this.rumble('right', 0.8, 80);
		this.rumble('left', 0.8, 80);

		if (this.lives <= 0 && this.mode !== 'training' && this.mode !== 'timeattack') {
			this.endGame();
		}

		this.updateHud();
	}

	// ── Particles ──
	spawnSaveParticles(pos: Vector3, color: number) {
		for (let i = 0; i < 12; i++) {
			const geo = new SphereGeometry(0.04, 4, 4);
			const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
			const mesh = new Mesh(geo, mat);
			mesh.position.copy(pos);
			this.scene.add(mesh);
			const vel = new Vector3(
				(Math.random() - 0.5) * 4,
				Math.random() * 3,
				(Math.random() - 0.5) * 4,
			);
			this.particles.push({ mesh, vel, life: 0.8 });
		}
	}

	// ── R2: Score popup ──
	spawnScorePopup(pos: Vector3, text: string, color: string) {
		try {
			const tex = makePopupTexture(text, color);
			const geo = new BoxGeometry(0.4, 0.2, 0.001);
			const mat = new MeshBasicMaterial({
				map: tex, transparent: true, opacity: 1.0,
				side: DoubleSide, depthWrite: false,
			});
			const mesh = new Mesh(geo, mat);
			mesh.position.set(pos.x, pos.y + 0.3, pos.z);
			// Face camera (billboard) — look toward player
			mesh.lookAt(0, pos.y + 0.3, 0);
			this.scene.add(mesh);
			const vel = new Vector3(0, 2.0, 0);
			this.scorePopups.push({ mesh, vel, life: 1.5 });
		} catch { /* canvas not available */ }
	}

	// ── Haptics ──
	rumble(hand: 'left' | 'right', intensity = 1, durationMs = 60) {
		const gp = this.w.input?.xr?.gamepads?.[hand]?.gamepad;
		const actuator = gp?.hapticActuators?.[0] as { pulse?: (i: number, ms: number) => void } | undefined;
		actuator?.pulse?.(Math.min(intensity, 1), durationMs);
	}

	// ── Achievements ──
	unlockAchievement(idx: number) {
		if (this.saveData.achievements[idx]) return;
		this.saveData.achievements[idx] = true;
		this.persistSave();
		playSfx('achieve');
		// R5: Achievement unlock flash
		this.triggerFlash(0xffcc00, 0.25, 0.4);
	}

	// ── R4: Power-up system ──
	maybeSpawnPowerUp() {
		if (this.powerUpSpawnedThisWave) return;
		if (this.mode === 'training') return;
		// R6: Endless mode has lower power-up chance (10% vs 15%)
		const spawnChance = this.mode === 'endless' ? 0.10 : 0.15;
		if (Math.random() > spawnChance) return;
		this.powerUpSpawnedThisWave = true;

		const types: PowerUpType[] = ['shield_expand', 'slow_mo', 'double_points', 'magnet'];
		const puType = types[Math.floor(Math.random() * types.length)];

		const colors: Record<PowerUpType, number> = {
			shield_expand: 0x00ffcc, slow_mo: 0x4488ff,
			double_points: 0xffcc00, magnet: 0xff44cc,
		};
		const color = colors[puType];

		const geo = new SphereGeometry(0.15, 12, 8);
		const mat = new MeshStandardMaterial({
			color, emissive: color, emissiveIntensity: 1.5,
			transparent: true, opacity: 0.85,
		});
		const mesh = new Mesh(geo, mat);
		const x = (Math.random() - 0.5) * (GOAL_WIDTH - 1);
		const y = 0.8 + Math.random() * (GOAL_HEIGHT - 1.5);
		const z = -1 - Math.random() * 2;
		mesh.position.set(x, y, z);
		this.scene.add(mesh);

		this.powerUps.push({ mesh, type: puType, pos: new Vector3(x, y, z), alive: true, timer: 8.0 });
	}

	updatePowerUps(dt: number, time: number) {
		// Update active power-up timer
		if (this.activePowerUp) {
			this.powerUpTimer -= dt;
			if (this.powerUpTimer <= 0) {
				this.activePowerUp = null;
				this.powerUpTimer = 0;
				if (this.hudDoc) this.setTxt(this.hudDoc, 'status', ' ');
			} else {
				// Update HUD
				const names: Record<PowerUpType, string> = {
					shield_expand: 'SHIELD', slow_mo: 'SLOW-MO',
					double_points: '2x POINTS', magnet: 'MAGNET',
				};
				if (this.hudDoc && this.wavePreviewTimer <= 0 && this.modifierDisplayTimer <= 0) {
					this.setTxt(this.hudDoc, 'status', names[this.activePowerUp] + ' ' + Math.ceil(this.powerUpTimer) + 's');
				}
			}
		}

		// Update floating orbs
		for (let i = this.powerUps.length - 1; i >= 0; i--) {
			const pu = this.powerUps[i];
			if (!pu.alive) continue;

			pu.timer -= dt;
			if (pu.timer <= 0) {
				pu.alive = false;
				this.scene.remove(pu.mesh);
				continue;
			}

			// Bob up/down and rotate
			pu.mesh.position.y = pu.pos.y + Math.sin(time * 2) * 0.15;
			pu.mesh.rotation.y += dt * 2;

			// Pulse opacity
			const mat = pu.mesh.material as MeshStandardMaterial;
			mat.opacity = 0.6 + Math.sin(time * 4) * 0.25;

			// Check collection by gauntlets
			const distL = pu.mesh.position.distanceTo(this.gauntletPosL);
			const distR = pu.mesh.position.distanceTo(this.gauntletPosR);
			if (distL < 0.4 || distR < 0.4) {
				this.collectPowerUp(pu);
			}
		}

		// Clean dead power-ups
		this.powerUps = this.powerUps.filter(p => p.alive);
	}

	collectPowerUp(pu: PowerUp) {
		pu.alive = false;
		this.scene.remove(pu.mesh);
		this.activePowerUp = pu.type;
		this.powerUpTimer = 10.0;
		playSfx('powerup');

		// R7: Track power-up types collected this game
		this.powerUpsCollectedThisGame.add(pu.type);
		if (this.powerUpsCollectedThisGame.size >= 4) this.unlockAchievement(23);

		// Particles at collection point
		if (this.particlesOn) {
			const colors: Record<PowerUpType, number> = {
				shield_expand: 0x00ffcc, slow_mo: 0x4488ff,
				double_points: 0xffcc00, magnet: 0xff44cc,
			};
			this.spawnSaveParticles(pu.mesh.position, colors[pu.type]);

			// R5: Power-up collect flash
			this.triggerFlash(colors[pu.type], 0.2, 0.3);
		}
	}

	clearPowerUps() {
		for (const pu of this.powerUps) {
			this.scene.remove(pu.mesh);
		}
		this.powerUps = [];
		this.activePowerUp = null;
		this.powerUpTimer = 0;
	}

	// ── R4: Magnet attraction ──
	applyMagnetAttraction(dt: number) {
		if (this.activePowerUp !== 'magnet') return;
		for (const s of this.shots) {
			if (!s.alive) continue;
			// Find nearest gauntlet
			const distL = s.pos.distanceTo(this.gauntletPosL);
			const distR = s.pos.distanceTo(this.gauntletPosR);
			const nearestPos = distL < distR ? this.gauntletPosL : this.gauntletPosR;
			const dist = Math.min(distL, distR);
			if (dist < 1.5 && s.pos.z > -3) {
				// Pull shot toward nearest gauntlet
				const pull = nearestPos.clone().sub(s.pos).normalize().multiplyScalar(dt * 3);
				s.vel.add(pull);
			}
		}
	}

	// ── R4: Wave modifier system ──
	applyWaveModifier() {
		if (this.currentModifier === 'tiny_goal') {
			// Shrink goal by 30%
			const scale = 0.7;
			this.goalGroup.scale.set(scale, scale, 1);
		} else if (this.currentModifier === 'fog_thick') {
			this.scene.fog = new FogExp2(
				(this.scene.fog as FogExp2).color.getHex(),
				0.04, // double density
			);
		}
		// fast_shots, giant_balls, mirror are applied dynamically
	}

	removeWaveModifier() {
		if (this.currentModifier === 'tiny_goal') {
			this.goalGroup.scale.set(1, 1, 1);
		} else if (this.currentModifier === 'fog_thick') {
			this.scene.fog = new FogExp2(
				(this.scene.fog as FogExp2).color.getHex(),
				0.02, // restore
			);
		}
		this.currentModifier = 'normal';
	}

	// ── R4: Dynamic Difficulty Adjustment ──
	updateDDA() {
		if (this.recentResults.length < 10) return;
		const saves = this.recentResults.filter(Boolean).length;
		const rate = saves / this.recentResults.length;

		if (rate > 0.9) {
			this.ddaMultiplier = Math.min(1.3, this.ddaMultiplier + 0.1);
		} else if (rate < 0.4) {
			this.ddaMultiplier = Math.max(0.7, this.ddaMultiplier - 0.1);
		}
	}

	// ── R4: Dive mechanic ──
	updateDive(dt: number) {
		// Only in browser mode
		const rightGrip = this.w.playerSpaceEntities?.gripSpaces?.right?.object3D;
		if (rightGrip) return;

		// Cooldown
		if (this.diveCooldown > 0) {
			this.diveCooldown -= dt;
		}

		const kb = this.w.input.keyboard;

		if (!this.isDiving && this.diveCooldown <= 0) {
			let diveDir = 0;
			if (kb.getKeyDown('Space')) {
				// Dive in current movement direction
				if (kb.getKeyPressed('KeyA') || kb.getKeyPressed('ArrowLeft')) diveDir = -1;
				else if (kb.getKeyPressed('KeyD') || kb.getKeyPressed('ArrowRight')) diveDir = 1;
				else diveDir = 1; // default right
			} else if (kb.getKeyDown('KeyQ')) {
				diveDir = -1;
			} else if (kb.getKeyDown('KeyE')) {
				diveDir = 1;
			}

			if (diveDir !== 0) {
				this.isDiving = true;
				this.diveTimer = 0;
				this.divePhase = 'lunge';
				this.diveOriginL.copy(this.gauntletPosL);
				this.diveOriginR.copy(this.gauntletPosR);
				this.diveTargetL.copy(this.gauntletPosL).add(new Vector3(diveDir * 2, 0, 0));
				this.diveTargetR.copy(this.gauntletPosR).add(new Vector3(diveDir * 2, 0, 0));
				// Clamp targets
				const hw = GOAL_WIDTH / 2 + 1.0;
				this.diveTargetL.x = Math.max(-hw, Math.min(hw, this.diveTargetL.x));
				this.diveTargetR.x = Math.max(-hw, Math.min(hw, this.diveTargetR.x));
				playSfx('dive');

				// Dive trail particles
				if (this.particlesOn) {
					this.spawnSaveParticles(this.gauntletPosL, 0x00ccff);
				}
			}
		}

		if (this.isDiving) {
			this.diveTimer += dt;

			if (this.divePhase === 'lunge') {
				const t = Math.min(1, this.diveTimer / 0.2);
				this.gauntletPosL.lerpVectors(this.diveOriginL, this.diveTargetL, t);
				this.gauntletPosR.lerpVectors(this.diveOriginR, this.diveTargetR, t);
				if (t >= 1) {
					this.divePhase = 'recover';
					this.diveTimer = 0;
				}
			} else {
				const t = Math.min(1, this.diveTimer / 0.5);
				this.gauntletPosL.lerpVectors(this.diveTargetL, this.diveOriginL, t);
				this.gauntletPosR.lerpVectors(this.diveTargetR, this.diveOriginR, t);
				if (t >= 1) {
					this.isDiving = false;
					this.diveCooldown = 1.5;
				}
			}

			this.gauntletL.position.copy(this.gauntletPosL);
			this.gauntletR.position.copy(this.gauntletPosR);
		}
	}

	// ── R4: Combo ring update ──
	updateComboRings(time: number, dt: number) {
		const comboLevel = Math.min(this.combo, 20);
		const ringScale = 0.5 + (comboLevel / 20) * 1.5; // 0.5 to 2.0

		// Color progression: cyan -> green -> yellow -> orange -> red
		let ringColor: Color;
		if (comboLevel < 5) {
			ringColor = new Color(0x00ccff);
		} else if (comboLevel < 10) {
			ringColor = new Color(0x00ccff).lerp(new Color(0x00ff44), (comboLevel - 5) / 5);
		} else if (comboLevel < 15) {
			ringColor = new Color(0x00ff44).lerp(new Color(0xffaa00), (comboLevel - 10) / 5);
		} else {
			ringColor = new Color(0xffaa00).lerp(new Color(0xff2200), (comboLevel - 15) / 5);
		}

		// Flash red when combo resets
		if (this.comboRingFlashTimer > 0) {
			this.comboRingFlashTimer -= dt;
			ringColor = new Color(0xff0000);
		}

		const opacity = comboLevel > 0 ? (0.15 + (comboLevel / 20) * 0.35) : 0.0;

		for (const ring of [this.comboRingL, this.comboRingR]) {
			ring.scale.set(ringScale, 1, ringScale);
			ring.rotation.y += dt * (1 + comboLevel * 0.3);
			const mat = ring.material as MeshBasicMaterial;
			mat.color.copy(ringColor);
			mat.opacity = opacity + Math.sin(time * (3 + comboLevel * 0.5)) * 0.05;
		}
	}

	// ── R5: Grade system ──
	getGrade(): string {
		const total = this.totalSaves + this.totalGoals;
		const saveRate = total > 0 ? this.totalSaves / total : 0;
		const gradeScore = saveRate * 50 + Math.min(this.bestCombo, 20) * 1.5 + Math.min(this.wave, 30);
		if (gradeScore >= 90) return 'S';
		if (gradeScore >= 75) return 'A';
		if (gradeScore >= 60) return 'B';
		if (gradeScore >= 45) return 'C';
		if (gradeScore >= 30) return 'D';
		return 'F';
	}

	getGradeColor(grade: string): string {
		switch (grade) {
			case 'S': return '#ffcc00';
			case 'A': return '#44ff44';
			case 'B': return '#00ccff';
			case 'C': return '#ffdd44';
			case 'D': return '#ff8844';
			case 'F': return '#ff4444';
			default: return '#aaaaaa';
		}
	}

	getGradeTip(): string {
		const total = this.totalSaves + this.totalGoals;
		const saveRate = total > 0 ? this.totalSaves / total : 0;
		if (this.totalCatches < 3) return 'Try holding grip to catch for bonus points!';
		if (saveRate < 0.5) return 'Focus on positioning - stay centered between shots';
		if (this.bestCombo < 5) return 'Build combos by blocking consecutive shots';
		if (this.wave < 5) return 'Watch for phantom shots - they vanish mid-flight!';
		if (saveRate > 0.8 && this.bestCombo > 10) return 'Amazing reflexes! Try Hard difficulty';
		return 'Use Q/E to dive for hard-to-reach shots!';
	}

	// ── R5: Gauntlet color ──
	applyGauntletColor() {
		const hex = this.gauntletColorMap[this.gauntletColor] || 0x00ccff;
		(this.gauntletL.material as MeshStandardMaterial).color.set(hex);
		(this.gauntletL.material as MeshStandardMaterial).emissive.set(hex);
		(this.gauntletR.material as MeshStandardMaterial).color.set(hex);
		(this.gauntletR.material as MeshStandardMaterial).emissive.set(hex);

		// Update shield discs
		(this.shieldL.material as MeshBasicMaterial).color.set(hex);
		(this.shieldR.material as MeshBasicMaterial).color.set(hex);

		// Update gauntlet rings
		for (const g of [this.gauntletL, this.gauntletR]) {
			for (const child of g.children) {
				if (child instanceof Mesh && child !== this.shieldL && child !== this.shieldR
					&& child !== this.comboRingL && child !== this.comboRingR) {
					const m = child.material as MeshBasicMaterial;
					if (m.color) m.color.set(hex);
				}
			}
		}
	}

	// ── R5: Boss shot spawning ──
	spawnBossShot() {
		const dm = DIFF_MULT[this.difficulty];
		const speed = 5 * dm;
		const radius = 0.5;
		const color = 0xff4400;

		const targetX = (Math.random() - 0.5) * (GOAL_WIDTH - 1);
		const targetY = 0.5 + Math.random() * (GOAL_HEIGHT - 1);
		const target = new Vector3(targetX, targetY, GOAL_Z);

		const pos = new Vector3(0, 2, SPAWN_Z);
		const dir = target.clone().sub(pos).normalize();
		const vel = dir.multiplyScalar(speed);

		// R6: Boss uses faceted crystalline shape
		const geo = new SphereGeometry(radius, 6, 4);
		const mat = new MeshStandardMaterial({
			color, emissive: color, emissiveIntensity: 2.0,
			transparent: true, opacity: 0.95,
		});
		const mesh = new Mesh(geo, mat);
		mesh.position.copy(pos);
		// Add wireframe overlay for crystal effect
		const edgesGeo = new EdgesGeometry(geo);
		const edgeMat = new LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
		mesh.add(new LineSegments(edgesGeo, edgeMat));
		this.scene.add(mesh);

		// Bigger trail for boss
		const trail = new Group();
		for (let i = 0; i < 8; i++) {
			const tGeo = new SphereGeometry(radius * (1 - i * 0.1), 8, 6);
			const tMat = new MeshBasicMaterial({
				color: 0xff6600, transparent: true, opacity: 0.35 - i * 0.04,
			});
			trail.add(new Mesh(tGeo, tMat));
		}
		this.scene.add(trail);

		this.shots.push({
			mesh, trail, type: 'standard', pos: pos.clone(), vel: vel.clone(),
			target, speed, alive: true, blocked: false,
			splitDone: true, phantomTimer: 0, visible: true,
			curvePhase: 0, curveAmplitude: 0, spawnZ: pos.z,
			splitId: 0, approachSoundPlayed: false,
			hitsRemaining: 3, isBoss: true,
		});

		this.bossSpawnedThisWave = true;
		playSfx('launch');
	}

	// ── R5: Warning arrows ──
	updateWarningArrows() {
		// Only in easy/normal, not training
		if (this.difficulty === 'hard' || this.mode === 'training') {
			this.clearWarningArrows();
			return;
		}

		// Remove arrows for dead/blocked shots
		for (let i = this.warningArrows.length - 1; i >= 0; i--) {
			const wa = this.warningArrows[i];
			if (!wa.shotRef.alive || wa.shotRef.blocked || wa.shotRef.pos.z > -5) {
				this.scene.remove(wa.mesh);
				this.warningArrows.splice(i, 1);
			}
		}

		// Create/update arrows for active shots beyond z=-10
		for (const s of this.shots) {
			if (!s.alive || s.blocked || s.pos.z > -5) continue;
			if (s.pos.z > -10) continue; // too close for warning

			// Check if arrow exists for this shot
			const existing = this.warningArrows.find(wa => wa.shotRef === s);
			if (existing) {
				// Update position and scale
				existing.mesh.position.set(s.target.x, s.target.y, GOAL_Z - 0.1);
				const progress = Math.max(0, Math.min(1, (s.pos.z - SPAWN_Z) / (-5 - SPAWN_Z)));
				const arrowScale = 0.3 + progress * 0.7;
				existing.mesh.scale.set(arrowScale, arrowScale, arrowScale);
				// Pulse opacity
				const mat = existing.mesh.material as MeshBasicMaterial;
				mat.opacity = 0.2 + Math.sin(performance.now() * 0.005) * 0.15;
			} else {
				// Create new arrow
				let arrowColor = 0x00ffcc;
				if (s.type === 'curve') arrowColor = 0xffaa00;
				else if (s.type === 'power') arrowColor = 0xff4444;
				else if (s.type === 'split') arrowColor = 0xcc44ff;
				else if (s.type === 'phantom') arrowColor = 0x44ccff;
				if (s.isBoss) arrowColor = 0xff4400;

				// Triangle geometry (3 vertices)
				const verts = new Float32Array([
					0, 0.12, 0,
					-0.08, -0.06, 0,
					0.08, -0.06, 0,
				]);
				const geo = new BufferGeometry();
				geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
				geo.computeVertexNormals();
				const mat = new MeshBasicMaterial({
					color: arrowColor, transparent: true, opacity: 0.3,
					side: DoubleSide, depthWrite: false,
				});
				const mesh = new Mesh(geo, mat);
				mesh.position.set(s.target.x, s.target.y, GOAL_Z - 0.1);
				mesh.scale.set(0.3, 0.3, 0.3);
				this.scene.add(mesh);
				this.warningArrows.push({ mesh, shotRef: s });
			}
		}
	}

	clearWarningArrows() {
		for (const wa of this.warningArrows) {
			this.scene.remove(wa.mesh);
		}
		this.warningArrows = [];
	}

	// ── R6: Arena reactivity ──
	updateArenaReactivity(dt: number, time: number) {
		// Floor grid color shifts based on combo level
		const comboLevel = Math.min(this.combo, 20);
		let gridColor: Color;
		if (comboLevel < 3) {
			gridColor = new Color(0x003344);
		} else if (comboLevel < 8) {
			gridColor = new Color(0x003344).lerp(new Color(0x004466), (comboLevel - 3) / 5);
		} else if (comboLevel < 15) {
			gridColor = new Color(0x004466).lerp(new Color(0x006644), (comboLevel - 8) / 7);
		} else {
			gridColor = new Color(0x006644).lerp(new Color(0x664400), (comboLevel - 15) / 5);
		}
		// Pulse effect
		const pulse = 1.0 + Math.sin(time * (2 + comboLevel * 0.3)) * 0.15;
		const gridOpacity = (0.25 + comboLevel * 0.02) * pulse;
		this.floorGridMat.color.copy(gridColor);
		this.floorGridMat.opacity = Math.min(0.6, gridOpacity);

		// Arena pulse from saves (decay)
		if (this.arenaPulseTimer > 0) {
			this.arenaPulseTimer -= dt;
			const t = Math.max(0, this.arenaPulseTimer / 0.4);
			const pulseColor = new Color(this.arenaPulseColor);
			const baseColor = new Color(0x003344);
			this.floorGridMat.color.copy(baseColor).lerp(pulseColor, t * 0.5);
			this.floorGridMat.opacity = Math.min(0.7, gridOpacity + t * 0.2);
		}
	}

	triggerArenaPulse(color: number) {
		this.arenaPulseTimer = 0.4;
		this.arenaPulseColor = color;
	}

	// ── R6: Save shockwave ring ──
	spawnShockwave(pos: Vector3, color: number) {
		const segments = 32;
		const verts: number[] = [];
		for (let i = 0; i < segments; i++) {
			const a0 = (i / segments) * Math.PI * 2;
			const a1 = ((i + 1) / segments) * Math.PI * 2;
			verts.push(Math.cos(a0) * 0.1, 0, Math.sin(a0) * 0.1);
			verts.push(Math.cos(a1) * 0.1, 0, Math.sin(a1) * 0.1);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
		const mat = new LineBasicMaterial({
			color, transparent: true, opacity: 0.6,
		});
		const mesh = new LineSegments(geo, mat);
		mesh.position.set(pos.x, 0.05, pos.z);
		this.scene.add(mesh);
		this.shockwaves.push({ mesh, life: 0.8, maxLife: 0.8 });
	}

	updateShockwaves(dt: number) {
		for (let i = this.shockwaves.length - 1; i >= 0; i--) {
			const sw = this.shockwaves[i];
			sw.life -= dt;
			if (sw.life <= 0) {
				this.scene.remove(sw.mesh);
				this.shockwaves.splice(i, 1);
				continue;
			}
			const progress = 1 - sw.life / sw.maxLife;
			const scale = 1 + progress * 8; // expand from 0.1 radius to ~0.9
			sw.mesh.scale.set(scale, 1, scale);
			const mat = sw.mesh.material as LineBasicMaterial;
			mat.opacity = 0.6 * (sw.life / sw.maxLife);
		}
	}

	// ── R6: Wave countdown ──
	startCountdown() {
		this.countdownActive = true;
		this.countdownTimer = 2.0; // 2 second countdown (3-2-1 compressed)
		if (this.hudDoc) {
			this.setTxt(this.hudDoc, 'status', 'GET READY...');
		}
	}

	updateCountdown(dt: number) {
		if (!this.countdownActive) return;
		this.countdownTimer -= dt;
		if (this.countdownTimer <= 0) {
			this.countdownActive = false;
			this.countdownTimer = 0;
			this.waveActive = true; // R6: now shots can spawn
			if (this.hudDoc) this.setTxt(this.hudDoc, 'status', 'GO!');
			this.wavePreviewTimer = 0.5;
			return;
		}
		// Show countdown number
		const num = Math.ceil(this.countdownTimer);
		if (this.hudDoc) {
			this.setTxt(this.hudDoc, 'status', String(num));
		}
	}

	// ── Update ──
	update(delta: number, _time: number) {
		// R2: Orbit spheres animate even when not playing (ambient decoration)
		this.updateOrbitSpheres(_time);

		// R2: Ambient motes drift always
		this.updateAmbientMotes(Math.min(delta, 0.05));

		// R8: Update demo shots on menu
		if (this.state === 'menu') {
			this.updateDemoShots(Math.min(delta, 0.05));
		}

		// R9: Achievement banner always updates (even outside playing state)
		this.updateAchvBanner(Math.min(delta, 0.05));

		// R9: Atmosphere particles always drift
		this.updateAtmosParticles(Math.min(delta, 0.05));

		if (this.state !== 'playing') return;

		// R9: Apply post-goal slowdown multiplier
		let dt = Math.min(delta, 0.05); // cap
		if (this.goalSlowdownActive) {
			this.goalSlowdownTimer -= Math.min(delta, 0.05);
			if (this.goalSlowdownTimer <= 0) {
				this.goalSlowdownActive = false;
				this.goalSlowdownTimer = 0;
			} else {
				dt *= 0.3; // slow everything to 30% speed
			}
		}

		// R9: Session elapsed tracker
		this.sessionElapsed += dt;

		// R2: Wave preview countdown
		if (this.wavePreviewTimer > 0) {
			this.wavePreviewTimer -= dt;
			if (this.wavePreviewTimer <= 0) {
				this.wavePreviewTimer = 0;
				if (this.hudDoc) this.setTxt(this.hudDoc, 'status', ' ');
			}
		}

		// R2: Goal flash fade
		if (this.goalFlashTimer > 0) {
			this.goalFlashTimer -= dt;
			const t = Math.max(0, this.goalFlashTimer / 0.5);
			for (const post of this.goalPosts) {
				const m = post.material as MeshStandardMaterial;
				// Lerp from red back to cyan
				const r = t * 1.0;
				const g = (1 - t) * 1.0;
				const b = (1 - t) * 0.8;
				m.color.setRGB(r, g, b);
				m.emissive.setRGB(r, g, b);
				m.emissiveIntensity = 0.8 + t * 1.2;
			}
		}

		// R2: Camera shake
		if (this.cameraShakeTimer > 0) {
			this.cameraShakeTimer -= dt;
			const cam = this.w.camera;
			if (cam) {
				const intensity = this.cameraShakeTimer / 0.3 * 0.05;
				cam.position.x = (Math.random() - 0.5) * intensity * 2;
				cam.position.y = 1.7 + (Math.random() - 0.5) * intensity * 2;
				if (this.cameraShakeTimer <= 0) {
					cam.position.x = 0;
					cam.position.y = 1.7;
				}
			}
		}

		// R2: Gauntlet shield combo scaling
		this.updateShields(_time);

		// R4: Combo visual rings
		this.updateComboRings(_time, dt);

		// R5: Screen flash fade
		if (this.flashTimer > 0) {
			this.flashTimer -= dt;
			const fmat = this.flashMesh.material as MeshBasicMaterial;
			if (this.flashTimer <= 0) {
				fmat.opacity = 0;
				this.flashMesh.visible = false;
				this.flashTimer = 0;
			} else {
				fmat.opacity = fmat.opacity * (this.flashTimer / (this.flashTimer + dt));
			}
		}

		// R5: Warning arrows
		this.updateWarningArrows();

		// R6: Arena reactivity
		this.updateArenaReactivity(dt, _time);

		// R6: Shockwaves
		this.updateShockwaves(dt);

		// R9: Near-miss sparks update
		this.updateNearMissSparks(dt);

		// R9: Spawn atmosphere particles periodically
		this.maybeSpawnAtmosParticle();

		// R8: Countdown ring for Time Attack
		this.updateCountdownRing(_time);

		// R7: Training paths
		if (this.mode === 'training') this.updateTrainingPaths();

		// R7: Goal decoration animation
		this.updateGoalDecoration(_time);

		// R6: Countdown
		this.updateCountdown(dt);

		// R4: Modifier display timer
		if (this.modifierDisplayTimer > 0) {
			this.modifierDisplayTimer -= dt;
			if (this.modifierDisplayTimer <= 0) {
				this.modifierDisplayTimer = 0;
				if (this.hudDoc && this.wavePreviewTimer <= 0 && !this.activePowerUp) {
					this.setTxt(this.hudDoc, 'status', ' ');
				}
			}
		}

		// R4: Power-up system
		this.updatePowerUps(dt, _time);
		// Maybe spawn a power-up during this wave (not in daily — no power-ups)
		if (this.waveActive && !this.powerUpSpawnedThisWave && this.waveShotsLaunched >= 2 && this.mode !== 'daily') {
			this.maybeSpawnPowerUp();
		}

		// R4: Magnet attraction
		this.applyMagnetAttraction(dt);

		// Time attack countdown
		if (this.mode === 'timeattack') {
			this.timeLeft -= dt;
			if (this.timeLeft <= 0) {
				this.timeLeft = 0;
				if (this.totalSaves >= 50) this.unlockAchievement(19);
				this.endGame();
				return;
			}
			this.updateHud();
		}

		// Browser mode: move gauntlets with mouse
		this.updateBrowserGauntlets();

		// R4: Dive mechanic
		this.updateDive(dt);

		// XR mode: update gauntlet visuals to match controllers
		this.updateXRGauntlets();

		// Shot spawning
		this.shotTimer -= dt;
		if (this.shotTimer <= 0 && this.waveActive) {
			// R5: Boss wave — spawn boss first on every 5th wave (arcade), or wave 5 in daily
			const isBossWave = (this.mode === 'arcade' && this.wave % 5 === 0 && this.wave > 0)
				|| (this.mode === 'daily' && this.wave === 5);
			if (isBossWave && !this.bossSpawnedThisWave && this.waveShotsLaunched === 0) {
				this.spawnBossShot();
				this.shotTimer = this.shotInterval * 2; // extra delay after boss
			} else if (this.mode === 'timeattack' || this.mode === 'endless' || this.waveShotsLaunched < this.waveShots) {
				// R6: Endless mode applies progressive speed multiplier
				if (this.mode === 'endless') {
					const speedMult = Math.min(2.5, 1.0 + this.endlessInternalWave * 0.05);
					// speedMult applied per-shot in spawnShot
				}
				this.spawnShot();
				this.shotTimer = this.shotInterval;
			}
		}

		// Update shots
		for (let i = this.shots.length - 1; i >= 0; i--) {
			const s = this.shots[i];
			if (!s.alive) continue;

			// Move
			s.pos.x += s.vel.x * dt;
			s.pos.y += s.vel.y * dt;
			s.pos.z += s.vel.z * dt;

			// Gravity
			const gravMult = this.currentModifier === 'low_gravity' ? 0.2 : 1.0;
			s.vel.y -= 1.5 * dt * gravMult;

			// R7: Speed ramp — shots accelerate as they approach
			if (this.currentModifier === 'speed_ramp') {
				const totalDist = Math.abs(s.spawnZ - GOAL_Z);
				const traveled = Math.abs(s.pos.z - s.spawnZ);
				const progress = Math.min(1, totalDist > 0 ? traveled / totalDist : 0);
				const rampMult = 1 + progress * 1.5;
				s.vel.x *= (1 + (rampMult - 1) * dt * 0.5);
				s.vel.z *= (1 + (rampMult - 1) * dt * 0.5);
			}

			// Curve behavior
			if (s.type === 'curve') {
				s.curvePhase += dt * 3;
				const lateralOffset = Math.sin(s.curvePhase) * s.curveAmplitude * dt;
				s.pos.x += lateralOffset;
			}

			// Split behavior
			if (s.type === 'split' && !s.splitDone && s.pos.z > -8) {
				s.splitDone = true;
				s.alive = false;
				this.scene.remove(s.mesh);
				this.scene.remove(s.trail);
				this.spawnSplitChildren(s);
				continue;
			}

			// Phantom behavior
			if (s.type === 'phantom') {
				const pz = s.pos.z;
				if (pz > -10 && pz < -4) {
					if (s.visible) {
						s.visible = false;
						s.mesh.visible = false;
						s.trail.visible = false;
						playSfx('phantom');
					}
				} else {
					if (!s.visible) {
						s.visible = true;
						s.mesh.visible = true;
						s.trail.visible = true;
					}
				}
			}

			// Update mesh position
			s.mesh.position.copy(s.pos);
			// R6: Sync split group position if present
			if (s.mesh.userData.splitGroup) {
				s.mesh.userData.splitGroup.position.copy(s.pos);
				s.mesh.userData.splitGroup.rotation.y += dt * 3;
			}
			// R6: Boss shot slow rotation
			if (s.isBoss) {
				s.mesh.rotation.x += dt * 1.5;
				s.mesh.rotation.y += dt * 2;
			}
			// R6: Power cube rotation
			if (s.type === 'power' && !s.isBoss) {
				s.mesh.rotation.x += dt * 4;
				s.mesh.rotation.y += dt * 3;
			}
			// R6: Multi disc rotation (face forward spin)
			if (s.type === 'multi' || (s.type === 'standard' && !s.isBoss && !s.splitDone)) {
				// Only rotate multi-shot disc meshes
			}
			// R6: Curve shot wobble rotation
			if (s.type === 'curve') {
				s.mesh.rotation.z += dt * 5;
			}

			// R3: Approach sounds — play when shot crosses z=-5
			if (!s.approachSoundPlayed && s.pos.z > -5 && s.alive) {
				s.approachSoundPlayed = true;
				playApproachSfx(s.type);
			}

			// R5: Boss shot re-approach after bounce
			if (s.isBoss && s.vel.z < 0 && s.pos.z < -3) {
				// Boss was bounced back, re-target the goal
				const retarget = new Vector3(
					(Math.random() - 0.5) * (GOAL_WIDTH - 1),
					0.5 + Math.random() * (GOAL_HEIGHT - 1),
					GOAL_Z,
				);
				const dir = retarget.clone().sub(s.pos).normalize();
				s.vel.copy(dir.multiplyScalar(s.speed));
				s.target.copy(retarget);
			}

			// Update trail
			const trailChildren = s.trail.children as Mesh[];
			for (let t = 0; t < trailChildren.length; t++) {
				const tc = trailChildren[t];
				const trailDt = (t + 1) * 2;
				tc.position.set(
					s.pos.x - s.vel.x * dt * trailDt,
					s.pos.y - s.vel.y * dt * trailDt,
					s.pos.z - s.vel.z * dt * trailDt,
				);
				// R6: Curve trail spiral offset
				if (s.type === 'curve' && t < 5) {
					const spiralAngle = _time * 8 + t * 1.2;
					tc.position.x += Math.sin(spiralAngle) * 0.08 * (t + 1);
					tc.position.y += Math.cos(spiralAngle) * 0.08 * (t + 1);
				}
				// R6: Phantom trail flicker
				if (s.type === 'phantom' && !s.visible) {
					const fMat = tc.material as MeshBasicMaterial;
					fMat.opacity = Math.random() * 0.1;
				}
			}

			// Check collision with gloves
			const { blocked, isCatch } = this.checkBlock(s);
			if (blocked) {
				this.onSave(s, isCatch);
				continue;
			}

			// Check if crossed goal line
			if (s.pos.z >= GOAL_Z) {
				// Check if within goal area
				if (Math.abs(s.pos.x) <= GOAL_WIDTH / 2 && s.pos.y >= 0 && s.pos.y <= GOAL_HEIGHT) {
					this.onGoal(s);
				} else {
					// Missed the goal — wide/high
					s.alive = false;
					if (s.mesh.userData.splitGroup) this.scene.remove(s.mesh.userData.splitGroup);
					this.scene.remove(s.mesh);
					this.scene.remove(s.trail);
				}
				continue;
			}

			// Out of bounds
			if (s.pos.y < -2 || s.pos.z > 5) {
				s.alive = false;
				if (s.mesh.userData.splitGroup) this.scene.remove(s.mesh.userData.splitGroup);
				this.scene.remove(s.mesh);
				this.scene.remove(s.trail);
			}
		}

		// Clean dead shots
		this.shots = this.shots.filter(s => s.alive);

		// Check wave end (endless mode never ends waves, daily uses wave count)
		if (this.mode !== 'timeattack' && this.mode !== 'endless' && this.waveActive &&
			this.waveShotsLaunched >= this.waveShots && this.shots.length === 0) {
			// Wave achievements
			if (this.wave >= 5) this.unlockAchievement(7);
			if (this.wave >= 10) this.unlockAchievement(8);
			if (this.wave >= 15) this.unlockAchievement(9);
			if (this.wave >= 25) this.unlockAchievement(10);
			this.endWave();
		}

		// Update burst particles
		for (let i = this.particles.length - 1; i >= 0; i--) {
			const p = this.particles[i];
			p.life -= dt;
			if (p.life <= 0) {
				this.scene.remove(p.mesh);
				this.particles.splice(i, 1);
				continue;
			}
			p.mesh.position.x += p.vel.x * dt;
			p.mesh.position.y += p.vel.y * dt;
			p.vel.y -= 5 * dt;
			p.mesh.position.z += p.vel.z * dt;
			const mat = p.mesh.material as MeshBasicMaterial;
			mat.opacity = p.life;
		}

		// R2: Update score popups
		for (let i = this.scorePopups.length - 1; i >= 0; i--) {
			const p = this.scorePopups[i];
			p.life -= dt;
			if (p.life <= 0) {
				this.scene.remove(p.mesh);
				this.scorePopups.splice(i, 1);
				continue;
			}
			p.mesh.position.y += p.vel.y * dt;
			const mat = p.mesh.material as MeshBasicMaterial;
			mat.opacity = Math.min(1, p.life / 0.5); // fade out in last 0.5s
		}

		// R3: Net ripple animation
		if (this.netRippleActive) {
			this.netRippleTimer += dt;
			if (this.netRippleTimer >= 0.5) {
				// Restore original positions
				this.netRippleActive = false;
				this.restoreNetPositions();
			} else {
				this.animateNetRipple();
			}
		}

		// Gauntlet glow pulse
		const pulse = 0.6 + Math.sin(_time * 4) * 0.2;
		(this.gauntletL.material as MeshStandardMaterial).emissiveIntensity = pulse;
		(this.gauntletR.material as MeshStandardMaterial).emissiveIntensity = pulse;

		// R6: Power shot visual pulse (glow bigger when close)
		for (const s of this.shots) {
			if (!s.alive || s.type !== 'power') continue;
			const mat = s.mesh.material as MeshStandardMaterial;
			const proximity = Math.max(0, 1 - Math.abs(s.pos.z - GOAL_Z) / 15);
			mat.emissiveIntensity = 1.0 + proximity * 1.5 + Math.sin(_time * 10) * 0.3;
			const scale = 1.0 + proximity * 0.3;
			s.mesh.scale.set(scale, scale, scale);
		}
	}

	// ── R2: Orbit spheres animation ──
	updateOrbitSpheres(time: number) {
		for (const orb of this.orbitSpheres) {
			orb.angle += orb.speed * 0.016;
			const x = Math.cos(orb.angle) * orb.radius;
			const z = Math.sin(orb.angle) * orb.radius - 12;
			const y = orb.height + Math.sin(time * 0.5 + orb.angle) * 0.3;
			orb.mesh.position.set(x, y, z);
			orb.light.position.set(x, y, z);
		}
	}

	// ── R2: Ambient motes drift ──
	updateAmbientMotes(dt: number) {
		for (const m of this.ambientMotes) {
			m.mesh.position.x += m.vel.x * dt;
			m.mesh.position.y += m.vel.y * dt;
			m.mesh.position.z += m.vel.z * dt;

			// Wrap bounds
			if (m.mesh.position.x > 7) m.mesh.position.x = -7;
			if (m.mesh.position.x < -7) m.mesh.position.x = 7;
			if (m.mesh.position.y > 6) m.mesh.position.y = 0.5;
			if (m.mesh.position.y < 0.3) m.mesh.position.y = 5.5;
			if (m.mesh.position.z > 2) m.mesh.position.z = -24;
			if (m.mesh.position.z < -25) m.mesh.position.z = 1;
		}
	}

	// ── R2: Shield combo scaling ──
	updateShields(time: number) {
		const comboLevel = Math.min(this.combo, 15);
		const shieldScale = 1.0 + comboLevel * 0.1; // scale 1.0 to 2.5
		const maxScale = 2.5;
		const s = Math.min(shieldScale, maxScale);

		this.shieldL.scale.set(s, 1, s);
		this.shieldR.scale.set(s, 1, s);

		// Color shift: cyan -> gold -> white
		const matL = this.shieldL.material as MeshBasicMaterial;
		const matR = this.shieldR.material as MeshBasicMaterial;

		let shieldColor: Color;
		if (comboLevel < 5) {
			shieldColor = new Color(0x00ccff); // cyan
		} else if (comboLevel < 10) {
			const t = (comboLevel - 5) / 5;
			shieldColor = new Color(0x00ccff).lerp(new Color(0xffdd00), t);
		} else {
			const t = (comboLevel - 10) / 5;
			shieldColor = new Color(0xffdd00).lerp(new Color(0xffffff), t);
		}
		matL.color.copy(shieldColor);
		matR.color.copy(shieldColor);

		// Opacity pulses faster at higher combo
		const pulseSpeed = 3 + comboLevel * 0.5;
		const baseOpacity = 0.1 + comboLevel * 0.02;
		const pulseAmount = 0.08 + comboLevel * 0.01;
		const opacity = baseOpacity + Math.sin(time * pulseSpeed) * pulseAmount;
		matL.opacity = Math.min(0.5, opacity);
		matR.opacity = Math.min(0.5, opacity);
	}

	// ── R3: Per-mode environment themes ──
	applyModeTheme(mode: GameMode) {
		// Fog + ambient + accent lights per mode
		if (mode === 'challenge') {
			this.scene.fog = new FogExp2(0x110800, 0.02);
			this.scene.background = new Color(0x110800);
			this.ambientLight.color.set(0x332211);
			const challengeColors = [0xff6600, 0xff4400, 0xff8800, 0xff2200, 0xcc4400];
			for (let i = 0; i < this.accentLights.length; i++) {
				this.accentLights[i].color.set(challengeColors[i] || 0xff4400);
			}
			this.applyGoalDecorationTheme(0xff6600);
		} else if (mode === 'training') {
			this.scene.fog = new FogExp2(0x001108, 0.02);
			this.scene.background = new Color(0x001108);
			this.ambientLight.color.set(0x113322);
			const trainColors = [0x00ff88, 0x00cc66, 0x22ffaa, 0x44ff88, 0x00ffaa];
			for (let i = 0; i < this.accentLights.length; i++) {
				this.accentLights[i].color.set(trainColors[i] || 0x00ff88);
			}
			this.applyGoalDecorationTheme(0x00ff88);
		} else if (mode === 'timeattack') {
			this.scene.fog = new FogExp2(0x080011, 0.02);
			this.scene.background = new Color(0x080011);
			this.ambientLight.color.set(0x221133);
			const taColors = [0xcc44ff, 0xff44cc, 0xaa22ff, 0xff66dd, 0xdd44ff];
			for (let i = 0; i < this.accentLights.length; i++) {
				this.accentLights[i].color.set(taColors[i] || 0xcc44ff);
			}
			this.applyGoalDecorationTheme(0xcc44ff);
		} else if (mode === 'endless') {
			// Endless — fiery orange-red
			this.scene.fog = new FogExp2(0x110500, 0.02);
			this.scene.background = new Color(0x110500);
			this.ambientLight.color.set(0x331100);
			const endColors = [0xff6600, 0xff4400, 0xff8800, 0xff2200, 0xcc4400];
			for (let i = 0; i < this.accentLights.length; i++) {
				this.accentLights[i].color.set(endColors[i] || 0xff6600);
			}
			this.applyGoalDecorationTheme(0xff6600);
		} else if (mode === 'daily') {
			// R8: Daily — golden/amber
			this.scene.fog = new FogExp2(0x110a00, 0.02);
			this.scene.background = new Color(0x110a00);
			this.ambientLight.color.set(0x332200);
			const dailyColors = [0xff8800, 0xffaa00, 0xffcc00, 0xff6600, 0xffbb00];
			for (let i = 0; i < this.accentLights.length; i++) {
				this.accentLights[i].color.set(dailyColors[i] || 0xff8800);
			}
			this.applyGoalDecorationTheme(0xff8800);
		} else {
			// Arcade — default
			this.scene.fog = new FogExp2(0x000811, 0.02);
			this.scene.background = new Color(0x000811);
			this.ambientLight.color.set(0x112233);
			for (let i = 0; i < this.accentLights.length; i++) {
				this.accentLights[i].color.set(this.originalAccentColors[i] || 0x00ffcc);
			}
			this.applyGoalDecorationTheme(0x00ffcc);
		}
	}

	// ── R3: Challenge mode scripted formations ──
	buildChallengeQueue(level: number) {
		this.challengeQueue = [];
		switch (level) {
			case 1: // Easy warm-up: 5 standards
				this.challengeQueue = ['standard', 'standard', 'standard', 'standard', 'standard'];
				break;
			case 2: // Introduce curves
				this.challengeQueue = ['standard', 'standard', 'standard', 'curve', 'curve'];
				break;
			case 3: // Power mixed with standards
				this.challengeQueue = ['standard', 'power', 'standard', 'power', 'standard'];
				break;
			case 4: // Curve barrage
				this.challengeQueue = ['curve', 'curve', 'curve', 'curve'];
				break;
			case 5: // Split intro (2 splits = 4 sub-shots)
				this.challengeQueue = ['standard', 'split', 'standard', 'split'];
				break;
			case 6: // Phantom mixed in
				this.challengeQueue = ['standard', 'standard', 'phantom', 'standard', 'standard'];
				break;
			case 7: // Power wall — 3 powers close together
				this.challengeQueue = ['power', 'power', 'power', 'standard', 'standard'];
				break;
			case 8: // Mixed everything
				this.challengeQueue = ['standard', 'curve', 'power', 'split', 'standard', 'curve', 'power', 'split'];
				break;
			case 9: // Phantoms + multi
				this.challengeQueue = ['phantom', 'phantom', 'multi', 'standard', 'standard'];
				break;
			case 10: // Boss wave — everything, fast
				this.challengeQueue = [
					'standard', 'curve', 'power', 'split', 'phantom',
					'multi', 'standard', 'curve', 'power', 'split',
					'phantom', 'multi', 'standard', 'power', 'standard',
				];
				break;
			default:
				this.challengeQueue = ['standard', 'standard', 'standard', 'standard', 'standard'];
		}
	}

	// ── R3: Net ripple helpers ──
	animateNetRipple() {
		if (!this.goalNet || !this.goalNetOrigZ) return;
		const posAttr = this.goalNet.geometry.getAttribute('position');
		const decay = 1 - this.netRippleTimer / 0.5;
		for (let i = 0; i < posAttr.count; i++) {
			const y = (posAttr as any).getY(i);
			const origZ = this.goalNetOrigZ[i];
			const offset = Math.sin(y * 4) * 0.3 * decay;
			(posAttr as any).setZ(i, origZ + offset);
		}
		(posAttr as any).needsUpdate = true;
	}

	restoreNetPositions() {
		if (!this.goalNet || !this.goalNetOrigZ) return;
		const posAttr = this.goalNet.geometry.getAttribute('position');
		for (let i = 0; i < posAttr.count; i++) {
			(posAttr as any).setZ(i, this.goalNetOrigZ[i]);
		}
		(posAttr as any).needsUpdate = true;
	}

	updateBrowserGauntlets() {
		// In browser mode (no XR grip), move gauntlets with mouse + keyboard
		const rightGrip = this.w.playerSpaceEntities?.gripSpaces?.right?.object3D;
		if (rightGrip) return; // XR mode, handled separately

		// R6: Add mouse listener once
		if (!this.mouseListenerAdded && this.mouseAimEnabled) {
			const canvas = this.w.renderer.domElement;
			if (canvas) {
				canvas.addEventListener('mousemove', (ev: MouseEvent) => {
					const rect = canvas.getBoundingClientRect();
					this.mouseNormX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
					this.mouseNormY = 1 - ((ev.clientY - rect.top) / rect.height);
				});
				this.mouseListenerAdded = true;
			}
		}

		// Keyboard controls
		const kb = this.w.input.keyboard;
		const moveSpeed = 3;

		// R4: Mirror modifier inverts left/right
		const mirrorMult = this.currentModifier === 'mirror' ? -1 : 1;

		// R6: Mouse-aim — blend mouse position with keyboard for gauntlet position
		if (this.mouseAimEnabled && this.state === 'playing') {
			const hw = GOAL_WIDTH / 2 + 0.5;
			const targetX = this.mouseNormX * (hw + 0.5);
			const targetY = 0.2 + this.mouseNormY * (GOAL_HEIGHT + 0.3);

			// Smooth interpolation toward mouse position
			const lerp = 0.12;
			const centerX = (this.gauntletPosL.x + this.gauntletPosR.x) / 2;
			const newCenterX = centerX + (targetX - centerX) * lerp;
			const newY = this.gauntletPosL.y + (targetY - this.gauntletPosL.y) * lerp;

			this.gauntletPosL.x = newCenterX - 0.3;
			this.gauntletPosR.x = newCenterX + 0.3;
			this.gauntletPosL.y = newY;
			this.gauntletPosR.y = newY;
		}

		// Keyboard overrides
		if (kb.getKeyPressed('KeyA') || kb.getKeyPressed('ArrowLeft')) {
			this.gauntletPosL.x -= moveSpeed * 0.016 * mirrorMult;
			this.gauntletPosR.x -= moveSpeed * 0.016 * mirrorMult;
		}
		if (kb.getKeyPressed('KeyD') || kb.getKeyPressed('ArrowRight')) {
			this.gauntletPosL.x += moveSpeed * 0.016 * mirrorMult;
			this.gauntletPosR.x += moveSpeed * 0.016 * mirrorMult;
		}
		if (kb.getKeyPressed('KeyW') || kb.getKeyPressed('ArrowUp')) {
			this.gauntletPosL.y += moveSpeed * 0.016;
			this.gauntletPosR.y += moveSpeed * 0.016;
		}
		if (kb.getKeyPressed('KeyS') || kb.getKeyPressed('ArrowDown')) {
			this.gauntletPosL.y -= moveSpeed * 0.016;
			this.gauntletPosR.y -= moveSpeed * 0.016;
		}

		// Clamp
		const hw = GOAL_WIDTH / 2 + 0.5;
		this.gauntletPosL.x = Math.max(-hw, Math.min(hw - 0.6, this.gauntletPosL.x));
		this.gauntletPosR.x = Math.max(-hw + 0.6, Math.min(hw, this.gauntletPosR.x));
		this.gauntletPosL.y = Math.max(0.2, Math.min(GOAL_HEIGHT + 0.3, this.gauntletPosL.y));
		this.gauntletPosR.y = Math.max(0.2, Math.min(GOAL_HEIGHT + 0.3, this.gauntletPosR.y));
		this.gauntletPosR.x = this.gauntletPosL.x + 0.6;
		this.gauntletPosR.y = this.gauntletPosL.y;

		this.gauntletL.position.copy(this.gauntletPosL);
		this.gauntletR.position.copy(this.gauntletPosR);
		this.gauntletL.visible = true;
		this.gauntletR.visible = true;
	}

	updateXRGauntlets() {
		const rightGrip = this.w.playerSpaceEntities?.gripSpaces?.right?.object3D;
		const leftGrip = this.w.playerSpaceEntities?.gripSpaces?.left?.object3D;
		if (!rightGrip && !leftGrip) return;

		// In XR, attach gauntlets to controllers
		if (rightGrip) {
			this.tmpVec.set(0, 0, 0);
			rightGrip.getWorldPosition(this.tmpVec);
			this.gauntletR.position.copy(this.tmpVec);
			this.gauntletPosR.copy(this.tmpVec);
			this.gauntletR.visible = true;
		}
		if (leftGrip) {
			this.tmpVec.set(0, 0, 0);
			leftGrip.getWorldPosition(this.tmpVec);
			this.gauntletL.position.copy(this.tmpVec);
			this.gauntletPosL.copy(this.tmpVec);
			this.gauntletL.visible = true;
		}
	}

	// ── R7: Training mode trajectory preview ──
	addTrainingPath(shot: Shot) {
		// Max 3 paths at once
		while (this.trainingPaths.length >= 3) {
			const old = this.trainingPaths.shift()!;
			this.scene.remove(old.line);
		}
		// Dashed line from spawn to target
		const segments = 20;
		const verts: number[] = [];
		for (let i = 0; i < segments; i++) {
			if (i % 2 === 1) continue; // skip every other for dashed effect
			const t0 = i / segments;
			const t1 = (i + 1) / segments;
			verts.push(
				shot.pos.x + (shot.target.x - shot.pos.x) * t0,
				shot.pos.y + (shot.target.y - shot.pos.y) * t0,
				shot.pos.z + (shot.target.z - shot.pos.z) * t0,
				shot.pos.x + (shot.target.x - shot.pos.x) * t1,
				shot.pos.y + (shot.target.y - shot.pos.y) * t1,
				shot.pos.z + (shot.target.z - shot.pos.z) * t1,
			);
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
		const trailColors: Record<string, number> = {
			standard: 0x00ffcc, curve: 0xffaa00, power: 0xff4444,
			split: 0xcc44ff, phantom: 0x44ccff, multi: 0xff8800,
		};
		const color = trailColors[shot.type] || 0x00ffcc;
		const mat = new LineBasicMaterial({ color, transparent: true, opacity: 0.15 });
		const line = new LineSegments(geo, mat);
		this.scene.add(line);
		this.trainingPaths.push({ line, shotRef: shot });
	}

	updateTrainingPaths() {
		// Remove paths for dead shots
		for (let i = this.trainingPaths.length - 1; i >= 0; i--) {
			const tp = this.trainingPaths[i];
			if (!tp.shotRef.alive) {
				this.scene.remove(tp.line);
				this.trainingPaths.splice(i, 1);
			}
		}
	}

	clearTrainingPaths() {
		for (const tp of this.trainingPaths) {
			this.scene.remove(tp.line);
		}
		this.trainingPaths = [];
	}

	// ── R7: Goal decoration ──
	buildGoalDecoration() {
		const hw = GOAL_WIDTH / 2;

		// Corner spheres at 4 corners of goal frame
		const corners = [
			[-hw, 0, GOAL_Z],
			[hw, 0, GOAL_Z],
			[-hw, GOAL_HEIGHT, GOAL_Z],
			[hw, GOAL_HEIGHT, GOAL_Z],
		];
		for (const [cx, cy, cz] of corners) {
			const geo = new SphereGeometry(0.08, 10, 8);
			const mat = new MeshStandardMaterial({
				color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 1.5,
				transparent: true, opacity: 0.9,
			});
			const sphere = new Mesh(geo, mat);
			sphere.position.set(cx, cy, cz);
			this.goalGroup.add(sphere);
			this.goalCornerSpheres.push(sphere);
		}

		// Vertical energy lines on goal posts
		const lineSegCount = 10;
		for (const xPos of [-hw, hw]) {
			const verts: number[] = [];
			for (let i = 0; i < lineSegCount; i++) {
				if (i % 2 === 1) continue;
				const y0 = (i / lineSegCount) * GOAL_HEIGHT;
				const y1 = ((i + 1) / lineSegCount) * GOAL_HEIGHT;
				verts.push(xPos, y0, GOAL_Z - 0.02, xPos, y1, GOAL_Z - 0.02);
			}
			const geo = new BufferGeometry();
			geo.setAttribute('position', new Float32BufferAttribute(verts, 3));
			const mat = new LineBasicMaterial({
				color: 0x00ffcc, transparent: true, opacity: 0.3,
			});
			const line = new LineSegments(geo, mat);
			this.goalGroup.add(line);
			this.goalEnergyLines.push(line);
		}

		// Danger zone floor glow
		const dzGeo = new BoxGeometry(GOAL_WIDTH, 0.01, 1.5);
		const dzMat = new MeshBasicMaterial({
			color: 0xff4444, transparent: true, opacity: 0.05,
			side: DoubleSide, depthWrite: false,
		});
		this.goalDangerZone = new Mesh(dzGeo, dzMat);
		this.goalDangerZone.position.set(0, 0.01, GOAL_Z + 0.75);
		this.goalGroup.add(this.goalDangerZone);
	}

	updateGoalDecoration(time: number) {
		// Corner spheres pulse with slow sine wave
		for (const sphere of this.goalCornerSpheres) {
			const mat = sphere.material as MeshStandardMaterial;
			mat.emissiveIntensity = 1.2 + Math.sin(time * 2) * 0.5;
			const scale = 1.0 + Math.sin(time * 1.5) * 0.15;
			sphere.scale.set(scale, scale, scale);
		}

		// Energy lines pulse opacity
		for (const line of this.goalEnergyLines) {
			const mat = line.material as LineBasicMaterial;
			mat.opacity = 0.2 + Math.sin(time * 3) * 0.15;
		}

		// Danger zone subtle pulse
		if (this.goalDangerZone) {
			const mat = this.goalDangerZone.material as MeshBasicMaterial;
			mat.opacity = 0.03 + Math.sin(time * 2) * 0.02;
		}
	}

	applyGoalDecorationTheme(color: number) {
		// Update corner spheres color for mode theme
		for (const sphere of this.goalCornerSpheres) {
			const mat = sphere.material as MeshStandardMaterial;
			mat.color.set(color);
			mat.emissive.set(color);
		}
		// Update energy lines color
		for (const line of this.goalEnergyLines) {
			const mat = line.material as LineBasicMaterial;
			mat.color.set(color);
		}
	}

	// ── R8: Seeded daily wave queue ──
	buildDailyWaveQueue() {
		if (!this.dailyRng) return;
		const rng = this.dailyRng;
		const allTypes: ShotType[] = ['standard', 'curve', 'power', 'split', 'phantom', 'multi'];
		const shotCount = Math.min(12, 6 + this.wave);
		this.challengeQueue = [];
		for (let i = 0; i < shotCount; i++) {
			const typeIdx = Math.floor(rng() * allTypes.length);
			this.challengeQueue.push(allTypes[typeIdx]);
		}
	}

	// ── R8: Progressive unlock system ──
	isUnlocked(feature: string): boolean {
		const achvCount = this.saveData.achievements.filter(Boolean).length;
		if (feature === 'arcade' || feature === 'challenge' || feature === 'training' || feature === 'timeattack') return true;
		if (feature === 'endless') return this.saveData.achievements[8] === true; // Wave 10
		if (feature === 'daily') return this.saveData.achievements[18] === true; // Challenge Clear
		if (feature === 'hard') return this.saveData.achievements[7] === true; // Wave 5
		if (feature === 'skin_Neon Classic') return true;
		if (feature === 'skin_Cyber Red') return achvCount >= 10;
		if (feature === 'skin_Ocean Deep') return achvCount >= 20;
		if (feature === 'skin_Void') return achvCount >= 25;
		return true;
	}

	refreshModeSelectLocks() {
		if (!this.modeDoc) return;
		const d = this.modeDoc;
		// Endless lock
		const endlessTitle = d.getElementById('endless-title') as UIKit.Text | undefined;
		const endlessDesc = d.getElementById('endless-desc') as UIKit.Text | undefined;
		if (!this.isUnlocked('endless')) {
			endlessTitle?.setProperties({ text: 'ENDLESS (LOCKED)', color: '#555555' });
			endlessDesc?.setProperties({ text: 'Unlock: Reach wave 10 in Arcade', color: '#444444' });
		} else {
			endlessTitle?.setProperties({ text: 'ENDLESS', color: '#ff6600' });
			if (endlessDesc) {
				const totalStars = (this.saveData.challengeStars || []).reduce((a: number, b: number) => a + b, 0);
				endlessDesc.setProperties({ text: 'No wave breaks - difficulty never stops climbing', color: '#886644' });
			}
		}
		// Daily lock
		const dailyTitle = d.getElementById('daily-title') as UIKit.Text | undefined;
		const dailyDesc = d.getElementById('daily-desc') as UIKit.Text | undefined;
		if (!this.isUnlocked('daily')) {
			dailyTitle?.setProperties({ text: 'DAILY CHALLENGE (LOCKED)', color: '#555555' });
			dailyDesc?.setProperties({ text: 'Unlock: Complete Challenge Mode', color: '#444444' });
		} else {
			dailyTitle?.setProperties({ text: 'DAILY CHALLENGE', color: '#ff8800' });
		}
	}

	updateDailyButtonDesc() {
		if (!this.modeDoc) return;
		const dailyDesc = this.modeDoc.getElementById('daily-desc') as UIKit.Text | undefined;
		if (!dailyDesc || !this.isUnlocked('daily')) return;
		const today = getTodayDateStr();
		if (this.saveData.dailyBest && this.saveData.dailyBest.date === today) {
			dailyDesc.setProperties({
				text: "Today's Best: " + this.saveData.dailyBest.score.toLocaleString(),
				color: '#886644',
			});
		} else {
			dailyDesc.setProperties({
				text: "Today's unique challenge - beat your best!",
				color: '#886644',
			});
		}
	}

	refreshDifficultyLock() {
		if (!this.settingsDoc) return;
		const d = this.settingsDoc;
		if (!this.isUnlocked('hard') && this.difficulty === 'hard') {
			this.difficulty = 'normal';
		}
		this.setTxt(d, 'set-diff', this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1));
	}

	// ── R8: Arena skin system ──
	applyArenaSkin(skin: string) {
		const skins: Record<string, { fog: number; ambient: number; floor: number; beacon: number[]; ring: number; accent: number[] }> = {
			'Neon Classic': {
				fog: 0x000811, ambient: 0x112233, floor: 0x00ffcc,
				beacon: [0x00ffcc, 0x00ccff, 0xcc44ff, 0xff4466],
				ring: 0x00ffcc,
				accent: [0x00ffcc, 0x00ccff, 0xcc44ff, 0xff4466, 0x44ff88],
			},
			'Cyber Red': {
				fog: 0x110000, ambient: 0x331111, floor: 0xff3333,
				beacon: [0xff4444, 0xff2222, 0xff6644, 0xff0022],
				ring: 0xff3333,
				accent: [0xff4444, 0xff2222, 0xff6644, 0xff0022, 0xff6666],
			},
			'Ocean Deep': {
				fog: 0x000811, ambient: 0x113344, floor: 0x22ccaa,
				beacon: [0x22ccaa, 0x00aacc, 0x44bbaa, 0x00cccc],
				ring: 0x22ccaa,
				accent: [0x22ccaa, 0x00aacc, 0x44bbaa, 0x00cccc, 0x44ddcc],
			},
			'Void': {
				fog: 0x020204, ambient: 0x0a0a11, floor: 0x8844ff,
				beacon: [0x8844ff, 0x6622dd, 0xaa66ff, 0x5500cc],
				ring: 0x8844ff,
				accent: [0x8844ff, 0x6622dd, 0xaa66ff, 0x5500cc, 0x9955ff],
			},
		};
		const s = skins[skin] || skins['Neon Classic'];
		this.scene.fog = new FogExp2(s.fog, skin === 'Ocean Deep' ? 0.025 : (skin === 'Void' ? 0.03 : 0.02));
		this.scene.background = new Color(s.fog);
		this.ambientLight.color.set(s.ambient);
		// Floor grid
		if (this.floorGridMat) this.floorGridMat.color.set(s.floor);
		// Beacon pillars and lights
		for (let i = 0; i < this.beaconPillars.length; i++) {
			const col = s.beacon[Math.floor(i / 2) % s.beacon.length];
			const mat = this.beaconPillars[i].material as MeshStandardMaterial;
			mat.color.set(col);
			mat.emissive.set(col);
		}
		for (let i = 0; i < this.beaconLights.length; i++) {
			this.beaconLights[i].color.set(s.beacon[i % s.beacon.length]);
		}
		// Floor ring
		if (this.neonFloorRingMat) this.neonFloorRingMat.color.set(s.ring);
		// Accent lights
		for (let i = 0; i < this.accentLights.length; i++) {
			this.accentLights[i].color.set(s.accent[i % s.accent.length]);
			this.originalAccentColors[i] = s.accent[i % s.accent.length];
		}
		this.applyGoalDecorationTheme(s.floor);
	}

	// ── R8: Time Attack countdown ring ──
	buildCountdownRing() {
		const geo = new CylinderGeometry(0.3, 0.3, 0.02, 32, 1, true);
		const mat = new MeshStandardMaterial({
			color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 1.0,
			transparent: true, opacity: 0.7, side: DoubleSide,
		});
		this.countdownRingMat = mat;
		this.countdownRing = new Mesh(geo, mat);
		this.countdownRing.position.set(0, 2.5, -1.5);
		this.countdownRing.visible = false;
		this.scene.add(this.countdownRing);
	}

	updateCountdownRing(time: number) {
		if (!this.countdownRing || !this.countdownRingMat) return;
		if (this.mode !== 'timeattack') {
			this.countdownRing.visible = false;
			return;
		}
		this.countdownRing.visible = true;
		const frac = Math.max(0, this.timeLeft / 60);
		// Scale ring based on remaining time
		this.countdownRing.scale.set(frac, 1, frac);
		// Color transition: cyan -> yellow -> red
		let c: Color;
		if (this.timeLeft > 30) {
			c = new Color(0x00ffcc);
		} else if (this.timeLeft > 10) {
			const t = (this.timeLeft - 10) / 20;
			c = new Color(0xffcc00).lerp(new Color(0x00ffcc), t);
		} else {
			const t = this.timeLeft / 10;
			c = new Color(0xff2200).lerp(new Color(0xffcc00), t);
		}
		this.countdownRingMat.color.copy(c);
		this.countdownRingMat.emissive.copy(c);
		// Pulse speed increases as time decreases
		const pulseSpeed = this.timeLeft > 30 ? 2 : (this.timeLeft > 10 ? 5 : 10);
		this.countdownRingMat.emissiveIntensity = 0.8 + Math.sin(time * pulseSpeed) * 0.5;
	}

	// ── R8: Menu demo shots ──
	spawnDemoShots() {
		this.clearDemoShots();
		for (let i = 0; i < 3; i++) {
			const colors = [0x00ffcc, 0xffaa00, 0xff4444];
			const color = colors[i % 3];
			const geo = new SphereGeometry(0.12, 8, 6);
			const mat = new MeshStandardMaterial({
				color, emissive: color, emissiveIntensity: 1.0,
				transparent: true, opacity: 0.6,
			});
			const mesh = new Mesh(geo, mat);
			const startX = -4 + i * 4;
			const startZ = -20 - i * 3;
			const startY = 1 + i * 0.8;
			mesh.position.set(startX, startY, startZ);
			this.scene.add(mesh);

			// Simple trail
			const trail = new Group();
			for (let t = 0; t < 3; t++) {
				const tGeo = new SphereGeometry(0.08 * (1 - t * 0.25), 4, 3);
				const tMat = new MeshBasicMaterial({
					color, transparent: true, opacity: 0.2 * (1 - t * 0.3),
				});
				const tMesh = new Mesh(tGeo, tMat);
				trail.add(tMesh);
			}
			this.scene.add(trail);

			const vel = new Vector3(
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.3) * 0.5,
				3 + Math.random() * 2,
			);
			this.demoShots.push({ mesh, vel, trail });
		}
	}

	updateDemoShots(dt: number) {
		for (const ds of this.demoShots) {
			ds.mesh.position.x += ds.vel.x * dt;
			ds.mesh.position.y += ds.vel.y * dt;
			ds.mesh.position.z += ds.vel.z * dt;
			ds.vel.y -= 1.0 * dt;

			// Update trail
			const children = ds.trail.children as Mesh[];
			for (let t = 0; t < children.length; t++) {
				const trailDt = (t + 1) * 2;
				children[t].position.set(
					ds.mesh.position.x - ds.vel.x * dt * trailDt,
					ds.mesh.position.y - ds.vel.y * dt * trailDt,
					ds.mesh.position.z - ds.vel.z * dt * trailDt,
				);
			}

			// Reset if out of bounds
			if (ds.mesh.position.z > 3 || ds.mesh.position.y < -2) {
				ds.mesh.position.set(
					(Math.random() - 0.5) * 8,
					1 + Math.random() * 2,
					-22 - Math.random() * 5,
				);
				ds.vel.set(
					(Math.random() - 0.5) * 2,
					(Math.random() - 0.3) * 0.5,
					3 + Math.random() * 2,
				);
			}
		}
	}

	clearDemoShots() {
		for (const ds of this.demoShots) {
			this.scene.remove(ds.mesh);
			this.scene.remove(ds.trail);
		}
		this.demoShots = [];
	}

	// ── R9: Achievement notification banner ──
	buildAchvBanner() {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 64;
		const ctx2d = canvas.getContext('2d')!;
		ctx2d.fillStyle = '#000a15';
		ctx2d.fillRect(0, 0, 512, 64);
		ctx2d.fillStyle = '#ffcc00';
		ctx2d.font = 'bold 24px sans-serif';
		ctx2d.textAlign = 'center';
		ctx2d.fillText('ACHIEVEMENT UNLOCKED', 256, 28);

		const tex = new CanvasTexture(canvas);
		const geo = new BoxGeometry(1.8, 0.24, 0.01);
		const mat = new MeshBasicMaterial({
			map: tex, transparent: true, opacity: 0,
		});
		this.achvBannerMesh = new Mesh(geo, mat);
		this.achvBannerMesh.position.set(0, 2.8, -1.5);
		this.achvBannerMesh.visible = false;
		this.scene.add(this.achvBannerMesh);
	}

	showAchvBanner(name: string) {
		if (!this.achvBannerMesh) return;
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 64;
		const ctx2d = canvas.getContext('2d')!;
		ctx2d.fillStyle = '#0a0a18';
		ctx2d.fillRect(0, 0, 512, 64);
		ctx2d.strokeStyle = '#ffcc00';
		ctx2d.lineWidth = 3;
		ctx2d.strokeRect(2, 2, 508, 60);
		ctx2d.fillStyle = '#ffcc00';
		ctx2d.font = 'bold 18px sans-serif';
		ctx2d.textAlign = 'center';
		ctx2d.fillText('ACHIEVEMENT UNLOCKED', 256, 25);
		ctx2d.fillStyle = '#ffeecc';
		ctx2d.font = '16px sans-serif';
		ctx2d.fillText(name, 256, 50);

		const tex = new CanvasTexture(canvas);
		(this.achvBannerMesh.material as MeshBasicMaterial).map = tex;
		(this.achvBannerMesh.material as MeshBasicMaterial).opacity = 1.0;
		(this.achvBannerMesh.material as MeshBasicMaterial).needsUpdate = true;
		this.achvBannerMesh.visible = true;
		this.achvBannerMesh.position.y = 2.8;
		this.achvBannerTimer = 3.0;
	}

	updateAchvBanner(dt: number) {
		if (this.achvBannerTimer <= 0 && this.achvBannerQueue.length > 0) {
			const name = this.achvBannerQueue.shift()!;
			this.showAchvBanner(name);
		}
		if (this.achvBannerTimer > 0 && this.achvBannerMesh) {
			this.achvBannerTimer -= dt;
			if (this.achvBannerTimer <= 0) {
				this.achvBannerMesh.visible = false;
				(this.achvBannerMesh.material as MeshBasicMaterial).opacity = 0;
			} else if (this.achvBannerTimer < 0.5) {
				(this.achvBannerMesh.material as MeshBasicMaterial).opacity = this.achvBannerTimer / 0.5;
			} else if (this.achvBannerTimer > 2.5) {
				(this.achvBannerMesh.material as MeshBasicMaterial).opacity = (3.0 - this.achvBannerTimer) / 0.5;
			}
			this.achvBannerMesh.position.y += dt * 0.05;
		}
	}

	// ── R9: Atmosphere particles (per-skin embers/sparks) ──
	maybeSpawnAtmosParticle() {
		this.atmosSpawnTimer -= 0.016;
		if (this.atmosSpawnTimer > 0) return;
		this.atmosSpawnTimer = 0.15 + Math.random() * 0.1;
		if (this.atmosParticles.length > 30) return;

		const skinColors: Record<string, number[]> = {
			'Neon Classic': [0x00ffcc, 0x00ccff, 0xcc44ff],
			'Cyber Red': [0xff4444, 0xff6644, 0xff2222],
			'Ocean Deep': [0x22ccaa, 0x00aacc, 0x44ddcc],
			'Void': [0x8844ff, 0x6622dd, 0xaa66ff],
		};
		const colors = skinColors[this.arenaSkin] || skinColors['Neon Classic'];
		const color = colors[Math.floor(Math.random() * colors.length)];

		const geo = new SphereGeometry(0.02 + Math.random() * 0.02, 3, 3);
		const mat = new MeshBasicMaterial({
			color, transparent: true, opacity: 0.4 + Math.random() * 0.3,
		});
		const mesh = new Mesh(geo, mat);
		mesh.position.set(
			(Math.random() - 0.5) * 14,
			5 + Math.random() * 2,
			-3 - Math.random() * 20,
		);
		this.scene.add(mesh);

		this.atmosParticles.push({
			mesh,
			vel: new Vector3(
				(Math.random() - 0.5) * 0.3,
				-0.3 - Math.random() * 0.2,
				(Math.random() - 0.5) * 0.2,
			),
			life: 4 + Math.random() * 3,
			maxLife: 4 + Math.random() * 3,
		});
	}

	updateAtmosParticles(dt: number) {
		for (let i = this.atmosParticles.length - 1; i >= 0; i--) {
			const p = this.atmosParticles[i];
			p.life -= dt;
			if (p.life <= 0 || p.mesh.position.y < -1) {
				this.scene.remove(p.mesh);
				this.atmosParticles.splice(i, 1);
				continue;
			}
			p.mesh.position.x += p.vel.x * dt;
			p.mesh.position.y += p.vel.y * dt;
			p.mesh.position.z += p.vel.z * dt;
			p.mesh.position.x += Math.sin(p.life * 2) * 0.01;
			const frac = p.life / p.maxLife;
			(p.mesh.material as MeshBasicMaterial).opacity = frac * 0.5;
		}
	}

	// ── R9: Near-miss sparks ──
	spawnNearMissSparks(pos: Vector3) {
		for (let i = 0; i < 8; i++) {
			const geo = new BoxGeometry(0.03, 0.03, 0.03);
			const mat = new MeshBasicMaterial({
				color: 0xffaa00, transparent: true, opacity: 0.9,
			});
			const mesh = new Mesh(geo, mat);
			mesh.position.copy(pos);
			this.scene.add(mesh);
			this.nearMissSparks.push({
				mesh,
				vel: new Vector3(
					(Math.random() - 0.5) * 5,
					Math.random() * 4,
					(Math.random() - 0.5) * 5,
				),
				life: 0.4 + Math.random() * 0.3,
			});
		}
		playSfx('click');
	}

	updateNearMissSparks(dt: number) {
		for (let i = this.nearMissSparks.length - 1; i >= 0; i--) {
			const s = this.nearMissSparks[i];
			s.life -= dt;
			if (s.life <= 0) {
				this.scene.remove(s.mesh);
				this.nearMissSparks.splice(i, 1);
				continue;
			}
			s.mesh.position.x += s.vel.x * dt;
			s.mesh.position.y += s.vel.y * dt;
			s.vel.y -= 9 * dt;
			s.mesh.position.z += s.vel.z * dt;
			(s.mesh.material as MeshBasicMaterial).opacity = s.life * 1.5;
			s.mesh.rotation.x += dt * 10;
			s.mesh.rotation.y += dt * 8;
		}
	}
}
