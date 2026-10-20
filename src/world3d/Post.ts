import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
} from 'postprocessing';
import * as THREE from 'three';
import { QUALITY, type QualityTier } from './Quality.ts';
import { CloudSeaEffect } from './sky/CloudSeaEffect.ts';
import type { SkyPass } from './sky/SkyPass.ts';
import type { HorizonRings } from './terrain/HorizonRings.ts';
import { U } from './uniforms.ts';

const ARKVOID_GRADE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uEmber;
uniform float uGrainStrength;
uniform float uVignetteStrength;
uniform float uSpiritSense;

float arkHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = max(vec3(0.0), inputColor.rgb);

  // 1. INK AND EMBER PALETTE ENFORCEMENT
  // Suppress cool blue/teal cast: any excess blue over red/green is warmed toward ivory/ochre
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float emberMask = smoothstep(0.08, 0.35, col.r - col.g * 0.65) * smoothstep(0.05, 0.35, col.r - col.b);
  float violetMask = smoothstep(0.06, 0.25, col.b - col.g) * smoothstep(0.05, 0.25, col.r - col.g);

  // Warm monochrome paper-and-ink base
  vec3 inkShadow = vec3(0.11, 0.085, 0.07);     // warm brown-black ink, never blue-black
  vec3 midOchre  = vec3(0.68, 0.59, 0.47);      // warm parchment & olive-ochre stone
  vec3 ivoryHigh = vec3(0.99, 0.94, 0.85);      // pale gold & warm ivory light

  vec3 monoRamp = mix(
    mix(inkShadow, midOchre, smoothstep(0.0, 0.48, luma)),
    ivoryHigh,
    smoothstep(0.42, 1.0, luma)
  );

  // Blend original colour with warm monochrome ramp, preserving ember orange & rare violet
  float preserveAccent = clamp(emberMask * 0.88 + violetMask * 0.65, 0.0, 0.95);
  vec3 graded = mix(mix(col, monoRamp, 0.28), col, preserveAccent);

  // Enrich ember orange highlights slightly
  graded += vec3(0.98, 0.34, 0.03) * emberMask * (0.08 + uEmber * 0.06);

  // Ensure blue channel never exceeds warm balance outside sealed violet
  float maxAllowedBlue = mix(graded.g * 0.94 + 0.02, graded.b, violetMask);
  graded.b = min(graded.b, maxAllowedBlue);

  // 2. SPIRIT SENSE MODE (toggled via V): subtle violet-ember resonance pulse on edges
  if (uSpiritSense > 0.001) {
    float distCenter = length(uv - 0.5);
    float ring = smoothstep(0.48, 0.2, distCenter);
    vec3 senseTint = mix(vec3(0.29, 0.11, 0.59), vec3(0.98, 0.34, 0.03), emberMask);
    graded = mix(graded, graded + senseTint * 0.16, uSpiritSense * ring);
  }

  // 3. SOFT OPTICAL VIGNETTE (warm ink frame)
  vec2 centered = uv - 0.5;
  float vigDist = dot(centered * vec2(1.15, 1.0), centered * vec2(1.15, 1.0));
  float vig = smoothstep(0.18, 0.78, vigDist) * uVignetteStrength;
  graded = mix(graded, inkShadow * 0.65, vig);

  // 4. SUBTLE FILM / PAPER GRAIN
  if (uGrainStrength > 0.0001) {
    float n = arkHash(uv * 1024.0 + fract(uTime * 7.13) * 100.0) - 0.5;
    graded += n * uGrainStrength * (1.0 - smoothstep(0.85, 1.0, luma) * 0.5);
  }

  outputColor = vec4(clamp(graded, 0.0, 1.0), inputColor.a);
}
`;

export class ArkvoidGradeEffect extends Effect {
  private grainEnabled = true;
  private baseGrain = 0.018;

  constructor() {
    super('ArkvoidGradeEffect', ARKVOID_GRADE_FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform<number>>([
        ['uTime', new THREE.Uniform(0)],
        ['uEmber', new THREE.Uniform(0.35)],
        ['uGrainStrength', new THREE.Uniform(0.018)],
        ['uVignetteStrength', new THREE.Uniform(0.32)],
        ['uSpiritSense', new THREE.Uniform(0)],
      ]),
    });
  }

  public override update(
    _renderer: THREE.WebGLRenderer,
    _inputBuffer: THREE.WebGLRenderTarget,
    _deltaTime?: number
  ): void {
    const timeUniform = this.uniforms.get('uTime');
    if (timeUniform) timeUniform.value = U.uTime.value;
    const emberUniform = this.uniforms.get('uEmber');
    if (emberUniform) emberUniform.value = U.uEmber.value;
  }

  public setGrainEnabled(enabled: boolean): void {
    this.grainEnabled = enabled;
    const u = this.uniforms.get('uGrainStrength');
    if (u) u.value = enabled ? this.baseGrain : 0.0;
  }

  public setPresetModulation(grainStrength: number, vignetteStrength: number): void {
    this.baseGrain = grainStrength;
    const ug = this.uniforms.get('uGrainStrength');
    if (ug) ug.value = this.grainEnabled ? grainStrength : 0.0;
    const uv = this.uniforms.get('uVignetteStrength');
    if (uv) uv.value = vignetteStrength;
  }

  public setSpiritSense(active: boolean): void {
    const u = this.uniforms.get('uSpiritSense');
    if (u) u.value = active ? 1.0 : 0.0;
  }
}

/**
 * Post-processing pipeline managing `EffectComposer`, `CloudSeaEffect` (placed BEFORE bloom and tone mapping),
 * restrained ember `BloomEffect`, and the signature `ArkvoidGradeEffect` colour grade.
 */
export class PostPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private cloudSeaEffect: CloudSeaEffect;
  private cloudPass: EffectPass;
  private bloomEffect: BloomEffect;
  private gradeEffect: ArkvoidGradeEffect;
  private bloomAndGradePass: EffectPass;
  private gradeOnlyPass: EffectPass;
  private activeTier: QualityTier;

  // WebGL2 EXT_disjoint_timer_query_webgl2 support for CloudSeaEffect GPU timing
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private pendingQuery: WebGLQuery | null = null;
  private lastCloudGpuMs: number | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    initialTier: QualityTier
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.activeTier = initialTier;

    const cfg = QUALITY[initialTier];
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: cfg.msaa,
    });

    this.renderPass = new RenderPass(scene, camera);
    // SkyPass draws the background first; RenderPass clears depth only and draws the 3D scene on top
    this.renderPass.clear = false;
    this.composer.addPass(this.renderPass);

    // Volumetric Cloud Sea Effect placed BEFORE bloom and tone mapping/grading
    this.cloudSeaEffect = new CloudSeaEffect(camera, initialTier);
    this.cloudPass = new EffectPass(camera, this.cloudSeaEffect);

    // Restrained ember bloom — high threshold so only lanterns, braziers, and sun rim glow
    this.bloomEffect = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      luminanceThreshold: 0.78,
      luminanceSmoothing: 0.22,
      intensity: 0.45,
      mipmapBlur: true,
    });

    this.gradeEffect = new ArkvoidGradeEffect();
    this.gradeEffect.setGrainEnabled(cfg.post.grain);

    this.bloomAndGradePass = new EffectPass(camera, this.bloomEffect, this.gradeEffect);
    this.gradeOnlyPass = new EffectPass(camera, this.gradeEffect);

    try {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) {
        this.timerExt = ext;
      }
    } catch {
      // Optional extension
    }

    this.applyTierPasses(initialTier);
  }

  private applyTierPasses(tier: QualityTier): void {
    this.activeTier = tier;
    const cfg = QUALITY[tier];
    this.gradeEffect.setGrainEnabled(cfg.post.grain);
    this.cloudSeaEffect.setTier(tier);

    while (this.composer.passes.length > 1) {
      const p = this.composer.passes[this.composer.passes.length - 1];
      this.composer.removePass(p);
    }

    if (tier !== 'low' && cfg.cloudSteps > 0) {
      this.composer.addPass(this.cloudPass);
    }

    if (cfg.post.bloom) {
      this.composer.addPass(this.bloomAndGradePass);
    } else {
      this.composer.addPass(this.gradeOnlyPass);
    }
  }

  public setQuality(tier: QualityTier): void {
    if (tier === this.activeTier) return;
    this.applyTierPasses(tier);
  }

  public setPresetModulation(grainStrength: number, vignetteStrength: number): void {
    this.gradeEffect.setPresetModulation(grainStrength, vignetteStrength);
  }

  public setSpiritSense(active: boolean): void {
    this.gradeEffect.setSpiritSense(active);
  }

  public getCloudGpuMs(): number | null {
    return this.lastCloudGpuMs;
  }

  public setSize(width: number, height: number): void {
    const cfg = QUALITY[this.activeTier];
    const scaledW = Math.max(1, Math.floor(width * cfg.renderScale));
    const scaledH = Math.max(1, Math.floor(height * cfg.renderScale));
    this.composer.setSize(scaledW, scaledH, false);
  }

  public render(dt: number, skyPass: SkyPass, horizonRings?: HorizonRings): void {
    // 1. Render SkyPass + HorizonRings into composer.inputBuffer (no depth write), then clear depth
    skyPass.render(this.renderer, this.camera, this.composer.inputBuffer);
    horizonRings?.render(this.renderer, this.camera, this.composer.inputBuffer);
    this.renderer.setRenderTarget(this.composer.inputBuffer);
    this.renderer.clearDepth();

    // 2. Poll optional WebGL2 GPU timer query for cloud pass
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (this.timerExt && this.pendingQuery) {
      const available = gl.getQueryParameter(this.pendingQuery, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
      if (available && !disjoint) {
        const ns = gl.getQueryParameter(this.pendingQuery, gl.QUERY_RESULT) as number;
        this.lastCloudGpuMs = Number((ns / 1e6).toFixed(2));
        gl.deleteQuery(this.pendingQuery);
        this.pendingQuery = null;
      } else if (available && disjoint) {
        gl.deleteQuery(this.pendingQuery);
        this.pendingQuery = null;
      }
    }

    const measureGpu =
      this.timerExt !== null &&
      this.pendingQuery === null &&
      QUALITY[this.activeTier].cloudSteps > 0;

    if (measureGpu && this.timerExt) {
      const q = gl.createQuery();
      if (q) {
        this.pendingQuery = q;
        gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q);
      }
    }

    this.composer.render(dt);

    if (measureGpu && this.timerExt && this.pendingQuery) {
      gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    }
  }

  public dispose(): void {
    this.cloudPass.dispose();
    this.cloudSeaEffect.dispose();
    this.bloomAndGradePass.dispose();
    this.gradeOnlyPass.dispose();
    this.bloomEffect.dispose();
    this.gradeEffect.dispose();
    this.composer.dispose();
  }
}
