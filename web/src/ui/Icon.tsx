/**
 * Icons from the NASA Horizon Design System (HDS Core, CC0), inlined so they take the text color.
 * 24px frame, glyph drawn at 20px. Decorative: the button or link beside them carries the label.
 */
const PATHS = {
  play: <path d="M5 17V3L17 10L5 17Z" />,
  pause: (
    <>
      <path d="M4 3H8V17H4V3Z" />
      <path d="M12 3H16V17H12V3Z" />
    </>
  ),
  plus: (
    <>
      <rect y="9" width="20" height="2" />
      <rect x="9" y="20" width="20" height="2" transform="rotate(-90 9 20)" />
    </>
  ),
  close: (
    <path
      fillRule="evenodd"
      d="M8.58204 10.0006L-8.80957e-05 18.5828L1.41621 19.9949L9.99625 11.4149L18.5827 20.0013L19.999 18.5892L11.4105 10.0006L19.999 1.41213L18.5827 0L9.99625 8.58643L1.413 0.00317653L-0.0032959 1.41531L8.58204 10.0006Z"
    />
  ),
  location: <path d="M8.47868 11.7242L11.1235 20L17 0L0 11.4651L8.47868 11.7242Z" />,
  map: (
    <path
      fillRule="evenodd"
      d="M10.4571 19.5438C13.7983 16.2131 17 13.0213 17 8C17 4.13401 13.866 1 10 1C6.13401 1 3 4.13401 3 8C3 13.0213 6.20172 16.2131 9.5429 19.5438C9.69507 19.6955 9.84754 19.8475 10 20C10.1525 19.8475 10.3049 19.6955 10.4571 19.5438ZM10 11C11.6569 11 13 9.65685 13 8C13 6.34315 11.6569 5 10 5C8.34315 5 7 6.34315 7 8C7 9.65685 8.34315 11 10 11Z"
    />
  ),
  download: (
    <>
      <path d="M9.04459 -5.40898e-07L9.04459 10.6036L4.93793 6.75966L3.6001 8.01163L10.0001 14L16.4001 8.01163L15.0623 6.75966L10.9556 10.6036L10.9556 -7.30753e-07L9.04459 -5.40898e-07Z" />
      <path fillRule="evenodd" d="M2 16V13H0V18H20V13H18V16H2Z" />
    </>
  ),
  arrowRight: (
    <path d="M0 11.1944L15.7545 11.1944L10.9496 16.3277L12.5145 18L20 10L12.5145 2L10.9496 3.6723L15.7545 8.80562L0 8.80562L0 11.1944Z" />
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="-2 -2 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
