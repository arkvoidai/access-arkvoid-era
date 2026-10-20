import { CHARACTERS, LOCATIONS } from '../../config/app.config.ts';
import type {
  CharacterId,
  LedgerEvent,
  ModelTurn,
  Proposal,
  WorldState,
} from '../types.ts';

type IntentKind =
  | 'greeting'
  | 'give_root'
  | 'ask_worry'
  | 'offer_help'
  | 'ask_gate'
  | 'ask_item'
  | 'farewell'
  | 'unknown';

function classifyIntent(playerText: string): IntentKind {
  const q = playerText.toLowerCase().trim();
  if (
    q.includes('give') ||
    q.includes('brought') ||
    q.includes('here are') ||
    q.includes('hand over') ||
    (q.includes('spirit-root') && (q.includes('have') || q.includes('take') || q.includes('brazier')))
  ) {
    return 'give_root';
  }
  if (
    q.includes('worry') ||
    q.includes('worried') ||
    q.includes('trouble') ||
    q.includes('wrong') ||
    q.includes('matter') ||
    q.includes('crack') ||
    q.includes('frost')
  ) {
    return 'ask_worry';
  }
  if (
    q.includes('help') ||
    q.includes('promise') ||
    q.includes('count on me') ||
    q.includes('i will') ||
    q.includes('task') ||
    q.includes('need')
  ) {
    return 'offer_help';
  }
  if (
    q.includes('gate') ||
    q.includes('key') ||
    q.includes('seal') ||
    q.includes('arch') ||
    q.includes('pass') ||
    q.includes('sky') ||
    q.includes('overlook')
  ) {
    return 'ask_gate';
  }
  if (
    q.includes('carry') ||
    q.includes('holding') ||
    q.includes('item') ||
    q.includes('herb') ||
    q.includes('oil') ||
    q.includes('tablet') ||
    q.includes('broth')
  ) {
    return 'ask_item';
  }
  if (
    q.includes('bye') ||
    q.includes('farewell') ||
    q.includes('leave') ||
    q.includes('until') ||
    q.includes('goodnight')
  ) {
    return 'farewell';
  }
  if (
    q.includes('hello') ||
    q.includes('hi') ||
    q.includes('greetings') ||
    q.includes('evening') ||
    q.includes('morning') ||
    q.includes('peace')
  ) {
    return 'greeting';
  }
  return 'unknown';
}

