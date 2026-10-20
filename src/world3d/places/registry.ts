import * as THREE from 'three';
import type { LocationId } from '../../engine/types.ts';
import { LANDMARKS, PLACE_IDS, PLACES } from '../../world/bible.ts';
import { LanternSystem } from '../arch/Lamps.ts';
import { getArchMaterials } from '../arch/Materials.ts';
import type { MergeStats } from '../arch/Merge.ts';
import { ModelOverrides } from '../arch/Overrides.ts';
import { InteractableRegistry } from '../Interactables.ts';
import type { ColliderGrid } from '../life/Colliders.ts';
import type { QualityTier } from '../Quality.ts';
import {
  buildAshenMarchFar,
  buildAshenMarchNear,
  type BuiltAshenMarchNear,
} from './AshenMarch.ts';
import {
  buildBeastRidgeFar,
  buildBeastRidgeNear,
  type BuiltBeastRidgeNear,
} from './BeastRidge.ts';
import {
  buildDaisFar,
  buildDaisNear,
  type BuiltDaisNear,
} from './Dais.ts';
import {
  buildEastGateFar,
  buildEastGateNear,
  type BuiltEastGateNear,
} from './EastGate.ts';
import {
  buildHallOfRecordsFar,
  buildHallOfRecordsNear,
  type BuiltHallOfRecordsNear,
} from './HallOfRecords.ts';
import {
  buildLanternTerraceFar,
  buildLanternTerraceNear,
  type BuiltLanternTerraceNear,
} from './LanternTerrace.ts';
import {
  buildOverlookFar,
  buildOverlookNear,
  type BuiltOverlookNear,
} from './Overlook.ts';
import {
  buildSkyRealmsFar,
  buildSkyRealmsNear,
  type BuiltSkyRealmsNear,
} from './SkyRealms.ts';

export interface PlacesRegistryCallbacks {
  colliders: ColliderGrid;
  renderer?: THREE.WebGLRenderer;
  getPlayerRealm: () => number;
  isPreviewMode: () => boolean;
  onEnterHallInterior: () => void;
  onLeaveHallInterior: () => void;
  onNotice?: (message: string) => void;
  onRingBell?: () => void;
  onSitBench?: () => void;
}

interface PlaceSlot {
  id: LocationId;
  anchor: THREE.Vector3;
  farGroup: THREE.Group;
  nearGroup: THREE.Group | null;
  nearStats: MergeStats;
  disposeNear?: () => void;
  updateNear?: (realSeconds: number, dt: number, playerPos: THREE.Vector3) => void;
}

/**
 * Place Streaming & Performance Registry (`registry.ts` — Prompt 5 Section 10):
 * - Every place mounts `buildFar()` (cheap silhouette, always resident).
 * - Streams `buildNear()` when the player is within `700 m` on `high`, `500 m` on `mid`, `350 m` on `low`
 *   (and always mounts the current active place), disposing beyond `1500 m`.
 * - Builds near places in frame slices (at most 1 place constructed per frame) to avoid hitches.
 * - Reports measured triangle and draw-call budgets per place and quality tier.
 */
export class PlacesRegistry {
  public readonly group = new THREE.Group();
  public readonly lamps: LanternSystem;
  public readonly interactables: InteractableRegistry;
  public readonly overrides: ModelOverrides;

  private readonly slots = new Map<LocationId, PlaceSlot>();
  private readonly buildQueue: LocationId[] = [];
  private readonly cbs: PlacesRegistryCallbacks;
  private tier: QualityTier = 'high';

  private eastGateNear: BuiltEastGateNear | null = null;
  private lanternTerraceNear: BuiltLanternTerraceNear | null = null;
  private hallNear: BuiltHallOfRecordsNear | null = null;
  private beastRidgeNear: BuiltBeastRidgeNear | null = null;
  private overlookNear: BuiltOverlookNear | null = null;
  private skyRealmsNear: BuiltSkyRealmsNear | null = null;
  private ashenMarchNear: BuiltAshenMarchNear | null = null;
  private daisNear: BuiltDaisNear | null = null;

