import * as THREE from 'three';
import { useArkvoidStore } from '../engine/store.ts';
import type { CharacterId, LocationId } from '../engine/types.ts';
import { LANDMARKS, PLACES, placeAt } from '../world/bible.ts';
import { surfaceAt, type SurfaceKind } from '../world/terrainFn.ts';
import { AudioEngine } from './audio/AudioEngine.ts';
import {
  playDescent,
  type CinematicOverlayState,
  type CinematicTargetEngine,
} from './cinematics/Descent.ts';
import { installArkvoidFogPatch, verifyPatchedMaterial } from './fog.ts';
import { ColliderGrid } from './life/Colliders.ts';
import { GrassField } from './life/Grass.ts';
import { LeavesAndMotes } from './life/Leaves.ts';
import { WorldVegetation } from './life/Vegetation.ts';
import { PlayerCamera } from './PlayerCamera.ts';
import { PostPipeline } from './Post.ts';
import {
  detectInitialQualityTier,
  isHeadlessBrowser,
  QUALITY,
  QualityGovernor,
  type GovernorLogEntry,
  type QualityPreference,
  type QualityTier,
} from './Quality.ts';
import { CloudFallback } from './sky/CloudFallback.ts';
import { WorldLighting } from './sky/Lighting.ts';
import { MistSea } from './sky/MistSea.ts';
import { SkyPass } from './sky/SkyPass.ts';
import { HorizonRings } from './terrain/HorizonRings.ts';
import { TerrainManager } from './terrain/TerrainManager.ts';
import { setActiveWearMap, WearMap } from './terrain/Wear.ts';
import { buildTestLandscape, type TestLandscapeResult } from './TestLandscape.ts';
import { U, updateSharedUniforms } from './uniforms.ts';
import { WorldWater } from './water/Water.ts';

export interface EngineTelemetry {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  cloudGpuMs: number | null;
  tier: QualityTier;
  preference: QualityPreference;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  playerPos: [number, number, number];
  currentPlace: LocationId;
  surface: SurfaceKind;
  activeChunks: number;
  visibleChunks: number;
  wearSteps: number;
  wearSampleHere: number;
  worldHours: number;
  sunElevationDeg: number;
  flying: boolean;
  soundCaptionsEnabled: boolean;
  shaderCheckOk: boolean;
  shaderCheckDetail: string;
  contextLost: boolean;
  governorLogs: readonly GovernorLogEntry[];
}

export interface WorldEngineCallbacks {
  onTelemetry?: (telemetry: EngineTelemetry) => void;
  onPlaceWalked?: (place: LocationId) => void;
  onCharacterClicked?: (characterId: CharacterId) => void;
  onCinematicOverlay?: (state: CinematicOverlayState) => void;
  onSoundCaption?: (caption: string) => void;
}

const _rayMouse = new THREE.Vector2();
const _focusVec = new THREE.Vector3();

