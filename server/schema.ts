export type EmotionType = 'calm' | 'warm' | 'worried' | 'stern' | 'amused' | 'sad' | 'guarded';

export type ProposalType =
  | 'GIVE_ITEM'
  | 'ACCEPT_ITEM'
  | 'MAKE_PROMISE'
  | 'UPDATE_PROMISE'
  | 'MOVE_TO'
  | 'ADJUST_TRUST'
  | 'NONE';

export interface ValidatedProposal {
  type: ProposalType;
  item?: string;
  recipient?: string;
  place?: string;
  text?: string;
  deadlineHours?: number;
  trustDelta?: number;
  promiseId?: string;
  status?: string;
}

export interface ValidatedModelTurn {
  utterance: string;
  emotion: EmotionType;
  citations: string[];
  proposals: ValidatedProposal[];
}

export interface MemoryLineInput {
  id: string;
  timeLabel: string;
  summary: string;
}

export interface ChatContextInput {
  timeLabel: string;
  partOfDay: string;
  placeName: string;
  activity: string;
  trust: number;
  inventory: string[];
  memories: MemoryLineInput[];
}

export interface ChatRequestInput {
  characterId: string;
  playerText: string;
  context: ChatContextInput;
  sessionToken?: string;
  accessCode?: string;
}

const VALID_EMOTIONS: ReadonlySet<EmotionType> = new Set([
  'calm',
  'warm',
  'worried',
  'stern',
  'amused',
  'sad',
  'guarded',
]);

const VALID_PROPOSALS: ReadonlySet<ProposalType> = new Set([
  'GIVE_ITEM',
  'ACCEPT_ITEM',
  'MAKE_PROMISE',
  'UPDATE_PROMISE',
  'MOVE_TO',
  'ADJUST_TRUST',
  'NONE',
]);

const VALID_CHARACTERS: ReadonlySet<string> = new Set([
  'seren',
  'ione',
  'veyra',
  'mirel',
  'orin',
]);

export function stripControlChars(input: string, maxLen: number): string {
  return input
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function validateChatRequest(raw: unknown): ChatRequestInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const characterId = typeof obj.characterId === 'string' ? stripControlChars(obj.characterId, 32) : '';
  if (!VALID_CHARACTERS.has(characterId)) return null;

  const playerText = typeof obj.playerText === 'string' ? stripControlChars(obj.playerText, 280) : '';
  if (!playerText) return null;

  if (!obj.context || typeof obj.context !== 'object') return null;
  const ctx = obj.context as Record<string, unknown>;

  const timeLabel = typeof ctx.timeLabel === 'string' ? stripControlChars(ctx.timeLabel, 64) : 'Day 1 · Dusk';
  const partOfDay = typeof ctx.partOfDay === 'string' ? stripControlChars(ctx.partOfDay, 24) : 'dusk';
  const placeName = typeof ctx.placeName === 'string' ? stripControlChars(ctx.placeName, 64) : 'East Gate';
  const activity = typeof ctx.activity === 'string' ? stripControlChars(ctx.activity, 120) : 'keeping watch';
  const trustRaw = typeof ctx.trust === 'number' && Number.isFinite(ctx.trust) ? ctx.trust : 0;
  const trust = Math.max(-5, Math.min(10, Math.round(trustRaw)));

  const inventory: string[] = Array.isArray(ctx.inventory)
    ? ctx.inventory
        .slice(0, 16)
        .filter((x): x is string => typeof x === 'string')
        .map((x) => stripControlChars(x, 48))
        .filter(Boolean)
    : [];

  const memories: MemoryLineInput[] = Array.isArray(ctx.memories)
    ? ctx.memories
        .slice(0, 12)
        .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
        .map((m) => ({
          id: typeof m.id === 'string' ? stripControlChars(m.id, 32) : '',
          timeLabel: typeof m.timeLabel === 'string' ? stripControlChars(m.timeLabel, 40) : '',
          summary: typeof m.summary === 'string' ? stripControlChars(m.summary, 200) : '',
        }))
        .filter((m) => Boolean(m.id && m.summary))
    : [];

  const sessionToken = typeof obj.sessionToken === 'string' ? stripControlChars(obj.sessionToken, 256) : undefined;
  const accessCode = typeof obj.accessCode === 'string' ? stripControlChars(obj.accessCode, 64) : undefined;

  return {
    characterId,
    playerText,
    context: {
      timeLabel,
      partOfDay,
      placeName,
      activity,
      trust,
      inventory,
      memories,
    },
    sessionToken,
    accessCode,
  };
}

function cleanJsonString(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

export function parseAndValidateModelTurn(rawContent: string): ValidatedModelTurn | null {
  const cleaned = cleanJsonString(rawContent);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // One repair attempt: remove trailing commas before } or ]
    try {
      const repaired = cleaned.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  // Must have the 4 expected keys
  if (typeof obj.utterance !== 'string') return null;
  const utterance = stripControlChars(obj.utterance, 360);
  if (!utterance) return null;

  const emotionRaw = typeof obj.emotion === 'string' ? (obj.emotion.toLowerCase() as EmotionType) : 'calm';
  const emotion: EmotionType = VALID_EMOTIONS.has(emotionRaw) ? emotionRaw : 'calm';

  if (!Array.isArray(obj.citations) || !Array.isArray(obj.proposals)) return null;

  const citations = obj.citations
    .filter((c): c is string => typeof c === 'string')
    .map((c) => stripControlChars(c, 32))
    .filter(Boolean)
    .slice(0, 12);

  const proposals: ValidatedProposal[] = [];
  for (const p of obj.proposals.slice(0, 4)) {
    if (!p || typeof p !== 'object') continue;
    const pObj = p as Record<string, unknown>;
    const pType = typeof pObj.type === 'string' ? (pObj.type as ProposalType) : 'NONE';
    if (!VALID_PROPOSALS.has(pType)) continue;
    if (pType === 'NONE') continue;

    const validated: ValidatedProposal = { type: pType };
    if (typeof pObj.item === 'string') validated.item = stripControlChars(pObj.item, 48);
    if (typeof pObj.recipient === 'string') validated.recipient = stripControlChars(pObj.recipient, 32);
    if (typeof pObj.place === 'string') validated.place = stripControlChars(pObj.place, 48);
    if (typeof pObj.text === 'string') validated.text = stripControlChars(pObj.text, 180);
    if (typeof pObj.deadlineHours === 'number' && Number.isFinite(pObj.deadlineHours)) {
      validated.deadlineHours = pObj.deadlineHours;
    }
    if (typeof pObj.trustDelta === 'number' && Number.isFinite(pObj.trustDelta)) {
      validated.trustDelta = pObj.trustDelta;
    }
    if (typeof pObj.promiseId === 'string') validated.promiseId = stripControlChars(pObj.promiseId, 32);
    if (typeof pObj.status === 'string') validated.status = stripControlChars(pObj.status, 24);
    proposals.push(validated);
  }

  return {
    utterance,
    emotion,
    citations,
    proposals,
  };
}
