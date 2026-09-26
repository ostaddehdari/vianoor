import {
  faArrowLeft,
  faArrowRight,
  faArrowUp,
  faBars,
  faXmark,
  faMagnifyingGlass,
  faCalendarDays,
  faComments,
  faUser,
  faShieldHalved,
  faHeadset,
  faWallet,
  faBookOpen,
  faBuilding,
  faTableCellsLarge,
  faWandMagicSparkles,
  faPhone,
  faServer,
  faBell,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faClock,
  faVideo,
  faCheck,
  faHeart,
  faStar,
  faGlobe,
  faEllipsis,
  faCircleQuestion,
  faLeaf,
  faEnvelope,
  faArrowRightFromBracket,
  faSliders,
  faDownload,
  faCirclePlay,
  faBookmark,
} from '@fortawesome/free-solid-svg-icons';
const icons = {
  arrow: faArrowLeft,
  right: faArrowRight,
  up: faArrowUp,
  menu: faBars,
  close: faXmark,
  search: faMagnifyingGlass,
  calendar: faCalendarDays,
  comments: faComments,
  user: faUser,
  shield: faShieldHalved,
  headset: faHeadset,
  wallet: faWallet,
  book: faBookOpen,
  building: faBuilding,
  grid: faTableCellsLarge,
  sparkles: faWandMagicSparkles,
  phone: faPhone,
  server: faServer,
  bell: faBell,
  down: faChevronDown,
  chevron: faChevronLeft,
  next: faChevronRight,
  clock: faClock,
  video: faVideo,
  check: faCheck,
  heart: faHeart,
  star: faStar,
  globe: faGlobe,
  more: faEllipsis,
  help: faCircleQuestion,
  leaf: faLeaf,
  mail: faEnvelope,
  exit: faArrowRightFromBracket,
  filter: faSliders,
  download: faDownload,
  play: faCirclePlay,
  bookmark: faBookmark,
};
export type IconName = keyof typeof icons;
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const [width, height, , , data] = icons[name].icon;
  return (
    <svg
      className={`icon ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {(Array.isArray(data) ? data : [data]).map((d, i) => (
        <path d={d} key={i} />
      ))}
    </svg>
  );
}