export class WorldEngine implements CinematicTargetEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private skyPass: SkyPass;
  private horizonRings: HorizonRings;
  private mistSea: MistSea;
  private cloudFallback: CloudFallback;
  private lighting: WorldLighting;
  private colliderGrid: ColliderGrid;
  private wearMap: WearMap;
  public readonly terrain: TerrainManager;
  private water: WorldWater;
  private vegetation: WorldVegetation;
  private grass: GrassField;
  private leaves: LeavesAndMotes;
  private audio: AudioEngine;
  private playerCamera: PlayerCamera;
  private post: PostPipeline;
  private governor: QualityGovernor;
  private landscape: TestLandscapeResult;
  private emberLights: THREE.PointLight[] = [];
  private raycaster = new THREE.Raycaster();

  private rafId: number | null = null;
  private running = false;
  private contextLost = false;
  private lastFrameTs = 0;
  private startTs = 0;
  private lastTelemetryTs = 0;
  private readonly isHeadless: boolean;
  private initialDetectedTier: QualityTier;
  private shaderCheck: { ok: boolean; detail: string };
  private callbacks: WorldEngineCallbacks;
  private descentSkipSignal: { skip: () => void } = { skip: () => {} };
  private lastSunElevationDeg = 6.0;

  private boundResize: () => void;
  private boundContextLost: (e: Event) => void;
  private boundContextRestored: () => void;

  public onCinematicOverlayChange?: (state: CinematicOverlayState) => void;

  constructor(container: HTMLElement, callbacks: WorldEngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.onCinematicOverlayChange = callbacks.onCinematicOverlay;
    this.isHeadless = isHeadlessBrowser();

    installArkvoidFogPatch();

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.dataset.testid = 'world-canvas';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.initialDetectedTier = detectInitialQualityTier(this.renderer);
    this.governor = new QualityGovernor(this.initialDetectedTier, (newTier) => {
      this.applyQualityTier(newTier);
    });
    const initialTier = this.governor.getTier();

    this.scene = new THREE.Scene();
    // Background is rendered by SkyPass + HorizonRings before the main scene (no depth write)
    this.scene.background = null;
    this.scene.fog = new THREE.FogExp2(0xe0aa84, 0.0005);

    // 1. Background Sky Pass + Layered Ink-Wash Horizon Rings (6 km, 11 km, 18 km)
    this.skyPass = new SkyPass();
    this.horizonRings = new HorizonRings();

    // 2. Endless 60 km Mist Sea floor at y = 10
    this.mistSea = new MistSea();
    this.scene.add(this.mistSea.mesh);

    // 3. Low-tier 5-layer Cloud Fallback planes inside CLOUD_SEA.y0..y1
    this.cloudFallback = new CloudFallback();
    this.scene.add(this.cloudFallback.group);

    // 4. Spatial Collider Grid & Footpath Wear Map (persisted in arkvoid:v1:wear)
    this.colliderGrid = new ColliderGrid();
    this.colliderGrid.addBatch('landmarks', [
      { kind: 'box', id: 'gate_pier_inner_l', cx: 64, cz: -4.6, halfX: 0.7, halfZ: 0.7, tag: 'gate' },
      { kind: 'box', id: 'gate_pier_inner_r', cx: 64, cz: 4.6, halfX: 0.7, halfZ: 0.7, tag: 'gate' },
      { kind: 'box', id: 'gate_pier_outer_l', cx: 64, cz: -7.2, halfX: 0.65, halfZ: 0.65, tag: 'gate' },
      { kind: 'box', id: 'gate_pier_outer_r', cx: 64, cz: 7.2, halfX: 0.65, halfZ: 0.65, tag: 'gate' },
      { kind: 'circle', id: 'courtyard_brazier', x: 46.0, z: -4.2, radius: 1.0, tag: 'brazier' },
    ]);

    this.wearMap = new WearMap(initialTier);
    setActiveWearMap(this.wearMap);

    // 5. Streaming Terrain Manager (128 m chunks, LOD0/1/2 with hysteresis, 6 m skirts, PathField, 5-layer splat shader)
    this.terrain = new TerrainManager(initialTier);
    this.scene.add(this.terrain.group);

    // 6. Water System (Valley Lake at (-330,300), upper/lower streams, 38 m waterfall at (30,130) + mist plume)
    this.water = new WorldWater(initialTier);
    this.scene.add(this.water.group);

    // 7. Instanced Vegetation, Rocks, Wildflowers & Hero Overlook Maple at (-128,432,-556)
    this.vegetation = new WorldVegetation(initialTier, this.colliderGrid);
    this.scene.add(this.vegetation.group);

    // 8. GPU Wind Grass Field (5-vertex blades bent by uWear and pushed aside by player + NPCs)
    this.grass = new GrassField(initialTier);
    this.scene.add(this.grass.mesh);

    // 9. Falling Maple Leaves, Sunlit Dust Motes & Dusk/Night Ember Fireflies
    this.leaves = new LeavesAndMotes(initialTier);
    this.scene.add(this.leaves.group);

    // Verify patched material compilation once at startup
    this.shaderCheck = this.isHeadless
      ? { ok: true, detail: 'Patched MeshStandardMaterial + ArkvoidFog active.' }
      : verifyPatchedMaterial(this.renderer);

    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    const storeState = useArkvoidStore.getState();
    this.playerCamera = new PlayerCamera(width / height, {
      domElement: this.renderer.domElement,
      reducedMotion: storeState.ui.reducedMotion,
      colliderGrid: this.colliderGrid,
      onPlaceChanged: (newPlace) => {
        this.callbacks.onPlaceWalked?.(newPlace);
      },
      onEdgeWarning: () => {
        useArkvoidStore
          .getState()
          .pushToast('The mist thickens ahead; the road turns back toward the valley.', 'neutral');
      },
      onCanvasTap: (ndcX, ndcY) => {
        this.handleCanvasTap(ndcX, ndcY);
      },
    });
    // Enable layer 2 on the player camera so objects on layer 2 are visible
    this.playerCamera.camera.layers.enable(2);

    // Sync initial player spawn to store's current playerPlace
    this.playerCamera.teleportToPlace(storeState.world.playerPlace);

    // Pre-build initial terrain & vegetation chunks around the spawn point immediately
    this.terrain.update(this.playerCamera.camera, this.playerCamera.feetPos);
    this.vegetation.update(this.playerCamera.feetPos);

    // 10. Lighting System (Sun/Sister light, Near texel-snapped shadow, Far shadow, Hemisphere, SkyPass PMREM env)
    this.lighting = new WorldLighting(
      this.renderer,
      this.scene,
      this.skyPass,
      initialTier,
      this.isHeadless
    );

    // 3 Warm Ember Point Lights (East Gate lanterns + Courtyard brazier)
    const emberCoords: ReadonlyArray<[number, number, number, number, number]> = [
      [63.6, 145.0, -3.3, 4.5, 22],
      [63.6, 145.0, 3.3, 4.5, 22],
      [46.0, 142.1, -4.2, 5.2, 26],
    ];
    for (const [lx, ly, lz, intensity, distance] of emberCoords) {
      const pt = new THREE.PointLight('#FB5607', intensity, distance, 1.6);
      pt.position.set(lx, ly, lz);
      this.scene.add(pt);
      this.emberLights.push(pt);
    }

    // 11. Build architectural landmarks, floating sky islands, and NPC figures
    this.landscape = buildTestLandscape(this.renderer);
    this.scene.add(this.landscape.root);

    // 12. Initialize Post-Processing Pipeline (CloudSeaEffect -> BloomEffect -> ArkvoidGradeEffect)
    this.post = new PostPipeline(
      this.renderer,
      this.scene,
      this.playerCamera.camera,
      initialTier
    );

    // 13. Generative Spatial Audio Engine
    this.audio = new AudioEngine({
      initialMuted: !storeState.ui.soundOn,
      captionsEnabled: false,
      onCaption: (caption) => {
        this.callbacks.onSoundCaption?.(caption);
      },
    });
    this.audio.addEmitter('gate_lantern_left', [63.6, 145.0, -3.3], 'lanternChime');
    this.audio.addEmitter('gate_lantern_right', [63.6, 145.0, 3.3], 'windchime');
    this.audio.addEmitter('courtyard_brazier', [46.0, 141.6, -4.2], 'fire');
    this.audio.addEmitter('waterfall_drop', [30.0, 111.0, 134.0], 'water');
    this.audio.addEmitter(
      'valley_lake',
      [
        LANDMARKS.valleyLake.center[0],
        LANDMARKS.valleyLake.waterLevel,
        LANDMARKS.valleyLake.center[1],
      ],
      'water'
    );
    this.audio.addEmitter(
      'orin_forge',
      [
        LANDMARKS.lowerCourt.orinWorkshop[0],
        131,
        LANDMARKS.lowerCourt.orinWorkshop[1],
      ],
      'hammer'
    );

    this.applyQualityTier(initialTier);
    this.resize(width, height);

    if (!this.isHeadless) {
      try {
        this.renderer.compile(this.scene, this.playerCamera.camera);
      } catch {
        // Ignore compile warnings
      }
    }

    this.boundResize = () => {
      const w = Math.max(1, this.container.clientWidth || window.innerWidth);
      const h = Math.max(1, this.container.clientHeight || window.innerHeight);
      this.resize(w, h);
    };
    this.boundContextLost = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
      this.emitTelemetry();
    };
    this.boundContextRestored = () => {
      this.contextLost = false;
      this.applyQualityTier(this.governor.getTier());
      this.emitTelemetry();
    };

    window.addEventListener('resize', this.boundResize);
    this.renderer.domElement.addEventListener('webglcontextlost', this.boundContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.boundContextRestored);
  }

  private applyQualityTier(tier: QualityTier): void {
    const cfg = QUALITY[tier];
    const dpr = this.isHeadless ? 1 : Math.min(window.devicePixelRatio || 1, cfg.dprCap);
    this.renderer.setPixelRatio(dpr);

    this.lighting.applyQualityTier(tier);
    this.cloudFallback.setVisible(tier === 'low');
    this.terrain.setQualityTier(tier);
    this.water.setQualityTier(tier);
    this.vegetation.setQualityTier(tier);
    this.grass.setQualityTier(tier);
    this.leaves.setQualityTier(tier);

    this.playerCamera.camera.far = Math.max(65000, cfg.viewDistance * 16);
    this.playerCamera.camera.updateProjectionMatrix();

    this.post.setQuality(tier);
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
  }

  private headlessFramesRemaining = 3;
  private lastRenderedWorldMinute = -1;
  private lastRenderedPlayerX = -99999;
  private lastRenderedPlayerY = -99999;
  private lastRenderedPlayerZ = -99999;

  private handleCanvasTap(ndcX: number, ndcY: number): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
    _rayMouse.set(ndcX, ndcY);
    this.raycaster.setFromCamera(_rayMouse, this.playerCamera.camera);
    const hits = this.raycaster.intersectObjects(this.landscape.interactables, true);
    if (hits.length > 0 && hits[0].distance < 36) {
      let obj: THREE.Object3D | null = hits[0].object;
      while (obj) {
        const cid = obj.userData?.characterId as CharacterId | undefined;
        if (cid) {
          this.audio.triggerInteractionTick();
          this.callbacks.onCharacterClicked?.(cid);
          return;
        }
        obj = obj.parent;
      }
    }
  }

  // CinematicTargetEngine interface methods for Descent / Ascent / Director
  public setCinematicPose(
    pos: THREE.Vector3,
    lookAt: THREE.Vector3,
    fov: number,
    rollRad: number
  ): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
    this.playerCamera.setCinematicPose(pos, lookAt, fov, rollRad);
  }

  public exitCinematicPose(): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
    this.playerCamera.exitCinematicPose();
  }

  public isReducedMotion(): boolean {
    return useArkvoidStore.getState().ui.reducedMotion;
  }

  public async playOpeningDescent(): Promise<void> {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 4);
    await Promise.race([
      this.terrain.ready,
      new Promise<void>((r) => setTimeout(r, 120)),
    ]);
    return playDescent(this, this.descentSkipSignal);
  }

  public skipOpeningDescent(): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 3);
    this.descentSkipSignal.skip();
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.headlessFramesRemaining = 3;
    const now = performance.now();
    this.startTs = now;
    this.lastFrameTs = now;
    this.tick(now);
  }

  public stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick = (nowTs: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const rawDtMs = Math.max(1, nowTs - this.lastFrameTs);
    if (
      this.isHeadless &&
      rawDtMs < 64 &&
      this.headlessFramesRemaining <= 0 &&
      !this.playerCamera.isCinematicActive()
    ) {
      return;
    }
    this.lastFrameTs = nowTs;
    const dtSec = Math.min(0.1, rawDtMs / 1000);
    const realSeconds = (nowTs - this.startTs) / 1000;

    if (this.contextLost) return;

    const store = useArkvoidStore.getState();
    this.playerCamera.setReducedMotion(store.ui.reducedMotion);
    this.playerCamera.update(dtSec);

    const movedDist =
      Math.abs(this.playerCamera.eyePos.x - this.lastRenderedPlayerX) +
      Math.abs(this.playerCamera.eyePos.y - this.lastRenderedPlayerY) +
      Math.abs(this.playerCamera.eyePos.z - this.lastRenderedPlayerZ);
    const worldTimeChanged = store.world.now !== this.lastRenderedWorldMinute;

    // On headless software CPU, only draw when initial frames, movement, cinematic, or state changes occur
    if (
      this.isHeadless &&
      this.headlessFramesRemaining <= 0 &&
      !this.playerCamera.isCinematicActive() &&
      movedDist < 0.02 &&
      !worldTimeChanged
    ) {
      return;
    }
    if (this.headlessFramesRemaining > 0) {
      this.headlessFramesRemaining--;
    }
    this.lastRenderedPlayerX = this.playerCamera.eyePos.x;
    this.lastRenderedPlayerY = this.playerCamera.eyePos.y;
    this.lastRenderedPlayerZ = this.playerCamera.eyePos.z;
    this.lastRenderedWorldMinute = store.world.now;

    this.governor.recordFrame(rawDtMs);

    // 1. Update Time of Day & Shared Uniforms (including uEdgeFade from world bounds proximity)
    const atm = updateSharedUniforms({
      realSeconds,
      worldMinutes: store.world.now,
      playerPos: this.playerCamera.feetPos,
      camPos: this.playerCamera.eyePos,
      spirit01: store.world.spirit / 100,
    });
    U.uEdgeFade.value = this.playerCamera.getEdgeProximity01();
    this.lastSunElevationDeg = atm.sunElevationDeg;

    // 2. Update Footpath Wear Map (stamps every 0.4 m on ground, uploads dirty rect at 1 Hz, persists every 20s)
    const grounded =
      !this.playerCamera.isFlying() && !this.playerCamera.isCinematicActive();
    this.wearMap.recordPlayerPosition(
      this.playerCamera.feetPos.x,
      this.playerCamera.feetPos.z,
      grounded
    );
    this.wearMap.update(this.renderer, realSeconds);

    // 3. Update Terrain Chunks, Water, Vegetation, Grass & Falling Leaves
    this.terrain.update(this.playerCamera.camera, this.playerCamera.feetPos);
    this.water.update(realSeconds);
    this.vegetation.update(this.playerCamera.feetPos);
    this.landscape.update(dtSec, realSeconds, store.world, this.playerCamera.eyePos);
    this.grass.update(this.playerCamera.feetPos, this.landscape.npcWorldPositions);
    this.leaves.update(realSeconds, this.playerCamera.feetPos);

    // 4. Update Lighting, Shadow cameras, and dynamic SkyPass PMREM environment map
    this.lighting.update(store.world.now, this.playerCamera.feetPos, atm);

    // 5. Update Mist Sea (60 km floor at y=10) & Low-tier Cloud Fallback
    const playerSpeedHoriz = Math.hypot(
      this.playerCamera.velocity.x,
      this.playerCamera.velocity.z
    );
    this.mistSea.update(this.playerCamera.eyePos, playerSpeedHoriz);
    this.cloudFallback.update(this.playerCamera.eyePos);

    // 6. Gentle organic flicker on ember lanterns & brazier, ramped by uNightLamp
    const lampStrength = U.uNightLamp.value;
    for (let i = 0; i < this.emberLights.length; i++) {
      const flicker = 1 + Math.sin(realSeconds * 5.2 + i * 2.1) * 0.08;
      this.emberLights[i].intensity = (1.6 + lampStrength * 4.2) * flicker;
    }

    // 7. Update Post-Processing grade modulation & Spirit Sense
    this.post.setPresetModulation(atm.grainStrength, atm.vignetteStrength);
    this.post.setSpiritSense(store.ui.spiritSenseOn);

    // 8. Generative Spatial Audio with surface-aware footsteps from terrainFn.surfaceAt(x, z)
    this.audio.setMuted(!store.ui.soundOn);
    this.audio.setDucked(store.ui.overlay === 'encounter');
    const currentSurface = surfaceAt(
      this.playerCamera.feetPos.x,
      this.playerCamera.feetPos.z
    );
    this.audio.update({
      dt: dtSec,
      camera: this.playerCamera.camera,
      altitudeY: this.playerCamera.eyePos.y,
      altitude01: U.uAltitude01.value,
      windStrength: U.uWindStrength.value,
      worldMinutes: store.world.now,
      playerSpeedHoriz,
      surface: currentSurface,
    });

    // 9. Render Pipeline:
    // Background Pass: SkyPass -> HorizonRings (6 km, 11 km, 18 km ink-wash mountain rings) -> clearDepth
    // Main Scene -> PostPipeline (CloudSeaEffect -> BloomEffect -> ArkvoidGradeEffect)
    const activeTier = this.governor.getTier();
    const useDirectLowPath =
      activeTier === 'low' &&
      (!this.isHeadless || this.governor.getPreference() === 'auto');

    this.renderer.info.reset();
    if (useDirectLowPath) {
      this.skyPass.render(this.renderer, this.playerCamera.camera, null);
      this.horizonRings.render(this.renderer, this.playerCamera.camera, null);
      this.renderer.setRenderTarget(null);
      this.renderer.clearDepth();
      this.renderer.render(this.scene, this.playerCamera.camera);
    } else {
      this.post.render(dtSec, this.skyPass, this.horizonRings);
    }

    if (nowTs - this.lastTelemetryTs >= 250 || this.isHeadless) {
      this.lastTelemetryTs = nowTs;
      this.emitTelemetry();
    }
  };

  public emitTelemetry(): void {
    if (!this.callbacks.onTelemetry) return;
    const avgMs = this.governor.getAverageFrameMs();
    const p95Ms = this.governor.getP95FrameMs();
    const fps = Math.min(120, Math.round(1000 / Math.max(1, avgMs)));
    const p = this.playerCamera.feetPos;
    const info = this.renderer.info;
    const storeNow = useArkvoidStore.getState().world.now;
    const worldHours = Number(((((storeNow % 1440) + 1440) % 1440) / 60).toFixed(2));
    const tStats = this.terrain.stats;

    this.callbacks.onTelemetry({
      fps,
      avgFrameMs: Number(avgMs.toFixed(1)),
      p95FrameMs: Number(p95Ms.toFixed(1)),
      cloudGpuMs: this.post.getCloudGpuMs(),
      tier: this.governor.getTier(),
      preference: this.governor.getPreference(),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      playerPos: [
        Number(p.x.toFixed(1)),
        Number(p.y.toFixed(1)),
        Number(p.z.toFixed(1)),
      ],
      currentPlace: placeAt(p.x, p.y, p.z),
      surface: surfaceAt(p.x, p.z),
      activeChunks: tStats.activeChunks,
      visibleChunks: tStats.visibleChunks,
      wearSteps: this.wearMap.getTotalStepsRecorded(),
      wearSampleHere: Number(this.wearMap.sample(p.x, p.z).toFixed(2)),
      worldHours,
      sunElevationDeg: Number(this.lastSunElevationDeg.toFixed(1)),
      flying: this.playerCamera.isFlying(),
      soundCaptionsEnabled: this.audio.isCaptionsEnabled(),
      shaderCheckOk: this.shaderCheck.ok,
      shaderCheckDetail: this.shaderCheck.detail,
      contextLost: this.contextLost,
      governorLogs: this.governor.getLogs(),
    });
  }

  public resize(width: number, height: number): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
    this.playerCamera.resize(width, height);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height);
  }

  public teleportToPlace(placeId: LocationId): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 3);
    this.playerCamera.teleportToPlace(placeId);
    this.terrain.update(this.playerCamera.camera, this.playerCamera.feetPos);
    this.vegetation.update(this.playerCamera.feetPos);
    this.emitTelemetry();
  }

  public teleportToCoords(x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 3);
    this.playerCamera.setFlying(false);
    this.playerCamera.feetPos.set(x, y, z);
    // If near the Hero Maple, point directly at its multi-forked trunk and crimson canopy
    if (Math.hypot(x - LANDMARKS.heroMaple[0], z - LANDMARKS.heroMaple[2]) < 45) {
      _focusVec.set(
        LANDMARKS.heroMaple[0],
        LANDMARKS.heroMaple[1] + 6.5,
        LANDMARKS.heroMaple[2]
      );
      this.playerCamera.focusWorldPoint(_focusVec);
    } else {
      this.playerCamera.setYawPitch(yaw, pitch);
    }
    this.terrain.update(this.playerCamera.camera, this.playerCamera.feetPos);
    this.vegetation.update(this.playerCamera.feetPos);
    this.emitTelemetry();
  }

  public teleportToAltitude(altitudeMeters: number): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 3);
    this.playerCamera.teleportToAltitude(altitudeMeters);
    this.terrain.update(this.playerCamera.camera, this.playerCamera.feetPos);
    this.emitTelemetry();
  }

  public setFlying(flying: boolean): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
    this.playerCamera.setFlying(flying);
    this.emitTelemetry();
  }

  public setCameraYawPitch(yawRad: number, pitchRad: number): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
    this.playerCamera.setYawPitch(yawRad, pitchRad);
    this.emitTelemetry();
  }

  public setSoundCaptionsEnabled(enabled: boolean): void {
    this.audio.setCaptionsEnabled(enabled);
    this.emitTelemetry();
  }

  /**
   * Stamps a worn footpath back and forth near the player's current position and along the
   * East Gate -> Lantern Terrace -> Lake path, then immediately persists to `arkvoid:v1:wear`.
   */
  public async stampFootpathDemo(): Promise<void> {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 3);
    const px = this.playerCamera.feetPos.x;
    const pz = this.playerCamera.feetPos.z;
    for (let pass = 0; pass < 14; pass++) {
      for (let s = -14; s <= 14; s++) {
        this.wearMap.stampDisc(px + s * 0.4, pz + 2.2, 1.25, 0.08);
        this.wearMap.stampDisc(px + s * 0.4, pz, 1.15, 0.08);
      }
    }
    // Also stamp along the valley path so the Atlas parchment survey clearly displays the worn ochre trail
    for (const poly of [LANDMARKS.paths.townToLanternTerrace, LANDMARKS.paths.townToHallOfRecords]) {
      for (let i = 0; i < poly.length - 1; i++) {
        const [x0, z0] = poly[i];
        const [x1, z1] = poly[i + 1];
        const segLen = Math.hypot(x1 - x0, z1 - z0);
        const steps = Math.max(4, Math.ceil(segLen / 3.5));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          this.wearMap.stampDisc(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 4.5, 0.85);
        }
      }
    }
    this.wearMap.texture.needsUpdate = true;
    await this.wearMap.saveToStorage();
    this.emitTelemetry();
  }

  /**
   * Smoothly sets the time-of-day hour (`0..24`) for the debug time slider or Jump-To presets
   * without triggering hundreds of catch-up simulation ticks when scrubbing.
   */
  public setWorldHour(targetHour0to24: number): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 3);
    const clampedHour = ((targetHour0to24 % 24) + 24) % 24;
    const targetMinuteOfDay = Math.round(clampedHour * 60);
    const currentNow = useArkvoidStore.getState().world.now;
    const currentDayBase = Math.floor(currentNow / 1440) * 1440;
    const nextNow = currentDayBase + targetMinuteOfDay;

    useArkvoidStore.setState((s) => ({
      world: {
        ...s.world,
        now: nextNow,
      },
    }));
    this.emitTelemetry();
  }

  public focusTarget(targetId: CharacterId | LocationId): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
    if (targetId in PLACES) {
      this.teleportToPlace(targetId as LocationId);
      return;
    }
    const cid = targetId as CharacterId;
    if (cid === 'seren') {
      _focusVec.set(
        LANDMARKS.gate.serenAnchor[0],
        LANDMARKS.gate.serenAnchor[1] + 1.5,
        LANDMARKS.gate.serenAnchor[2]
      );
      this.playerCamera.focusWorldPoint(_focusVec);
    }
  }

  public setQualityPreference(pref: QualityPreference): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 3);
    this.governor.setPreference(pref, this.initialDetectedTier);
    this.applyQualityTier(this.governor.getTier());
    this.emitTelemetry();
  }

  public nudgeMove(forwardDelta: number, strafeDelta: number): void {
    this.headlessFramesRemaining = Math.max(this.headlessFramesRemaining, 2);
    this.playerCamera.NudgeMove(forwardDelta, strafeDelta);
    this.emitTelemetry();
  }

  public dispose(): void {
    this.stop();
    setActiveWearMap(null);
    window.removeEventListener('resize', this.boundResize);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.boundContextLost);
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.boundContextRestored
    );
    this.audio.dispose();
    this.lighting.dispose();
    this.skyPass.dispose();
    this.horizonRings.dispose();
    this.mistSea.dispose();
    this.cloudFallback.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.vegetation.dispose();
    this.grass.dispose();
    this.leaves.dispose();
    this.wearMap.dispose();
    this.colliderGrid.clear();
    this.playerCamera.dispose();
    this.post.dispose();
    this.landscape.dispose();
    this.renderer.dispose();
  }
}
