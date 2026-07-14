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
} from '@iwsdk/core';

// ── Types ──
type GameState = 'menu' | 'mode_select' | 'playing' | 'wave_complete' | 'game_over' | 'settings' | 'achievements' | 'stats';
type GameMode = 'arcade' | 'challenge' | 'training' | 'timeattack';
type ShotType = 'standard' | 'curve' | 'power' | 'split' | 'phantom' | 'multi';
type Difficulty = 'easy' | 'normal' | 'hard';

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
];
const ACHV_DESC = [
	'Block your first shot', 'Complete a wave without conceding', 'Get a 5-save streak',
	'Get a 10-save streak', 'Get a 20-save streak', 'Catch 10 shots', 'Catch 50 shots',
	'Reach wave 5', 'Reach wave 10', 'Reach wave 15', 'Reach wave 25',
	'Reach 1,000 points', 'Reach 5,000 points', 'Reach 10,000 points', 'Reach 25,000 points',
	'Save a phantom shot', 'Save 10 power shots', 'Save both halves of a split',
	'Complete challenge mode', 'Save 50+ in time attack',
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
	try {
		const ctx = getAudioCtx();
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.04, ctx.currentTime);
		g.connect(ctx.destination);

		const o = ctx.createOscillator();
		o.type = 'sine';
		o.frequency.setValueAtTime(55, ctx.currentTime);
		o.connect(g);

		const o2 = ctx.createOscillator();
		o2.type = 'sine';
		o2.frequency.setValueAtTime(82.5, ctx.currentTime);
		const g2 = ctx.createGain();
		g2.gain.setValueAtTime(0.025, ctx.currentTime);
		g2.connect(ctx.destination);
		o2.connect(g2);

		o.start();
		o2.start();
	} catch { /* */ }
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
}) {
	// ── World ref ──
	w!: World;
	scene: any = null;

	// ── Panel entities ──
	menuEntity!: Entity; modeEntity!: Entity; hudEntity!: Entity;
	scorecardEntity!: Entity; gameOverEntity!: Entity; settingsEntity!: Entity;
	achvEntity!: Entity; statsEntity!: Entity;

	// ── Panel docs ──
	menuDoc: UIKitDocument | null = null;
	modeDoc: UIKitDocument | null = null;
	hudDoc: UIKitDocument | null = null;
	scorecardDoc: UIKitDocument | null = null;
	gameOverDoc: UIKitDocument | null = null;
	settingsDoc: UIKitDocument | null = null;
	achvDoc: UIKitDocument | null = null;
	statsDoc: UIKitDocument | null = null;

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
			if (raw) { this.saveData = JSON.parse(raw); return; }
		} catch { /* */ }
		this.saveData = {
			gamesPlayed: 0, totalSaves: 0, totalCatches: 0, totalGoals: 0,
			bestWave: 0, bestScore: 0, bestStreak: 0,
			achievements: new Array(20).fill(false), playTimeMs: 0, powerSaves: 0,
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
		const mat = new LineBasicMaterial({ color: 0x003344, transparent: true, opacity: 0.3 });
		this.floorGrid = new LineSegments(geo, mat);
		this.scene.add(this.floorGrid);
	}

	buildGoal() {
		this.goalGroup = new Group();
		const postMat = new MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.8 });
		const postGeo = new CylinderGeometry(0.06, 0.06, GOAL_HEIGHT, 8);
		const crossGeo = new CylinderGeometry(0.06, 0.06, GOAL_WIDTH + 0.12, 8);

		// Left post
		const lp = new Mesh(postGeo, postMat);
		lp.position.set(-GOAL_WIDTH / 2, GOAL_HEIGHT / 2, GOAL_Z);
		this.goalGroup.add(lp);

		// Right post
		const rp = new Mesh(postGeo, postMat);
		rp.position.set(GOAL_WIDTH / 2, GOAL_HEIGHT / 2, GOAL_Z);
		this.goalGroup.add(rp);

		// Crossbar
		const cb = new Mesh(crossGeo, postMat);
		cb.rotation.z = Math.PI / 2;
		cb.position.set(0, GOAL_HEIGHT, GOAL_Z);
		this.goalGroup.add(cb);

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
		this.goalGroup.add(new LineSegments(netGeo, netMat));

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
	}

	// ── Panel bindings ──
	bindMenu() {
		const d = this.menuDoc!;
		(d.getElementById('btn-play') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('mode_select'); });
		(d.getElementById('btn-settings') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.showState('settings'); });
		(d.getElementById('btn-achieve') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.refreshAchievements(); this.showState('achievements'); });
		(d.getElementById('btn-stats') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.refreshStats(); this.showState('stats'); });
		this.updateMenuLabels();
	}

	bindModeSelect() {
		const d = this.modeDoc!;
		(d.getElementById('btn-arcade') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.startGame('arcade'); });
		(d.getElementById('btn-challenge') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.startGame('challenge'); });
		(d.getElementById('btn-training') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.startGame('training'); });
		(d.getElementById('btn-timeattack') as UIKit.Text)?.addEventListener('click', () => { playSfx('click'); this.startGame('timeattack'); });
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
			const opts: Difficulty[] = ['easy', 'normal', 'hard'];
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

	// ── UI Helpers ──
	setTxt(doc: UIKitDocument, id: string, text: string) {
		(doc.getElementById(id) as UIKit.Text | undefined)?.setProperties({ text });
	}

	updateMenuLabels() {
		if (!this.menuDoc) return;
		const rank = this.getRank();
		this.setTxt(this.menuDoc, 'rank-label', 'Rank: ' + rank);
		this.setTxt(this.menuDoc, 'best-label', 'Best Wave: ' + (this.saveData.bestWave || '--'));
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
		} else {
			this.setTxt(this.hudDoc, 'timer', this.mode === 'training' ? 'Training Mode' : '');
		}
	}

	refreshAchievements() {
		if (!this.achvDoc) return;
		let unlocked = 0;
		for (let i = 0; i < 20; i++) {
			const done = this.saveData.achievements[i];
			if (done) unlocked++;
			const prefix = done ? '[*] ' : '[ ] ';
			const color = done ? '#ffaa00' : '#334455';
			const el = this.achvDoc.getElementById('ach-' + i) as UIKit.Text | undefined;
			el?.setProperties({ text: prefix + ACHV_NAMES[i] + ' - ' + ACHV_DESC[i], color });
		}
		this.setTxt(this.achvDoc, 'ach-count', unlocked + ' / 20 Unlocked');
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

		// HUD uses Follower, so toggle visible
		this.hudEntity.object3D!.visible = s === 'playing';

		// Show/hide goal based on game state
		this.goalGroup.visible = s === 'playing' || s === 'wave_complete' || s === 'game_over';

		if (s === 'menu') {
			this.updateMenuLabels();
			this.clearShots();
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
		else this.lives = 999; // timeattack

		this.timeLeft = mode === 'timeattack' ? 60 : 0;

		if (!this.ambientStarted && this.musicOn) {
			playAmbient();
			this.ambientStarted = true;
		}

		this.showState('playing');
		this.beginWave();
	}

	beginWave() {
		this.waveSaves = 0;
		this.waveGoals = 0;
		this.waveCatches = 0;
		this.waveShotsLaunched = 0;
		this.shotTimer = 1.0; // initial delay
		this.waveActive = true;

		const dm = DIFF_MULT[this.difficulty];
		const w = this.wave;

		if (this.mode === 'timeattack') {
			this.waveShots = 999; // continuous
			this.shotInterval = Math.max(0.4, 1.2 - w * 0.05) / dm;
		} else if (this.mode === 'challenge') {
			this.waveShots = 5 + this.challengeLevel * 2;
			this.shotInterval = Math.max(0.5, 1.5 - this.challengeLevel * 0.08) / dm;
		} else if (this.mode === 'training') {
			this.waveShots = 5;
			this.shotInterval = 2.5;
		} else {
			this.waveShots = Math.min(4 + w * 2, 30);
			this.shotInterval = Math.max(0.4, 1.5 - w * 0.06) / dm;
		}

		playSfx('wave');
		this.updateHud();
	}

	endWave() {
		this.waveActive = false;

		if (this.mode === 'challenge') {
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

		if (this.waveGoals === 0) this.unlockAchievement(1); // Clean Sheet

		// Show scorecard
		if (this.scorecardDoc) {
			const title = this.mode === 'challenge' ? 'CHALLENGE ' + (this.challengeLevel - 1) + ' CLEAR' : 'WAVE ' + this.wave + ' COMPLETE';
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

		// Update save data
		this.saveData.gamesPlayed++;
		this.saveData.totalSaves += this.totalSaves;
		this.saveData.totalCatches += this.totalCatches;
		this.saveData.totalGoals += this.totalGoals;
		if (this.wave > this.saveData.bestWave) this.saveData.bestWave = this.wave;
		if (this.score > this.saveData.bestScore) this.saveData.bestScore = this.score;
		if (this.bestCombo > this.saveData.bestStreak) this.saveData.bestStreak = this.bestCombo;
		this.saveData.playTimeMs += performance.now() - this.gameStartTime;
		this.persistSave();

		// Show game over
		if (this.gameOverDoc) {
			this.setTxt(this.gameOverDoc, 'go-score', String(this.score));
			this.setTxt(this.gameOverDoc, 'go-waves', String(this.wave));
			this.setTxt(this.gameOverDoc, 'go-saves', String(this.totalSaves));
			this.setTxt(this.gameOverDoc, 'go-catches', String(this.totalCatches));
			this.setTxt(this.gameOverDoc, 'go-streak', String(this.bestCombo));
			const total = this.totalSaves + this.totalGoals;
			this.setTxt(this.gameOverDoc, 'go-rate', total > 0 ? Math.round(this.totalSaves / total * 100) + '%' : '0%');
			const isRecord = this.score >= this.saveData.bestScore;
			this.setTxt(this.gameOverDoc, 'go-record', isRecord ? 'NEW RECORD!' : '');
		}
		this.showState('game_over');
		playSfx('gameover');
	}

	// ── Shots ──
	getShotTypes(): ShotType[] {
		const w = this.wave;
		const types: ShotType[] = ['standard'];
		if (w >= 3 || this.mode === 'challenge') types.push('curve');
		if (w >= 5 || (this.mode === 'challenge' && this.challengeLevel >= 3)) types.push('power');
		if (w >= 8 || (this.mode === 'challenge' && this.challengeLevel >= 5)) types.push('split');
		if (w >= 12 || (this.mode === 'challenge' && this.challengeLevel >= 7)) types.push('phantom');
		return types;
	}

	spawnShot(type?: ShotType) {
		const types = this.getShotTypes();
		if (!type) type = types[Math.floor(Math.random() * types.length)];

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

		const dir = target.clone().sub(pos).normalize();
		const vel = dir.multiplyScalar(speed);

		// Mesh
		const radius = type === 'power' ? SHOT_RADIUS * 0.8 : SHOT_RADIUS;
		let color = 0x00ffcc;
		if (type === 'curve') color = 0xffaa00;
		else if (type === 'power') color = 0xff4444;
		else if (type === 'split') color = 0xcc44ff;
		else if (type === 'phantom') color = 0x44ccff;

		const geo = new SphereGeometry(radius, 10, 8);
		const mat = new MeshStandardMaterial({
			color, emissive: color, emissiveIntensity: 1.0,
			transparent: true, opacity: 0.9,
		});
		const mesh = new Mesh(geo, mat);
		mesh.position.copy(pos);
		this.scene.add(mesh);

		// Trail
		const trail = new Group();
		for (let i = 0; i < 5; i++) {
			const tGeo = new SphereGeometry(radius * (1 - i * 0.15), 6, 4);
			const tMat = new MeshBasicMaterial({
				color, transparent: true, opacity: 0.3 - i * 0.05,
			});
			const tMesh = new Mesh(tGeo, tMat);
			trail.add(tMesh);
		}
		this.scene.add(trail);

		const shot: Shot = {
			mesh, trail, type, pos: pos.clone(), vel: vel.clone(),
			target: target.clone(), speed, alive: true, blocked: false,
			splitDone: false, phantomTimer: 0, visible: true,
			curvePhase: Math.random() * Math.PI * 2,
			curveAmplitude: 1.5 + Math.random() * 1.5,
			spawnZ: pos.z,
		};

		this.shots.push(shot);
		this.waveShotsLaunched++;
		playSfx('launch');
	}

	spawnSplitChildren(parent: Shot) {
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
			});
		}
		playSfx('split');
	}

	clearShots() {
		for (const s of this.shots) {
			this.scene.remove(s.mesh);
			this.scene.remove(s.trail);
		}
		this.shots = [];
	}

	// ── Collision ──
	checkBlock(shot: Shot): { blocked: boolean; isCatch: boolean } {
		if (!shot.alive || shot.blocked) return { blocked: false, isCatch: false };

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
			if (shot.pos.distanceTo(this.tmpVec) < BLOCK_RADIUS) {
				isCatch = !!gripHeld;
				return { blocked: true, isCatch };
			}
		}
		if (leftGrip) {
			this.tmpVec.set(0, 0, 0);
			leftGrip.getWorldPosition(this.tmpVec);
			if (shot.pos.distanceTo(this.tmpVec) < BLOCK_RADIUS) {
				isCatch = !!gripHeld;
				return { blocked: true, isCatch };
			}
		}

		// Browser mode: use gauntlet positions
		if (!rightGrip && !leftGrip) {
			if (shot.pos.distanceTo(this.gauntletPosL) < BLOCK_RADIUS) return { blocked: true, isCatch: false };
			if (shot.pos.distanceTo(this.gauntletPosR) < BLOCK_RADIUS) return { blocked: true, isCatch: false };
		}

		return { blocked: false, isCatch: false };
	}

	onSave(shot: Shot, isCatch: boolean) {
		shot.blocked = true;
		shot.alive = false;
		this.scene.remove(shot.mesh);
		this.scene.remove(shot.trail);

		this.combo++;
		if (this.combo > this.bestCombo) this.bestCombo = this.combo;
		this.waveSaves++;
		this.totalSaves++;

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

		this.score += base * multi;

		// Particles
		if (this.particlesOn) this.spawnSaveParticles(shot.pos, shot.type === 'power' ? 0xff4444 : 0x00ffcc);

		// Haptics
		this.rumble('right', 0.5, 40);
		this.rumble('left', 0.5, 40);

		// Check achievements
		this.unlockAchievement(0); // First Save
		if (this.combo >= 5) this.unlockAchievement(2);
		if (this.combo >= 10) this.unlockAchievement(3);
		if (this.combo >= 20) this.unlockAchievement(4);
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

		this.updateHud();
	}

	onGoal(shot: Shot) {
		shot.alive = false;
		this.scene.remove(shot.mesh);
		this.scene.remove(shot.trail);

		this.combo = 0;
		this.waveGoals++;
		this.totalGoals++;
		if (this.mode !== 'training' && this.mode !== 'timeattack') this.lives--;

		playSfx('goal');
		if (this.particlesOn) this.spawnSaveParticles(shot.pos, 0xff4444);

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
	}

	// ── Update ──
	update(delta: number, _time: number) {
		if (this.state !== 'playing') return;

		const dt = Math.min(delta, 0.05); // cap

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

		// XR mode: update gauntlet visuals to match controllers
		this.updateXRGauntlets();

		// Shot spawning
		this.shotTimer -= dt;
		if (this.shotTimer <= 0 && this.waveActive) {
			if (this.mode === 'timeattack' || this.waveShotsLaunched < this.waveShots) {
				this.spawnShot();
				this.shotTimer = this.shotInterval;
			}
		}

		// Update shots
		let allDone = true;
		for (let i = this.shots.length - 1; i >= 0; i--) {
			const s = this.shots[i];
			if (!s.alive) continue;
			allDone = false;

			// Move
			s.pos.x += s.vel.x * dt;
			s.pos.y += s.vel.y * dt;
			s.pos.z += s.vel.z * dt;

			// Gravity
			s.vel.y -= 1.5 * dt;

			// Curve behavior
			if (s.type === 'curve') {
				const progress = (s.pos.z - s.spawnZ) / (GOAL_Z - s.spawnZ);
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

			// Update trail
			const trailChildren = s.trail.children as Mesh[];
			for (let t = 0; t < trailChildren.length; t++) {
				const tc = trailChildren[t];
				tc.position.set(
					s.pos.x - s.vel.x * dt * (t + 1) * 2,
					s.pos.y - s.vel.y * dt * (t + 1) * 2,
					s.pos.z - s.vel.z * dt * (t + 1) * 2,
				);
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
					this.scene.remove(s.mesh);
					this.scene.remove(s.trail);
				}
				continue;
			}

			// Out of bounds
			if (s.pos.y < -2 || s.pos.z > 5) {
				s.alive = false;
				this.scene.remove(s.mesh);
				this.scene.remove(s.trail);
			}
		}

		// Clean dead shots
		this.shots = this.shots.filter(s => s.alive);

		// Check wave end
		if (this.mode !== 'timeattack' && this.waveActive &&
			this.waveShotsLaunched >= this.waveShots && this.shots.length === 0) {
			// Wave achievements
			if (this.wave >= 5) this.unlockAchievement(7);
			if (this.wave >= 10) this.unlockAchievement(8);
			if (this.wave >= 15) this.unlockAchievement(9);
			if (this.wave >= 25) this.unlockAchievement(10);
			this.endWave();
		}

		// Update particles
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

		// Gauntlet glow pulse
		const pulse = 0.6 + Math.sin(_time * 4) * 0.2;
		(this.gauntletL.material as MeshStandardMaterial).emissiveIntensity = pulse;
		(this.gauntletR.material as MeshStandardMaterial).emissiveIntensity = pulse;
	}

	updateBrowserGauntlets() {
		// In browser mode (no XR grip), move gauntlets with mouse
		const rightGrip = this.w.playerSpaceEntities?.gripSpaces?.right?.object3D;
		if (rightGrip) return; // XR mode, handled separately

		// Use raycaster from camera
		const canvas = this.w.renderer.domElement;
		if (!canvas) return;

		// Keyboard controls
		const kb = this.w.input.keyboard;
		const moveSpeed = 3;

		if (kb.getKeyPressed('KeyA') || kb.getKeyPressed('ArrowLeft')) {
			this.gauntletPosL.x -= moveSpeed * 0.016;
			this.gauntletPosR.x -= moveSpeed * 0.016;
		}
		if (kb.getKeyPressed('KeyD') || kb.getKeyPressed('ArrowRight')) {
			this.gauntletPosL.x += moveSpeed * 0.016;
			this.gauntletPosR.x += moveSpeed * 0.016;
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
}
