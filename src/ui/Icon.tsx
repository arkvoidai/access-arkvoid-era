export type IconName =
  | 'world'
  | 'atlas'
  | 'people'
  | 'journal'
  | 'cultivate'
  | 'time'
  | 'inspector'
  | 'glasses'
  | 'soundOn'
  | 'soundOff'
  | 'fullscreen'
  | 'keys'
  | 'more'
  | 'close'
  | 'play'
  | 'pause'
  | 'check'
  | 'x'
  | 'arrowRight'
  | 'download'
  | 'refresh';

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 24, className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {name === 'world' && (
        <>
          <path d="M5 20V11a7 7 0 0 1 14 0v9" />
          <path d="M9 20v-7a3 3 0 0 1 6 0v7" />
          <circle cx="12" cy="15.5" r="1.25" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'atlas' && (
        <>
          <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
          <line x1="9" y1="3" x2="9" y2="18" />
          <line x1="15" y1="6" x2="15" y2="21" />
        </>
      )}
      {name === 'people' && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M4 19v-1a5 5 0 0 1 10 0v1" />
          <circle cx="16.5" cy="9.5" r="2.2" />
          <path d="M15 19v-1a4 4 0 0 1 5-3.8" />
        </>
      )}
      {name === 'journal' && (
        <>
          <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="13" y2="17" />
        </>
      )}
      {name === 'cultivate' && (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.2" />
          <line x1="12" y1="2" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="22" />
        </>
      )}
      {name === 'time' && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <polyline points="12 7.5 12 12 15.5 14" />
        </>
      )}
      {name === 'inspector' && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <polyline points="8 13.5 10.5 15.5 8 17.5" />
          <line x1="12.5" y1="17.5" x2="16" y2="17.5" />
        </>
      )}
      {name === 'glasses' && (
        <>
          <rect x="2.5" y="10" width="7.5" height="5.5" rx="2" />
          <rect x="14" y="10" width="7.5" height="5.5" rx="2" />
          <path d="M10 12.2h4" />
          <path d="M2.5 11.5L4.5 7.5" />
          <path d="M21.5 11.5L19.5 7.5" />
        </>
      )}
      {name === 'soundOn' && (
        <>
          <polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 6a8.5 8.5 0 0 1 0 12" />
        </>
      )}
      {name === 'soundOff' && (
        <>
          <polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5" />
          <line x1="21" y1="9" x2="15" y2="15" />
          <line x1="15" y1="9" x2="21" y2="15" />
        </>
      )}
      {name === 'fullscreen' && (
        <>
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </>
      )}
      {name === 'keys' && (
        <>
          <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
          <line x1="6.5" y1="10" x2="8.5" y2="10" />
          <line x1="11" y1="10" x2="13" y2="10" />
          <line x1="15.5" y1="10" x2="17.5" y2="10" />
          <line x1="8" y1="14" x2="16" y2="14" />
        </>
      )}
      {name === 'more' && (
        <>
          <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'close' && (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      )}
      {name === 'play' && <polygon points="7 5 18 12 7 19 7 5" fill="currentColor" />}
      {name === 'pause' && (
        <>
          <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
          <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
        </>
      )}
      {name === 'check' && <polyline points="20 6 9 17 4 12" />}
      {name === 'x' && (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      )}
      {name === 'arrowRight' && (
        <>
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="13 6 19 12 13 18" />
        </>
      )}
      {name === 'download' && (
        <>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </>
      )}
      {name === 'refresh' && (
        <>
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </>
      )}
    </svg>
  );
}
