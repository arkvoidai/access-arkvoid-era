import * as THREE from 'three';
import type { LocationId } from '../engine/types.ts';
import {
  EYE_HEIGHT,
  GLIDE,
  LANDMARKS,
  PLACES,
  RUN,
  SISTER,
  WALK,
  WORLD,
  placeAt,
} from '../world/bible.ts';
import { heightAt, waterLevelAt } from '../world/terrainFn.ts';
import type { ColliderGrid } from './life/Colliders.ts';

// Pre-allocated scratch vectors for zero-GC per-frame updates
const _forward = new THREE.Vector3();
const _flatForward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wishDir = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _resolvedXZ = { x: 0, z: 0 };

export interface PlayerCameraOptions {
  domElement: HTMLElement;
  reducedMotion?: boolean;
  colliderGrid?: ColliderGrid;
  onPlaceChanged?: (place: LocationId) => void;
  onCanvasTap?: (ndcX: number, ndcY: number) => void;
  onEdgeWarning?: () => void;
}

export class PlayerCamera {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly feetPos = new THREE.Vector3(
    LANDMARKS.gate.playerSpawn[0],
    LANDMARKS.gate.playerSpawn[1],
    LANDMARKS.gate.playerSpawn[2]
  );
  public readonly eyePos = new THREE.Vector3();
  public readonly velocity = new THREE.Vector3();

  private yaw = 0; // 0 rad = +X (East)
  private pitch = 0.04; // slight upward gaze toward the East Gate arch & Sister planet
  private targetYaw = 0;
  private targetPitch = 0.04;
  private walkBobPhase = 0;
  private reducedMotion = false;
  private currentPlace: LocationId = 'east-gate';
  private flyingMode = false;
  private cinematicActive = false;

  private keysDown = new Set<string>();
  private isDraggingLook = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private touchMoveVec = new THREE.Vector2();
  private moveTouchId: number | null = null;
  private lookTouchId: number | null = null;
  private moveTouchOrigin = new THREE.Vector2();

  private domElement: HTMLElement;
  private colliderGrid?: ColliderGrid;
  private onPlaceChanged?: (place: LocationId) => void;
  private onCanvasTap?: (ndcX: number, ndcY: number) => void;
  private onEdgeWarning?: () => void;
  private edgeProximity = 0;
  private lastEdgeWarningTime = -999;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundBlur: () => void;
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;

