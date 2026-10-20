import { useEffect, useRef, useState } from 'react';
import { LANDMARKS, PLACES, WORLD } from '../world/bible.ts';
import type { LocationId } from '../engine/types.ts';
import { getActiveWearMap, rleDecode, WEAR_STORAGE_KEY } from '../world3d/terrain/Wear.ts';

interface ValleyParchmentMapProps {
  currentPlace: LocationId;
  onSelectPlace?: (place: LocationId) => void;
}

/**
 * Renders the Parchment Topographic Map of the First World on the Atlas screen,
 * including the "Show footpaths" toggle (Prompt 4 Section 4) that draws the player's
 * persisted footpath wear map over the parchment map in warm ochre ink.
 */
export function ValleyParchmentMap({ currentPlace, onSelectPlace }: ValleyParchmentMapProps) {
  const [showFootpaths, setShowFootpaths] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const toCanvasXY = (wx: number, wz: number): [number, number] => {
      const u = (wx - WORLD.minX) / (WORLD.maxX - WORLD.minX);
      const v = (wz - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ);
      return [u * w, v * h];
    };

    // 1. Warm parchment background
    ctx.fillStyle = '#F3ECE0';
    ctx.fillRect(0, 0, w, h);

    // Subtle topographic grid lines
    ctx.strokeStyle = 'rgba(20, 21, 26, 0.06)';
    ctx.lineWidth = 1;
    for (let gx = -1000; gx <= 1000; gx += 250) {
      const [cx] = toCanvasXY(gx, 0);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
    }
    for (let gz = -750; gz <= 750; gz += 250) {
      const [, cy] = toCanvasXY(0, gz);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.stroke();
    }

    // 2. Valley Lake & Stream in warm sky-olive ink
    const [lakeX, lakeY] = toCanvasXY(
      LANDMARKS.valleyLake.center[0],
      LANDMARKS.valleyLake.center[1]
    );
    const lakeRadPx = (LANDMARKS.valleyLake.radius / (WORLD.maxX - WORLD.minX)) * w;
    ctx.fillStyle = 'rgba(122, 115, 69, 0.25)';
    ctx.strokeStyle = 'rgba(91, 90, 66, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(lakeX, lakeY, lakeRadPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3. Carved paths from bible LANDMARKS.paths
    ctx.strokeStyle = 'rgba(69, 58, 49, 0.45)';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([4, 3]);
    for (const points of Object.values(LANDMARKS.paths)) {
      ctx.beginPath();
      points.forEach(([px, pz], idx) => {
        const [cx, cy] = toCanvasXY(px, pz);
        if (idx === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 4. Footpath Wear Map overlay in warm ochre ink (#9E7840 / #C48F45)
    if (showFootpaths) {
      let wearBytes: Uint8Array | null = null;
      let wearW = 0;
      let wearH = 0;

      const active = getActiveWearMap();
      if (active) {
        wearBytes = active.data;
        wearW = active.width;
        wearH = active.height;
      } else if (typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem(WEAR_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as {
              width: number;
              height: number;
              encoding: string;
              payload: number[];
            };
            if (parsed && parsed.encoding === 'rle' && Array.isArray(parsed.payload)) {
              wearW = parsed.width;
              wearH = parsed.height;
              wearBytes = rleDecode(parsed.payload, wearW * wearH);
            }
          }
        } catch {
          // Ignore
        }
      }

      if (wearBytes && wearW > 0 && wearH > 0) {
        const len = wearBytes.length;
        for (let i = 0; i < len; i++) {
          const val = wearBytes[i];
          if (val > 4) {
            const tx = i % wearW;
            const ty = (i / wearW) | 0;
            const px = (tx / wearW) * w;
            const py = (ty / wearH) * h;
            const alpha = Math.min(0.95, (val / 255) * 1.3 + 0.35);
            ctx.fillStyle = `rgba(176, 108, 34, ${alpha.toFixed(2)})`;
            ctx.fillRect(px - 1.5, py - 1.5, 3.2, 3.2);
          }
        }
      }
    }

    // 5. Place markers
    (Object.keys(PLACES) as LocationId[]).forEach((locId) => {
      if (locId === 'open-cosmos') return;
      const spec = PLACES[locId];
      const [cx, cy] = toCanvasXY(spec.anchor[0], spec.anchor[2]);
      const isCurrent = locId === currentPlace;

      ctx.beginPath();
      ctx.arc(cx, cy, isCurrent ? 6.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? '#FB5607' : '#14151A';
      ctx.fill();
      ctx.strokeStyle = '#FAF8F5';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#14151A';
      ctx.fillText(spec.label, cx + 9, cy + 4);
    });
  }, [showFootpaths, currentPlace]);

  return (
    <div className="mb-6 p-5 rounded-[24px] bg-[#FAF8F5] border border-[var(--line)] surface-shadow">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-mono-label text-[#4B4F56]">
            Topographic Survey · 2,800 m × 2,000 m
          </div>
          <h2 className="font-display text-xl text-[#14151A]">
            Parchment Map &amp; Worn Footpaths
          </h2>
        </div>

        <button
          type="button"
          aria-pressed={showFootpaths}
          onClick={() => setShowFootpaths((v) => !v)}
          className={`min-h-[40px] px-4 py-1.5 rounded-full font-mono text-[12px] uppercase tracking-wider border transition-colors cursor-pointer flex items-center gap-2 ${
            showFootpaths
              ? 'bg-[#14151A] text-[#FAF8F5] border-[#14151A]'
              : 'bg-[#F3F0EB] text-[#14151A] border-[var(--line)]'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              showFootpaths ? 'bg-[#D99B4E]' : 'bg-[#988686]'
            }`}
          />
          <span>Show footpaths</span>
        </button>
      </div>

      <div className="relative w-full overflow-hidden rounded-[16px] border border-[var(--line)] bg-[#F3ECE0]">
        <canvas
          ref={canvasRef}
          data-testid="parchment-wear-map-canvas"
          width={840}
          height={460}
          onClick={(e) => {
            if (!onSelectPlace) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const u = (e.clientX - rect.left) / rect.width;
            const v = (e.clientY - rect.top) / rect.height;
            const wx = WORLD.minX + u * (WORLD.maxX - WORLD.minX);
            const wz = WORLD.minZ + v * (WORLD.maxZ - WORLD.minZ);
            let bestLoc: LocationId | null = null;
            let bestDist = 180;
            for (const [id, spec] of Object.entries(PLACES) as Array<
              [LocationId, (typeof PLACES)[LocationId]]
            >) {
              if (id === 'open-cosmos') continue;
              const d = Math.hypot(wx - spec.anchor[0], wz - spec.anchor[2]);
              if (d < bestDist) {
                bestDist = d;
                bestLoc = id;
              }
            }
            if (bestLoc) onSelectPlace(bestLoc);
          }}
          className="w-full h-auto block cursor-pointer"
        />
      </div>
    </div>
  );
}