  public constructor(cbs: PlacesRegistryCallbacks) {
    this.cbs = cbs;
    this.group.name = 'PlacesRegistry';

    // Initialize shared materials, instanced lamps, interactables, and GLB overrides
    getArchMaterials();
    this.lamps = new LanternSystem(512, 192);
    this.interactables = new InteractableRegistry();
    this.overrides = new ModelOverrides(cbs.renderer);

    this.group.add(this.lamps.group);
    this.group.add(this.interactables.group);

    // Build always-resident Far silhouettes for all 8 places
    for (const id of PLACE_IDS) {
      const [ax, ay, az] = PLACES[id].anchor;
      const farGroup = this.constructFar(id);
      this.group.add(farGroup);
      this.slots.set(id, {
        id,
        anchor: new THREE.Vector3(ax, ay, az),
        farGroup,
        nearGroup: null,
        nearStats: { chunkCount: 0, drawCalls: 0, triangles: 0 },
      });
    }

    // Mount East Gate Near immediately so spawn at (34, 140, 0) has full architecture on Frame 1
    this.mountNearPlace('east-gate');
    // Queue Sky Realms so floating islands & airships appear right after spawn
    this.buildQueue.push('sky-realms', 'overlook', 'hall-of-records', 'lantern-terrace');

    // Asynchronously probe `/world/models/<id>.glb` overrides (including `well.glb`)
    void this.overrides.scanAndLoadAll();
  }

  private constructFar(id: LocationId): THREE.Group {
    switch (id) {
      case 'east-gate':
        return buildEastGateFar();
      case 'lantern-terrace':
        return buildLanternTerraceFar();
      case 'hall-of-records':
        return buildHallOfRecordsFar();
      case 'beast-ridge':
        return buildBeastRidgeFar();
      case 'overlook':
        return buildOverlookFar();
      case 'sky-realms':
        return buildSkyRealmsFar();
      case 'ashen-march':
        return buildAshenMarchFar();
      case 'open-cosmos':
        return buildDaisFar();
    }
  }

  public mountNearPlace(id: LocationId): void {
    const slot = this.slots.get(id);
    if (!slot || slot.nearGroup) return;

    switch (id) {
      case 'east-gate': {
        const built = buildEastGateNear({
          lamps: this.lamps,
          interactables: this.interactables,
          colliders: this.cbs.colliders,
          overrides: this.overrides,
          onNotice: this.cbs.onNotice,
          onRingBell: this.cbs.onRingBell,
        });
        this.eastGateNear = built;
        slot.nearGroup = built.group;
        slot.nearStats = built.stats;
        slot.updateNear = (realSeconds, dt) => built.update(realSeconds, dt);
        slot.disposeNear = () => {
          built.dispose();
          this.eastGateNear = null;
        };
        break;
      }
      case 'lantern-terrace': {
        const built = buildLanternTerraceNear({
          lamps: this.lamps,
          interactables: this.interactables,
          colliders: this.cbs.colliders,
          overrides: this.overrides,
          onNotice: this.cbs.onNotice,
        });
        this.lanternTerraceNear = built;
        slot.nearGroup = built.group;
        slot.nearStats = built.stats;
        slot.updateNear = (realSeconds, dt) => built.update(realSeconds, dt);
        slot.disposeNear = () => {
          built.dispose();
          this.lanternTerraceNear = null;
        };
        break;
      }
      case 'hall-of-records': {
        const built = buildHallOfRecordsNear({
          lamps: this.lamps,
          interactables: this.interactables,
          colliders: this.cbs.colliders,
          overrides: this.overrides,
          onEnterInterior: this.cbs.onEnterHallInterior,
          onLeaveInterior: this.cbs.onLeaveHallInterior,
          onNotice: this.cbs.onNotice,
        });
        this.hallNear = built;
        slot.nearGroup = built.group;
        slot.nearStats = built.stats;
        slot.updateNear = (realSeconds, dt) => built.update(realSeconds, dt);
        slot.disposeNear = () => {
          built.dispose();
          this.hallNear = null;
        };
        break;
      }
      case 'beast-ridge': {
        const built = buildBeastRidgeNear({
          lamps: this.lamps,
          interactables: this.interactables,
          colliders: this.cbs.colliders,
          overrides: this.overrides,
          onNotice: this.cbs.onNotice,
        });
        this.beastRidgeNear = built;
        slot.nearGroup = built.group;
        slot.nearStats = built.stats;
        slot.updateNear = (realSeconds, dt) => built.update(realSeconds, dt);
        slot.disposeNear = () => {
          built.dispose();
          this.beastRidgeNear = null;
        };
        break;
      }
      case 'overlook': {
        const built = buildOverlookNear({
          lamps: this.lamps,
          interactables: this.interactables,
          overrides: this.overrides,
          getPlayerRealm: this.cbs.getPlayerRealm,
          onNotice: this.cbs.onNotice,
          onSitBench: this.cbs.onSitBench,
        });
        this.overlookNear = built;
        slot.nearGroup = built.group;
        slot.nearStats = built.stats;
        slot.updateNear = (realSeconds, dt) => built.update(realSeconds, dt);
        slot.disposeNear = () => {
          built.dispose();
          this.overlookNear = null;
        };
        break;
      }
      case 'sky-realms': {
        const built = buildSkyRealmsNear({
          lamps: this.lamps,
          overrides: this.overrides,
        });
        this.skyRealmsNear = built;
        slot.nearGroup = built.group;
        slot.nearStats = built.stats;
        slot.updateNear = (realSeconds, dt) => built.update(realSeconds, dt);
        slot.disposeNear = () => {
          built.dispose();
          this.skyRealmsNear = null;
        };
        break;
      }
      case 'ashen-march': {
        const built = buildAshenMarchNear({
          lamps: this.lamps,
          interactables: this.interactables,
          colliders: this.cbs.colliders,
          overrides: this.overrides,
          isLawSealLifted: () =>
            this.cbs.getPlayerRealm() >= LANDMARKS.realmGate['ashen-march'] ||
            this.cbs.isPreviewMode(),
          onNotice: this.cbs.onNotice,
        });
        this.ashenMarchNear = built;
        slot.nearGroup = built.group;
        slot.nearStats = built.stats;
        slot.updateNear = (realSeconds, dt, playerPos) =>
          built.update(playerPos, realSeconds, dt);
        slot.disposeNear = () => {
          built.dispose();
          this.ashenMarchNear = null;
        };
        break;
      }
      case 'open-cosmos': {
        const built = buildDaisNear(this.overrides);
        this.daisNear = built;
        slot.nearGroup = built.group;
        slot.nearStats = built.stats;
        slot.disposeNear = () => {
          built.dispose();
          this.daisNear = null;
        };
        break;
      }
    }

    if (slot.nearGroup) {
      slot.farGroup.visible = false;
      this.group.add(slot.nearGroup);
    }
  }