  constructor(aspect: number, options: PlayerCameraOptions) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.25, 65000);
    this.domElement = options.domElement;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.colliderGrid = options.colliderGrid;
    this.onPlaceChanged = options.onPlaceChanged;
    this.onCanvasTap = options.onCanvasTap;
    this.onEdgeWarning = options.onEdgeWarning;

    const [sx, , sz] = LANDMARKS.gate.playerSpawn;
    const groundY = heightAt(sx, sz);
    this.feetPos.set(sx, groundY, sz);
    this.applyLookVector(LANDMARKS.gate.playerFacing, true);
    this.syncCameraTransform(0);

    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundBlur = () => this.keysDown.clear();
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);

    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('blur', this.boundBlur);
    this.domElement.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointerup', this.boundPointerUp);
    this.domElement.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    this.domElement.addEventListener('touchmove', this.boundTouchMove, { passive: true });
    this.domElement.addEventListener('touchend', this.boundTouchEnd, { passive: true });
  }

  public setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  public isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  public isFlying(): boolean {
    return this.flyingMode;
  }

  public setFlying(flying: boolean): void {
    this.flyingMode = flying;
    if (!flying) {
      this.feetPos.y = heightAt(this.feetPos.x, this.feetPos.z);
      this.syncCameraTransform(0);
    }
  }

  public getEdgeProximity01(): number {
    return this.edgeProximity;
  }

  public teleportToAltitude(altitudeMeters: number): void {
    this.flyingMode = true;
    this.feetPos.y = Math.max(20, altitudeMeters);
    this.velocity.set(0, 0, 0);
    // Look toward the Sister & horizon so cloud sea and planet are in frame
    if (altitudeMeters >= 1500) {
      const dx = SISTER.center[0] - this.feetPos.x;
      const dy = SISTER.center[1] * 0.45 - this.feetPos.y;
      const dz = SISTER.center[2] - this.feetPos.z;
      this.applyLookVector([dx, dy, dz], true);
    } else {
      this.targetPitch = -0.14;
      this.pitch = -0.14;
    }
    this.syncCameraTransform(0);
  }

  public setCinematicPose(
    pos: THREE.Vector3,
    lookAt: THREE.Vector3,
    fov: number,
    rollRad = 0
  ): void {
    this.cinematicActive = true;
    this.eyePos.copy(pos);
    this.feetPos.set(pos.x, Math.max(0, pos.y - EYE_HEIGHT), pos.z);
    this.camera.position.copy(pos);
    this.camera.up.set(Math.sin(rollRad), Math.cos(rollRad), 0).normalize();
    this.camera.lookAt(lookAt);

    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Keep yaw & pitch synced to cinematic look direction so exit is seamless
    const dx = lookAt.x - pos.x;
    const dy = lookAt.y - pos.y;
    const dz = lookAt.z - pos.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    this.yaw = Math.atan2(dz, dx);
    this.targetYaw = this.yaw;
    this.pitch = THREE.MathUtils.clamp(Math.asin(dy / dist), -1.1, 1.1);
    this.targetPitch = this.pitch;
  }

  public exitCinematicPose(): void {
    this.cinematicActive = false;
    this.camera.up.set(0, 1, 0);
    if (Math.abs(this.camera.fov - 58) > 0.05) {
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
    }
    if (!this.flyingMode) {
      this.feetPos.y = heightAt(this.feetPos.x, this.feetPos.z);
    }
    this.syncCameraTransform(0);
  }

  public isCinematicActive(): boolean {
    return this.cinematicActive;
  }

  private applyLookVector(look: readonly [number, number, number], immediate = false): void {
    const [lx, ly, lz] = look;
    const len = Math.hypot(lx, ly, lz) || 1;
    const nx = lx / len;
    const ny = THREE.MathUtils.clamp(ly / len, -0.85, 0.85);
    const nz = lz / len;
    this.targetYaw = Math.atan2(nz, nx);
    this.targetPitch = Math.asin(ny) + 0.04;
    if (immediate) {
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
    }
  }

  public teleportToPlace(placeId: LocationId): void {
    const def = PLACES[placeId];
    if (!def) return;
    const [ax, ay, az] = def.anchor;
    this.currentPlace = placeId;
    this.flyingMode = placeId === 'sky-realms' || placeId === 'open-cosmos';

    if (this.flyingMode) {
      this.feetPos.set(ax, ay, az);
    } else {
      const gy = heightAt(ax, az);
      this.feetPos.set(ax, gy, az);
    }
    this.velocity.set(0, 0, 0);
    this.applyLookVector(def.look, true);
    this.syncCameraTransform(0);
  }

  public focusWorldPoint(target: THREE.Vector3): void {
    const dx = target.x - this.eyePos.x;
    const dy = target.y - this.eyePos.y;
    const dz = target.z - this.eyePos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return;
    this.targetYaw = Math.atan2(dz, dx);
    this.targetPitch = THREE.MathUtils.clamp(Math.asin(dy / dist), -1.1, 1.1);
  }

  public setYawPitch(yawRad: number, pitchRad: number): void {
    this.yaw = yawRad;
    this.targetYaw = yawRad;
    this.pitch = THREE.MathUtils.clamp(pitchRad, -1.15, 1.15);
    this.targetPitch = this.pitch;
    this.syncCameraTransform(0);
  }

  public NudgeMove(forwardDelta: number, strafeDelta: number): void {
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    this.feetPos.x += cosY * forwardDelta - sinY * strafeDelta;
    this.feetPos.z += sinY * forwardDelta + cosY * strafeDelta;
    this.clampWorldBounds();
    if (!this.flyingMode) {
      this.feetPos.y = heightAt(this.feetPos.x, this.feetPos.z);
    }
    this.syncCameraTransform(0);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (
      e.target instanceof HTMLElement &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
    ) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    this.keysDown.add(e.key.toLowerCase());
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.key.toLowerCase());
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    this.isDraggingLook = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.isDraggingLook || e.pointerType === 'touch') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    const sensitivity = 0.0032;
    this.targetYaw += dx * sensitivity;
    this.targetPitch = THREE.MathUtils.clamp(
      this.targetPitch - dy * sensitivity,
      -1.15,
      1.15
    );
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.isDraggingLook || e.pointerType === 'touch') return;
    this.isDraggingLook = false;
    const moved = Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY);
    if (moved < 6 && this.onCanvasTap) {
      const rect = this.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.onCanvasTap(ndcX, ndcY);
      }
    }
  }

  private handleTouchStart(e: TouchEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    const midX = rect.left + rect.width * 0.5;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < midX && this.moveTouchId === null) {
        this.moveTouchId = t.identifier;
        this.moveTouchOrigin.set(t.clientX, t.clientY);
        this.touchMoveVec.set(0, 0);
      } else if (this.lookTouchId === null) {
        this.lookTouchId = t.identifier;
        this.lastPointerX = t.clientX;
        this.lastPointerY = t.clientY;
      }
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.moveTouchId) {
        const dx = (t.clientX - this.moveTouchOrigin.x) / 48;
        const dy = (this.moveTouchOrigin.y - t.clientY) / 48;
        this.touchMoveVec.set(
          THREE.MathUtils.clamp(dx, -1, 1),
          THREE.MathUtils.clamp(dy, -1, 1)
        );
      } else if (t.identifier === this.lookTouchId) {
        const dx = t.clientX - this.lastPointerX;
        const dy = t.clientY - this.lastPointerY;
        this.lastPointerX = t.clientX;
        this.lastPointerY = t.clientY;
        this.targetYaw += dx * 0.004;
        this.targetPitch = THREE.MathUtils.clamp(
          this.targetPitch - dy * 0.004,
          -1.1,
          1.1
        );
      }
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.moveTouchId) {
        this.moveTouchId = null;
        this.touchMoveVec.set(0, 0);
      } else if (t.identifier === this.lookTouchId) {
        this.lookTouchId = null;
      }
    }
  }

  private clampWorldBounds(): void {
    if (this.feetPos.x > 5800 && this.feetPos.z > 5800) {
      return;
    }
    this.feetPos.x = THREE.MathUtils.clamp(this.feetPos.x, WORLD.minX, WORLD.maxX);
    this.feetPos.z = THREE.MathUtils.clamp(this.feetPos.z, WORLD.minZ, WORLD.maxZ);
  }

  public update(dt: number): void {
    if (this.cinematicActive) return;

    const safeDt = Math.min(0.1, Math.max(0.001, dt));

    // Smoothly damp look angles
    const lookAlpha = 1 - Math.exp(-16 * safeDt);
    this.yaw += (this.targetYaw - this.yaw) * lookAlpha;
    this.pitch += (this.targetPitch - this.pitch) * lookAlpha;

    // Gather movement input
    let moveFwd = this.touchMoveVec.y;
    let moveRight = this.touchMoveVec.x;
    let moveUp = 0;

    if (this.keysDown.has('w') || this.keysDown.has('arrowup')) moveFwd += 1;
    if (this.keysDown.has('s') || this.keysDown.has('arrowdown')) moveFwd -= 1;
    if (this.keysDown.has('d') || this.keysDown.has('arrowright')) moveRight += 1;
    if (this.keysDown.has('a') || this.keysDown.has('arrowleft')) moveRight -= 1;
    if (this.flyingMode) {
      if (this.keysDown.has(' ') || this.keysDown.has('r')) moveUp += 1;
      if (this.keysDown.has('c') || this.keysDown.has('f')) moveUp -= 1;
    }

    // Check water depth at current position for wading slowdown
    let wadingFactor = 1.0;
    if (!this.flyingMode) {
      const curWl = waterLevelAt(this.feetPos.x, this.feetPos.z);
      if (curWl !== null) {
        const curDepth = curWl - heightAt(this.feetPos.x, this.feetPos.z);
        if (curDepth > 0.05) {
          wadingFactor = 0.58;
        }
      }
    }

    const isRunning = this.keysDown.has('shift');
    const speed =
      (this.flyingMode ? (isRunning ? GLIDE * 4 : GLIDE * 1.5) : isRunning ? RUN : WALK) *
      wadingFactor;

    _flatForward.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    _right.set(-Math.sin(this.yaw), 0, Math.cos(this.yaw));

    _wishDir
      .set(0, 0, 0)
      .addScaledVector(_flatForward, moveFwd)
      .addScaledVector(_right, moveRight);
    if (_wishDir.lengthSq() > 1) {
      _wishDir.normalize();
    }
    _wishDir.multiplyScalar(speed);

    const velAlpha = 1 - Math.exp(-10 * safeDt);
    this.velocity.x += (_wishDir.x - this.velocity.x) * velAlpha;
    this.velocity.z += (_wishDir.z - this.velocity.z) * velAlpha;

    if (this.flyingMode) {
      const pitchLift = moveFwd * Math.sin(this.pitch) * speed;
      const targetVy = moveUp * speed + pitchLift;
      this.velocity.y += (targetVy - this.velocity.y) * velAlpha;
      this.feetPos.y = THREE.MathUtils.clamp(
        this.feetPos.y + this.velocity.y * safeDt,
        15,
        8500
      );
    } else {
      this.velocity.y = 0;
    }

    const prevX = this.feetPos.x;
    const prevZ = this.feetPos.z;
    let nextX = prevX + this.velocity.x * safeDt;
    let nextZ = prevZ + this.velocity.z * safeDt;

    // Prevent entering water deeper than 0.9 m when walking on the ground
    if (!this.flyingMode) {
      const nextWl = waterLevelAt(nextX, nextZ);
      if (nextWl !== null) {
        const nextDepth = nextWl - heightAt(nextX, nextZ);
        if (nextDepth > 0.9) {
          nextX = prevX;
          nextZ = prevZ;
          this.velocity.x = 0;
          this.velocity.z = 0;
        }
      }

      // Resolve circle collision against tree trunks, boulders, and gate piers
      if (this.colliderGrid) {
        this.colliderGrid.resolveCircle(nextX, nextZ, 0.42, _resolvedXZ);
        nextX = _resolvedXZ.x;
        nextZ = _resolvedXZ.z;
      }
    }

    this.feetPos.x = nextX;
    this.feetPos.z = nextZ;

    // Section 9: The Edge of the World (within 60 m of WORLD rectangle edge)
    if (!(this.feetPos.x > 5800 && this.feetPos.z > 5800)) {
      const dLeft = this.feetPos.x - WORLD.minX;
      const dRight = WORLD.maxX - this.feetPos.x;
      const dTop = this.feetPos.z - WORLD.minZ;
      const dBot = WORLD.maxZ - this.feetPos.z;
      const minEdge = Math.min(dLeft, dRight, dTop, dBot);

      if (minEdge < 60) {
        this.edgeProximity = Math.max(0, Math.min(1, (60 - minEdge) / 60));
        let inX = 0;
        let inZ = 0;
        if (dLeft < 60) inX += (60 - dLeft) / 60;
        if (dRight < 60) inX -= (60 - dRight) / 60;
        if (dTop < 60) inZ += (60 - dTop) / 60;
        if (dBot < 60) inZ -= (60 - dBot) / 60;
        const inLen = Math.hypot(inX, inZ) || 1;
        inX /= inLen;
        inZ /= inLen;

        // Gently push along the inward normal and turn back smoothly
        const pushSpeed = this.edgeProximity * this.edgeProximity * 9.5;
        this.feetPos.x += inX * pushSpeed * safeDt;
        this.feetPos.z += inZ * pushSpeed * safeDt;

        const inwardYaw = Math.atan2(inZ, inX);
        const yawDiff = Math.atan2(
          Math.sin(inwardYaw - this.targetYaw),
          Math.cos(inwardYaw - this.targetYaw)
        );
        this.targetYaw += yawDiff * this.edgeProximity * 1.4 * safeDt;

        const nowSec = performance.now() / 1000;
        if (this.edgeProximity > 0.25 && nowSec - this.lastEdgeWarningTime > 6.0) {
          this.lastEdgeWarningTime = nowSec;
          this.onEdgeWarning?.();
        }
      } else {
        this.edgeProximity = 0;
      }
    } else {
      this.edgeProximity = 0;
    }

    this.clampWorldBounds();

    if (!this.flyingMode) {
      const targetGroundY = heightAt(this.feetPos.x, this.feetPos.z);
      const yAlpha = 1 - Math.exp(-14 * safeDt);
      this.feetPos.y += (targetGroundY - this.feetPos.y) * yAlpha;
    }

    const speedHoriz = Math.hypot(this.velocity.x, this.velocity.z);
    if (speedHoriz > 0.15 && !this.reducedMotion && !this.flyingMode) {
      this.walkBobPhase += safeDt * (isRunning ? 11.5 : 7.8);
    }

    this.syncCameraTransform(speedHoriz);

    // Check if the player walked into a new location on the ground
    const resolvedPlace = placeAt(this.feetPos.x, this.feetPos.y, this.feetPos.z);
    if (resolvedPlace !== this.currentPlace) {
      this.currentPlace = resolvedPlace;
      if (!this.flyingMode && !this.cinematicActive) {
        this.onPlaceChanged?.(resolvedPlace);
      }
    }
  }

  private syncCameraTransform(speedHoriz: number): void {
    const bobOffset =
      !this.reducedMotion && !this.flyingMode && speedHoriz > 0.15
        ? Math.sin(this.walkBobPhase) * 0.032 * Math.min(1, speedHoriz / WALK)
        : 0;

    this.eyePos.set(
      this.feetPos.x,
      this.feetPos.y + EYE_HEIGHT + bobOffset,
      this.feetPos.z
    );

    const cosP = Math.cos(this.pitch);
    _forward.set(
      cosP * Math.cos(this.yaw),
      Math.sin(this.pitch),
      cosP * Math.sin(this.yaw)
    );

    this.camera.position.copy(this.eyePos);
    _lookTarget.copy(this.eyePos).add(_forward);
    this.camera.lookAt(_lookTarget);
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = Math.max(0.1, width / Math.max(1, height));
    this.camera.updateProjectionMatrix();
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('blur', this.boundBlur);
    this.domElement.removeEventListener('pointerdown', this.boundPointerDown);
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    this.domElement.removeEventListener('touchstart', this.boundTouchStart);
    this.domElement.removeEventListener('touchmove', this.boundTouchMove);
    this.domElement.removeEventListener('touchend', this.boundTouchEnd);
  }
}
