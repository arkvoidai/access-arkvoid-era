import * as THREE from 'three';
import { SISTER } from '../../world/bible.ts';
import { QUALITY, type QualityTier } from '../Quality.ts';
import { U } from '../uniforms.ts';
import { SkyPass } from './SkyPass.ts';
import type { BlendedAtmosphere } from './timeOfDay.ts';

const _sisterCenter = new THREE.Vector3(
  SISTER.center[0],
  SISTER.center[1],
  SISTER.center[2]
);
const _sisterDir = new THREE.Vector3();
const _lightDir = new THREE.Vector3();
const _snappedFocus = new THREE.Vector3();

/**
 * Manages the Sun/Sister DirectionalLight, Near texel-snapped shadow camera,
 * Far mountain shadow camera (`high` tier, layer 2), HemisphereLight,
 * and dynamic SkyPass -> CubeRenderTarget -> PMREM environment map.
 */
export class WorldLighting {
  public readonly sunLight: THREE.DirectionalLight;
  public readonly farSunLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly sunShaftMesh: THREE.Mesh;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly skyPass: SkyPass;
  private readonly isHeadless: boolean;

  private pmremGenerator: THREE.PMREMGenerator | null = null;
  private cubeRenderTarget: THREE.WebGLCubeRenderTarget | null = null;
  private cubeCamera: THREE.CubeCamera | null = null;
  private envMapTexture: THREE.Texture | null = null;
  private lastEnvUpdateMinutes = -99999;
  private currentTier: QualityTier = 'mid';

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    skyPass: SkyPass,
    initialTier: QualityTier,
    isHeadless = false
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.skyPass = skyPass;
    this.currentTier = initialTier;
    this.isHeadless = isHeadless;

    // 1. Hemisphere Light (driven by preset hemiSky / hemiGround / hemiIntensity)
    this.hemiLight = new THREE.HemisphereLight('#BFA595', '#6E5A4E', 0.60);
    this.scene.add(this.hemiLight);

    // 2. Primary Sun / Sister Directional Light + Near Orthographic Shadow (160 m wide)
    this.sunLight = new THREE.DirectionalLight('#FF9552', 2.2);
    this.sunLight.position.set(110, 195, -90);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const nearCam = this.sunLight.shadow.camera;
    nearCam.near = 10;
    nearCam.far = 420;
    nearCam.left = -80;
    nearCam.right = 80;
    nearCam.top = 80;
    nearCam.bottom = -80;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.024;

    // 3. Far Mountain Directional Light (`high` tier only, 700 m frustum, 1024 px map, layer 2)
    this.farSunLight = new THREE.DirectionalLight('#FF9552', 0.0);
    this.farSunLight.layers.disableAll();
    this.farSunLight.layers.enable(2);
    const farCam = this.farSunLight.shadow.camera;
    farCam.near = 20;
    farCam.far = 1400;
    farCam.left = -350;
    farCam.right = 350;
    farCam.top = 350;
    farCam.bottom = -350;
    this.farSunLight.shadow.mapSize.set(1024, 1024);
    this.farSunLight.shadow.bias = -0.0008;
    this.farSunLight.shadow.normalBias = 0.05;
    this.scene.add(this.farSunLight);
    this.scene.add(this.farSunLight.target);

    // 4. Small sun emitter mesh placed far along `sunDir` for optional GodRays / sun shaft reference
    const shaftGeo = new THREE.SphereGeometry(95, 16, 12);
    const shaftMat = new THREE.MeshBasicMaterial({
      color: '#FFF0D2',
      fog: false,
      depthWrite: false,
    });
    this.sunShaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
    this.sunShaftMesh.frustumCulled = false;
    this.sunShaftMesh.visible = false;
    this.scene.add(this.sunShaftMesh);