  private unmountNearPlace(id: LocationId): void {
    const slot = this.slots.get(id);
    if (!slot || !slot.nearGroup) return;
    // Keep East Gate and Sky Realms resident
    if (id === 'east-gate' || id === 'sky-realms') return;

    this.group.remove(slot.nearGroup);
    slot.disposeNear?.();
    slot.nearGroup = null;
    slot.farGroup.visible = true;
  }

  public mountHallInterior(): MergeStats {
    this.mountNearPlace('hall-of-records');
    if (this.hallNear) {
      return this.hallNear.mountInterior();
    }
    return { chunkCount: 0, drawCalls: 0, triangles: 0 };
  }

  public unmountHallInterior(): void {
    this.hallNear?.unmountInterior();
  }

  public isHallInteriorMounted(): boolean {
    return this.hallNear?.isInteriorMounted() ?? false;
  }

  public setOverlookBreathGlow(intensity01: number): void {
    this.overlookNear?.setBreathGlow(intensity01);
  }

  public setQualityTier(tier: QualityTier): void {
    this.tier = tier;
    this.lamps.setQualityTier(tier);
  }

  public update(
    camera: THREE.Camera,
    playerFeetPos: THREE.Vector3,
    realSeconds: number,
    dt: number
  ): void {
    const nearRadius = this.tier === 'high' ? 700 : this.tier === 'mid' ? 500 : 350;
    const disposeRadius = 1500;

    for (const slot of this.slots.values()) {
      const dist = Math.hypot(
        playerFeetPos.x - slot.anchor.x,
        playerFeetPos.z - slot.anchor.z
      );

      if (!slot.nearGroup) {
        if (dist <= nearRadius && !this.buildQueue.includes(slot.id)) {
          this.buildQueue.push(slot.id);
        }
      } else {
        if (dist > disposeRadius && slot.id !== 'east-gate' && slot.id !== 'sky-realms') {
          this.unmountNearPlace(slot.id);
        } else {
          slot.updateNear?.(realSeconds, dt, playerFeetPos);
        }
      }
    }

    // Build at most 1 queued near place per frame to avoid frame hitches
    if (this.buildQueue.length > 0) {
      const nextId = this.buildQueue.shift()!;
      this.mountNearPlace(nextId);
    }

    // Update instanced lamps & PointLight pool + interactable focus cone
    this.lamps.update(playerFeetPos, realSeconds, dt);
    this.interactables.update(camera, playerFeetPos);
  }

  public get activeNearCount(): number {
    let n = 0;
    for (const s of this.slots.values()) {
      if (s.nearGroup) n++;
    }
    return n;
  }

  public dispose(): void {
    for (const id of PLACE_IDS) {
      const s = this.slots.get(id);
      if (s?.nearGroup) {
        s.disposeNear?.();
      }
    }
    this.lamps.dispose();
    this.interactables.dispose();
  }
}
