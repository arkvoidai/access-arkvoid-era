export const COMPANY_FACTS = {
  company: 'Arkvoid Inc.',
  founder: 'Manish Talukdar',
  xHandle: '@ArkvoidAI',
  xUrl: 'https://x.com/ArkvoidAI',
  email: 'heyarkvoid@gmail.com',
  mainSite: 'https://arkvoid.com',
  appDomain: 'https://app.arkvoid.com',
  statusBadge: 'Early preview · In development',
} as const;

export const INTRO_COPY = {
  headlinePrefix: 'Enter the ',
  headlineAccent: 'world',
  headlineSuffix: '.',
  subline: 'A world that remembers you. Early preview, in development.',
  cards: [
    {
      id: 'explore' as const,
      label: '01 · First World',
      title: 'Explore',
      description: 'Walk the first world at your own pace.',
      cta: 'Enter world',
    },
    {
      id: 'demo' as const,
      label: '02 · Guided Tour',
      title: 'Investor demo',
      description: 'A guided five-minute tour of how it works.',
      cta: 'Start guided tour',
    },
    {
      id: 'glasses' as const,
      label: '03 · Concept Preview',
      title: 'Glasses preview',
      description: 'See how the world will feel through glasses. Hardware is a concept.',
      cta: 'Open concept view',
    },
  ],
  footerCompany: 'Arkvoid Inc.',
  footerDisclaimer:
    "When live mode is on, conversations are processed by Mistral AI's API. Please do not share personal information.",
} as const;

export const WORLD_PLACEHOLDER_COPY = {
  heading: 'The world is built in the next steps.',
  subline:
    'The permanent record, clock, memory retrieval, rules engine, and background routines are live now. Use the dock below or press I to inspect the engine and talk with people at your location.',
} as const;
