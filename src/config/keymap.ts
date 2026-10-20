export type KeyActionId =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'run'
  | 'interact'
  | 'escape'
  | 'atlas'
  | 'journal'
  | 'cultivate'
  | 'inspector'
  | 'glasses'
  | 'timeLens'
  | 'spiritSense'
  | 'breathPractice'
  | 'photoMode'
  | 'presenterNotes'
  | 'quietGlasses'
  | 'recenterGlasses'
  | 'fullscreen'
  | 'director'
  | 'vision'
  | 'devTools';

export interface KeyBinding {
  id: KeyActionId;
  label: string;
  keys: string[];
  display: string;
  shift?: boolean;
  devOnly?: boolean;
  category: 'Movement' | 'World & Sheets' | 'Practice & Camera' | 'Presenter';
}

export const KEYMAP: ReadonlyArray<KeyBinding> = [
  {
    id: 'moveForward',
    label: 'Walk forward',
    keys: ['w', 'arrowup'],
    display: 'W / ↑',
    category: 'Movement',
  },
  {
    id: 'moveLeft',
    label: 'Step left',
    keys: ['a', 'arrowleft'],
    display: 'A / ←',
    category: 'Movement',
  },
  {
    id: 'moveBackward',
    label: 'Step back',
    keys: ['s', 'arrowdown'],
    display: 'S / ↓',
    category: 'Movement',
  },
  {
    id: 'moveRight',
    label: 'Step right',
    keys: ['d', 'arrowright'],
    display: 'D / →',
    category: 'Movement',
  },
  {
    id: 'run',
    label: 'Move faster',
    keys: ['shift'],
    display: 'Shift',
    category: 'Movement',
  },
  {
    id: 'interact',
    label: 'Speak or interact',
    keys: ['e'],
    display: 'E',
    category: 'Movement',
  },
  {
    id: 'escape',
    label: 'Menu or close sheet',
    keys: ['escape'],
    display: 'Esc',
    category: 'World & Sheets',
  },
  {
    id: 'atlas',
    label: 'Open Atlas',
    keys: ['m'],
    display: 'M',
    category: 'World & Sheets',
  },
  {
    id: 'journal',
    label: 'Open Journal',
    keys: ['j'],
    display: 'J',
    category: 'World & Sheets',
  },
  {
    id: 'cultivate',
    label: 'Open Cultivate',
    keys: ['c'],
    display: 'C',
    category: 'World & Sheets',
  },
  {
    id: 'inspector',
    label: 'Open Engine Inspector',
    keys: ['i'],
    display: 'I',
    category: 'World & Sheets',
  },
  {
    id: 'glasses',
    label: 'Glasses concept preview',
    keys: ['g'],
    display: 'G',
    category: 'World & Sheets',
  },
  {
    id: 'timeLens',
    label: 'Time Lens',
    keys: ['t'],
    display: 'T',
    category: 'Practice & Camera',
  },
  {
    id: 'spiritSense',
    label: 'Spirit Sense',
    keys: ['v'],
    display: 'V',
    shift: false,
    category: 'Practice & Camera',
  },
  {
    id: 'breathPractice',
    label: 'Breath practice',
    keys: ['b'],
    display: 'B',
    category: 'Practice & Camera',
  },
  {
    id: 'photoMode',
    label: 'Photo mode',
    keys: ['p'],
    display: 'P',
    category: 'Practice & Camera',
  },
  {
    id: 'fullscreen',
    label: 'Toggle fullscreen',
    keys: ['f'],
    display: 'F',
    category: 'Practice & Camera',
  },
  {
    id: 'quietGlasses',
    label: 'Quiet mode (glasses)',
    keys: ['q'],
    display: 'Q',
    category: 'Practice & Camera',
  },
  {
    id: 'recenterGlasses',
    label: 'Recenter view (glasses)',
    keys: ['z'],
    display: 'Z',
    category: 'Practice & Camera',
  },
  {
    id: 'presenterNotes',
    label: 'Presenter notes',
    keys: ['n'],
    display: 'N',
    category: 'Presenter',
  },
  {
    id: 'director',
    label: 'Director tour',
    keys: ['d'],
    display: 'Shift + D',
    shift: true,
    category: 'Presenter',
  },
  {
    id: 'vision',
    label: 'Vision notes',
    keys: ['v'],
    display: 'Shift + V',
    shift: true,
    category: 'Presenter',
  },
  {
    id: 'devTools',
    label: 'Developer tools',
    keys: ['h'],
    display: 'Shift + H',
    shift: true,
    devOnly: true,
    category: 'Presenter',
  },
];
