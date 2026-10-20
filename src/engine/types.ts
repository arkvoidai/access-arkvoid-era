export type WorldMinute = number;               // minutes since World Day 1, 00:00
export type CharacterId = "seren" | "ione" | "veyra" | "mirel" | "orin";
export type ActorId = CharacterId | "player";
export type LocationId =
  | "east-gate" | "lantern-terrace" | "hall-of-records" | "beast-ridge"
  | "overlook" | "sky-realms" | "ashen-march" | "open-cosmos";
export type EventType =
  | "SPOKE" | "PROMISE_MADE" | "PROMISE_UPDATED" | "ITEM_GATHERED" | "ITEM_GIVEN"
  | "MOVED" | "WORK_STARTED" | "WORK_COMPLETED" | "TRAINED" | "BREAKTHROUGH"
  | "TRUST_CHANGED" | "SIGHTED" | "NOTE";

export interface LedgerEvent {
  id: string;                 // "e_000123"
  t: WorldMinute;
  realTs: number;             // Date.now()
  type: EventType;
  actors: ActorId[];
  place: LocationId;
  data: Record<string, string | number | boolean>;
  causes: string[];           // ids of earlier events that led to this one
  importance: 1 | 2 | 3 | 4 | 5;
  tier: 0 | 1 | 2;            // 0 rules or routine, 1 template narration, 2 language model
  summary: string;            // one plain sentence, used by Journal and Inspector
}

export interface RoutineBlock {
  fromHour: number;
  toHour: number;
  place: LocationId;
  activity: string;
}

export interface Character {
  id: CharacterId;
  name: string;
  role: string;
  portraitKey: string;
  traits: string[];
  goals: string[];
  voice: string;
  routine: RoutineBlock[];
  homePlace: LocationId;
}

export interface Promise_ {
  id: string;
  by: ActorId;
  to: ActorId;
  text: string;
  madeAt: WorldMinute;
  dueBy: WorldMinute | null;
  status: "open" | "kept" | "moot" | "broken";
  sourceEvent: string;
}

export interface WorldState {
  seed: number;
  now: WorldMinute;
  lastSeenReal: number;
  startedReal: number;
  playerPlace: LocationId;
  playerRealm: number;                                     // 1..9
  spirit: number;                                          // 0..100
  inventory: Record<string, number>;                       // e.g. { "spirit-root": 2 }
  npcInventory: Record<CharacterId, Record<string, number>>;
  npcPlace: Record<CharacterId, LocationId>;
  npcActivity: Record<CharacterId, string>;
  trust: Record<CharacterId, number>;                      // -5..10
  promises: Promise_[];
  flags: Record<string, boolean | number | string>;
  version: 1;
}

export interface Proposal {
  type: "GIVE_ITEM" | "ACCEPT_ITEM" | "MAKE_PROMISE" | "UPDATE_PROMISE" | "MOVE_TO" | "ADJUST_TRUST" | "NONE";
  item?: string;
  recipient?: string;
  place?: string;
  text?: string;
  deadlineHours?: number;
  trustDelta?: number;
  promiseId?: string;
  status?: string;
}

export interface RuleResult {
  ok: boolean;
  ruleId: string;
  reason: string;
}

export interface ModelTurn {
  utterance: string;
  emotion: "calm" | "warm" | "worried" | "stern" | "amused" | "sad" | "guarded";
  citations: string[];
  proposals: Proposal[];
}

export interface TurnResult {
  turn: ModelTurn;
  checks: Array<{ proposal: Proposal; result: RuleResult }>;
  committed: LedgerEvent[];
  source: "live" | "offline";
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
}