    if (!this.isHeadless) {
      try {
        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.pmremGenerator.compileCubemapShader();
        this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(64, {
          format: THREE.RGBAFormat,
          type: THREE.HalfFloatType,
        });
        this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeRenderTarget);
      } catch {
        // Fallback to hemisphere light if cubemap target fails
      }
    }

    this.applyQualityTier(initialTier);
  }

  public applyQualityTier(tier: QualityTier): void {
    this.currentTier = tier;
    const cfg = QUALITY[tier];

    const shadowsEnabled = !this.isHeadless && cfg.shadowNearSize > 0;
    this.renderer.shadowMap.enabled = shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.sunLight.castShadow = shadowsEnabled;
    if (shadowsEnabled && this.sunLight.shadow.mapSize.width !== cfg.shadowNearSize) {
      this.sunLight.shadow.mapSize.set(cfg.shadowNearSize, cfg.shadowNearSize);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }

    const farShadowsActive = !this.isHeadless && tier === 'high' && cfg.shadowFarSize > 0;
    this.farSunLight.castShadow = farShadowsActive;
    this.farSunLight.visible = farShadowsActive;

    if (tier === 'low') {
      this.scene.environment = null;
    } else {
      // Force an environment refresh on tier upgrade
      this.lastEnvUpdateMinutes = -99999;
    }
  }

  public update(
    worldMinutes: number,
    playerPos: THREE.Vector3,
    atm: BlendedAtmosphere
  ): void {
    // Update Hemisphere Light from preset
    this.hemiLight.color.copy(atm.hemiSky);
    this.hemiLight.groundColor.copy(atm.hemiGround);
    this.hemiLight.intensity = atm.hemiIntensity;

    // Compute Sister direction and lit fraction
    _sisterDir.copy(_sisterCenter).sub(playerPos).normalize();
    const sisterLitFraction = THREE.MathUtils.clamp(
      0.55 + 0.45 * _sisterDir.dot(atm.sunDir),
      0.35,
      1.0
    );

    // At night the light becomes the Sister light: direction from planet centre, #D9CDBA, 0.45 * litFraction
    if (atm.nightWeight > 0.5) {
      _lightDir.copy(atm.sunDir).lerp(_sisterDir, atm.nightWeight).normalize();
      this.sunLight.color.set('#D9CDBA');
      this.sunLight.intensity = 0.45 * sisterLitFraction;

      // Shadows off at night on mid and low tiers
      const allowNightShadow =
        !this.isHeadless &&
        this.currentTier === 'high' &&
        QUALITY[this.currentTier].shadowNearSize > 0;
      this.sunLight.castShadow = allowNightShadow;
    } else {
      _lightDir.copy(atm.sunDir);
      this.sunLight.color.copy(atm.sunColor);
      this.sunLight.intensity = atm.sunIntensity;
      this.sunLight.castShadow =
        !this.isHeadless && QUALITY[this.currentTier].shadowNearSize > 0;
    }

    // Snap near shadow camera target to shadow-map texel increments so shadows never shimmer
    const mapSize = Math.max(512, QUALITY[this.currentTier].shadowNearSize || 1024);
    const frustumWidth = 160;
    const texelSize = frustumWidth / mapSize;

    _snappedFocus.set(
      Math.round(playerPos.x / texelSize) * texelSize,
      Math.round(playerPos.y / texelSize) * texelSize,
      Math.round(playerPos.z / texelSize) * texelSize
    );

    this.sunLight.target.position.copy(_snappedFocus);
    this.sunLight.position.copy(_snappedFocus).addScaledVector(_lightDir, 180);
    this.sunLight.target.updateMatrixWorld();

    if (this.farSunLight.visible) {
      const farTexel = 700 / 1024;
      this.farSunLight.target.position.set(
        Math.round(playerPos.x / farTexel) * farTexel,
        140,
        Math.round(playerPos.z / farTexel) * farTexel
      );
      this.farSunLight.position
        .copy(this.farSunLight.target.position)
        .addScaledVector(_lightDir, 520);
      this.farSunLight.target.updateMatrixWorld();
    }

    // Position distant sun mesh along sunDir for sun shafts
    this.sunShaftMesh.position.copy(playerPos).addScaledVector(atm.sunDir, 6500);
    (this.sunShaftMesh.material as THREE.MeshBasicMaterial).color.copy(atm.sunColor);

    // Refresh PMREM environment map when world time moves by 4 min on high, 15 min on mid, never on low
    if (!this.isHeadless && this.currentTier !== 'low' && this.pmremGenerator && this.cubeCamera && this.cubeRenderTarget) {
      const thresholdMinutes = this.currentTier === 'high' ? 4 : 15;
      if (Math.abs(worldMinutes - this.lastEnvUpdateMinutes) >= thresholdMinutes) {
        this.lastEnvUpdateMinutes = worldMinutes;
        this.refreshEnvironmentMap();
      }
    }
  }

  private refreshEnvironmentMap(): void {
    if (!this.pmremGenerator || !this.cubeCamera || !this.cubeRenderTarget) return;
    try {
      // Render SkyPass into each face of the cube camera
      for (let i = 0; i < 6; i++) {
        const faceCam = this.cubeCamera.children[i] as THREE.PerspectiveCamera;
        this.skyPass.syncCamera(faceCam);
        this.renderer.setRenderTarget(this.cubeRenderTarget, i);
        this.renderer.render(this.skyPass.scene, this.skyPass.camera);
      }
      this.renderer.setRenderTarget(null);

      const nextEnv = this.pmremGenerator.fromCubemap(this.cubeRenderTarget.texture).texture;
      const prevEnv = this.envMapTexture;
      this.envMapTexture = nextEnv;
      this.scene.environment = nextEnv;
      this.scene.environmentIntensity = 0.55;
      prevEnv?.dispose();
    } catch {
      // Keep existing environment map on transient context state
    }
  }

  public dispose(): void {
    this.sunShaftMesh.geometry.dispose();
    (this.sunShaftMesh.material as THREE.Material).dispose();
    this.envMapTexture?.dispose();
    this.cubeRenderTarget?.dispose();
    this.pmremGenerator?.dispose();
  }
}
