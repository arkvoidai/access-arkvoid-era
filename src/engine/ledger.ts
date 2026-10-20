import { dayOf } from './clock.ts';
import { schedulePersist } from './persist.ts';
import type {
  ActorId,
  EventType,
  LedgerEvent,
  LocationId,
  WorldMinute,
} from './types.ts';

export const MAX_LEDGER_EVENTS = 5000;

export type NewLedgerEvent = Omit<LedgerEvent, 'id'>;

function formatEventId(seq: number): string {
  return `e_${String(seq).padStart(6, '0')}`;
}

function parseSeqFromId(id: string): number {
  const m = /^e_(\d+)$/.exec(id);
  return m ? Number.parseInt(m[1], 10) : 0;
}

export class Ledger {
  private events: LedgerEvent[] = [];
  private nextSeq = 1;

  constructor(initialEvents: LedgerEvent[] = []) {
    this.replaceAll(initialEvents, false);
  }

  public replaceAll(events: LedgerEvent[], persist = true): void {
    // Deep-freeze each event to guarantee immutability
    this.events = events.slice(-MAX_LEDGER_EVENTS).map((e) => Object.freeze({
      ...e,
      actors: [...e.actors],
      causes: [...e.causes],
      data: { ...e.data },
    }));

    let maxSeq = 0;
    for (const ev of this.events) {
      const seq = parseSeqFromId(ev.id);
      if (seq > maxSeq) maxSeq = seq;
    }
    this.nextSeq = maxSeq + 1;

    if (persist) {
      schedulePersist(this.getAll());
    }
  }

  /**
   * Append-only insertion.
   * Validates R8 (time cannot go backwards relative to the last event) and folds routine MOVED
   * events of importance 1 into a single daily summary event per character so the ledger stays clean.
   */
  public append(eventWithoutId: NewLedgerEvent, persist = true): LedgerEvent {
    if (!eventWithoutId.summary || !eventWithoutId.summary.trim()) {
      throw new Error('Ledger event requires a non-empty summary');
    }
    if (!Array.isArray(eventWithoutId.actors) || eventWithoutId.actors.length === 0) {
      throw new Error('Ledger event requires at least one actor');
    }

    const lastEvent = this.events[this.events.length - 1];
    if (lastEvent && eventWithoutId.t < lastEvent.t) {
      throw new Error(
        `R8 Time violation: cannot append event at t=${eventWithoutId.t} before last event t=${lastEvent.t}`
      );
    }

    // Fold routine movement events with importance 1 into a single daily summary event per character
    if (
      eventWithoutId.type === 'MOVED' &&
      eventWithoutId.importance === 1 &&
      eventWithoutId.tier === 0 &&
      eventWithoutId.actors.length === 1 &&
      eventWithoutId.actors[0] !== 'player'
    ) {
      const actor = eventWithoutId.actors[0];
      const eventDay = dayOf(eventWithoutId.t);
      const existingIdx = this.events.findIndex(
        (ev) =>
          ev.type === 'MOVED' &&
          ev.importance === 1 &&
          ev.tier === 0 &&
          ev.actors[0] === actor &&
          dayOf(ev.t) === eventDay &&
          Boolean(ev.data.dailyRoutineFold)
      );

      if (existingIdx !== -1) {
        const prev = this.events[existingIdx];
        const prevStops = typeof prev.data.stops === 'string' ? prev.data.stops : prev.place;
        const nextStops = prevStops.includes(eventWithoutId.place)
          ? prevStops
          : `${prevStops} -> ${eventWithoutId.place}`;
        const folded: LedgerEvent = Object.freeze({
          ...prev,
          t: eventWithoutId.t,
          realTs: eventWithoutId.realTs,
          place: eventWithoutId.place,
          data: {
            ...prev.data,
            dailyRoutineFold: true,
            stops: nextStops,
            moveCount: (typeof prev.data.moveCount === 'number' ? prev.data.moveCount : 1) + 1,
          },
          summary: `${eventWithoutId.summary} (Day ${eventDay} routine: ${nextStops})`,
        });
        this.events[existingIdx] = folded;
        if (persist) {
          schedulePersist(this.getAll());
        }
        return folded;
      }

      eventWithoutId = {
        ...eventWithoutId,
        data: {
          ...eventWithoutId.data,
          dailyRoutineFold: true,
          stops: eventWithoutId.place,
          moveCount: 1,
        },
      };
    }

    const id = formatEventId(this.nextSeq++);
    const created: LedgerEvent = Object.freeze({
      id,
      t: eventWithoutId.t,
      realTs: eventWithoutId.realTs,
      type: eventWithoutId.type,
      actors: [...eventWithoutId.actors],
      place: eventWithoutId.place,
      data: { ...eventWithoutId.data },
      causes: [...eventWithoutId.causes],
      importance: eventWithoutId.importance,
      tier: eventWithoutId.tier,
      summary: eventWithoutId.summary.trim(),
    });

    this.events.push(created);
    if (this.events.length > MAX_LEDGER_EVENTS) {
      this.events.splice(0, this.events.length - MAX_LEDGER_EVENTS);
    }

    if (persist) {
      schedulePersist(this.getAll());
    }
    return created;
  }

  public getAll(): LedgerEvent[] {
    return [...this.events];
  }

  public getById(id: string): LedgerEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  public byActor(actorId: ActorId): LedgerEvent[] {
    return this.events.filter((e) => e.actors.includes(actorId));
  }

  public byPlace(placeId: LocationId): LedgerEvent[] {
    return this.events.filter((e) => e.place === placeId);
  }

  public byType(type: EventType): LedgerEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  public eventsUpTo(t: WorldMinute): LedgerEvent[] {
    return this.events.filter((e) => e.t <= t);
  }

  /**
   * Follows `causes` backwards and returns the ordered causal chain (oldest cause first, target event last).
   */
  public chain(eventId: string): LedgerEvent[] {
    const byId = new Map<string, LedgerEvent>();
    for (const ev of this.events) {
      byId.set(ev.id, ev);
    }

    const target = byId.get(eventId);
    if (!target) return [];

    const visited = new Set<string>();
    const result: LedgerEvent[] = [];

    const dfs = (currentId: string) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);
      const node = byId.get(currentId);
      if (!node) return;
      for (const causeId of node.causes) {
        dfs(causeId);
      }
      result.push(node);
    };

    dfs(eventId);
    return result;
  }

  public exportJson(): string {
    const payload = {
      exportedAt: new Date().toISOString(),
      count: this.events.length,
      events: this.events,
    };
    const json = JSON.stringify(payload, null, 2);

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const dateStamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arkvoid-ledger-${dateStamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    return json;
  }
}