export function buildScriptedTurn(
  characterId: CharacterId,
  playerText: string,
  state: WorldState,
  memories: LedgerEvent[]
): ModelTurn {
  const intent = classifyIntent(playerText);
  const char = CHARACTERS[characterId];
  const placeName = LOCATIONS[state.npcPlace[characterId]]?.name ?? state.npcPlace[characterId];
  const trust = state.trust[characterId] ?? 0;
  const openPromise = state.promises.find(
    (p) => p.status === 'open' && (p.to === characterId || p.by === characterId)
  );
  const topMem = memories[0];
  const crackMem = memories.find((m) => m.summary.toLowerCase().includes('crack') || m.id === 'e_000001');
  const rootMem = memories.find((m) => m.summary.toLowerCase().includes('spirit-root'));
  const citations: string[] = [];
  const proposals: Proposal[] = [];

  if (topMem) {
    citations.push(topMem.id);
  }

  if (characterId === 'seren') {
    switch (intent) {
      case 'give_root': {
        if ((state.inventory['spirit-root'] ?? 0) > 0) {
          if (openPromise) {
            proposals.push({
              type: 'ACCEPT_ITEM',
              item: 'spirit-root',
            });
            proposals.push({
              type: 'UPDATE_PROMISE',
              promiseId: openPromise.id,
              status: 'kept',
            });
            proposals.push({
              type: 'ADJUST_TRUST',
              trustDelta: 1,
            });
            if (rootMem && !citations.includes(rootMem.id)) citations.push(rootMem.id);
            return {
              utterance:
                'You kept your word before the cold settled in. I will feed these dry roots into the gate brazier right away.',
              emotion: 'warm',
              citations,
              proposals,
            };
          }
          proposals.push({ type: 'ACCEPT_ITEM', item: 'spirit-root' });
          proposals.push({ type: 'ADJUST_TRUST', trustDelta: 1 });
          return {
            utterance:
              'Dry spirit-root burns steady against the valley damp. Thank you for bringing this to the watch.',
            emotion: 'warm',
            citations,
            proposals,
          };
        }
        return {
          utterance:
            'Your hands are empty, traveler. If Mirel has spare spirit-root from Beast Ridge, bring a bundle before the night watch.',
          emotion: 'guarded',
          citations,
          proposals: [],
        };
      }

      case 'ask_worry': {
        if (crackMem && !citations.includes(crackMem.id)) citations.push(crackMem.id);
        return {
          utterance: `Orin and I found a hairline frost crack along the outer arch stone this morning. If the brazier cools tonight, the stone will split deeper.`,
          emotion: 'worried',
          citations,
          proposals: [],
        };
      }

      case 'offer_help': {
        if (openPromise) {
          return {
            utterance: `We already have an open agreement: "${openPromise.text}" Bring the spirit-root while the embers still hold.`,
            emotion: 'calm',
            citations,
            proposals: [],
          };
        }
        proposals.push({
          type: 'MAKE_PROMISE',
          recipient: 'player',
          text: 'Check the Lantern Terrace steps with Ione before midnight.',
          deadlineHours: 6,
        });
        return {
          utterance:
            'If you have spare breath tonight, walk up to Lantern Terrace and make sure Ione has enough oil for the steps.',
          emotion: 'calm',
          citations,
          proposals,
        };
      }

      case 'ask_gate': {
        if (trust >= 2 && (state.npcInventory.seren['gate-key'] ?? 0) > 0) {
          proposals.push({
            type: 'GIVE_ITEM',
            item: 'gate-key',
            recipient: 'player',
          });
          return {
            utterance:
              'You have proven steady at the threshold. Take the iron gate key so you can pass the inner post when the mist thickens.',
            emotion: 'warm',
            citations,
            proposals,
          };
        }
        return {
          utterance: `I hold the gate key here at ${placeName}, but I only entrust it to travelers who keep their word to the watch.`,
          emotion: 'stern',
          citations,
          proposals: [],
        };
      }

      case 'ask_item': {
        const items = Object.entries(state.npcInventory.seren)
          .filter(([, count]) => count > 0)
          .map(([k, v]) => `${v} ${k.replace(/-/g, ' ')}`)
          .join(' and ');
        return {
          utterance: `At my belt I carry ${items || 'only my watch staff'}. Every tool at the East Gate is accounted for in Veyra's tablets.`,
          emotion: 'calm',
          citations,
          proposals: [],
        };
      }

      case 'farewell':
        return {
          utterance: 'Walk carefully on the flagstone steps. The mist rises fast after dusk.',
          emotion: 'calm',
          citations,
          proposals: [],
        };

      case 'greeting':
      default: {
        const memNote = topMem
          ? ` I still recall what happened earlier: ${topMem.summary}`
          : '';
        return {
          utterance: `The watch stands steady at ${placeName}, where I am ${state.npcActivity.seren}.${memNote}`,
          emotion: trust >= 2 ? 'warm' : 'calm',
          citations,
          proposals: [],
        };
      }
    }
  }

  // General deterministic character responses for Ione, Veyra, Mirel, Orin
  if (intent === 'ask_worry') {
    return {
      utterance: topMem
        ? `My thoughts stay on what was recorded recently: ${topMem.summary}`
        : `The wind off ${placeName} feels sharper than usual this evening, so I am ${state.npcActivity[characterId]}.`,
      emotion: 'worried',
      citations,
      proposals: [],
    };
  }

  if (intent === 'offer_help') {
    proposals.push({
      type: 'ADJUST_TRUST',
      trustDelta: 1,
    });
    return {
      utterance: `A steady hand is always welcome at ${placeName}. Stay observant while I finish ${state.npcActivity[characterId]}.`,
      emotion: 'warm',
      citations,
      proposals,
    };
  }

  if (intent === 'ask_item') {
    const held = Object.entries(state.npcInventory[characterId] ?? {})
      .filter(([, count]) => count > 0)
      .map(([k, v]) => `${v} ${k.replace(/-/g, ' ')}`)
      .join(', ');
    return {
      utterance: `Right now I carry ${held || 'nothing extra'}. Everything we gather is logged in the valley record.`,
      emotion: 'calm',
      citations,
      proposals: [],
    };
  }

  if (intent === 'farewell') {
    return {
      utterance: `May your breath stay even along the path from ${placeName}.`,
      emotion: 'calm',
      citations,
      proposals: [],
    };
  }

  const memoryMention = topMem ? ` I remember clearly: ${topMem.summary}` : '';
  return {
    utterance: `I am ${char.name}, ${char.role} at ${placeName}. Right now I am ${state.npcActivity[characterId]}.${memoryMention}`,
    emotion: trust >= 2 ? 'warm' : 'calm',
    citations,
    proposals: [],
  };
}
