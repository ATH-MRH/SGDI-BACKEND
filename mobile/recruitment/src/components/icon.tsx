import { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Jeu d'icônes au trait dessiné pour l'application (grille 24, trait 1.8) : aucune police d'icônes à charger.
const SHAPES = {
  home: <><Path d="M4 11.5 12 4l8 7.5" /><Path d="M6 10v9.5h4.5V15h3v4.5H18V10" /></>,
  briefcase: <><Rect x="3.5" y="7.5" width="17" height="12" rx="2" /><Path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5" /><Path d="M3.5 12.5h17" /></>,
  bookmark: <Path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.8L6 20V5.5a1 1 0 0 1 1-1Z" />,
  file: <><Path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5Z" /><Path d="M14 3.5V8h4" /><Path d="M9 12.5h6M9 16h6" /></>,
  user: <><Circle cx="12" cy="8.5" r="3.5" /><Path d="M5 20c.6-3.4 3.4-5.5 7-5.5s6.4 2.1 7 5.5" /></>,
  search: <><Circle cx="11" cy="11" r="6" /><Path d="m15.5 15.5 4.5 4.5" /></>,
  sliders: <><Path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h10M18 17h2" /><Circle cx="15" cy="7" r="2" /><Circle cx="9" cy="12" r="2" /><Circle cx="16" cy="17" r="2" /></>,
  pin: <><Path d="M12 21s6.5-6 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5 6.5 11 6.5 11Z" /><Circle cx="12" cy="10" r="2.3" /></>,
  building: <><Rect x="5" y="3.5" width="14" height="17" rx="1.5" /><Path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2M10.5 20.5v-3h3v3" /></>,
  clock: <><Circle cx="12" cy="12" r="8.5" /><Path d="M12 7.5V12l3 2" /></>,
  calendar: <><Rect x="4" y="5.5" width="16" height="15" rx="2" /><Path d="M8 3.5v4M16 3.5v4M4 10.5h16" /></>,
  chevronRight: <Path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  check: <><Circle cx="12" cy="12" r="8.5" /><Path d="m8.3 12.3 2.5 2.5 4.9-5.3" /></>,
  alert: <><Circle cx="12" cy="12" r="8.5" /><Path d="M12 7.5v5.5M12 16.3v.2" /></>,
  close: <Path d="m6 6 12 12M18 6 6 18" />,
  // Engrenage : tracé de l'icône « settings » de Lucide (licence ISC).
  settings: <><Circle cx="12" cy="12" r="3" /><Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /></>,
  bulb: <><Path d="M9 17.5h6M10 20.5h4" /><Path d="M8.5 14.5a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2Z" /></>,
  inbox: <><Path d="M4 13.5 6.5 5h11L20 13.5V19H4Z" /><Path d="M4 13.5h4l1.5 2.5h5l1.5-2.5h4" /></>,
  phone: <><Rect x="7" y="2.5" width="10" height="19" rx="2" /><Path d="M11 18.5h2" /></>,
  logout: <><Path d="M10 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H10" /><Path d="M14 8l4 4-4 4M18 12H9.5" /></>,
  trash: <><Path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.5h5.4a1.5 1.5 0 0 0 1.5-1.5L17 7" /></>,
  plus: <Path d="M12 5v14M5 12h14" />,
  send: <><Path d="M20.5 3.5 10.5 13.5" /><Path d="M20.5 3.5 14 20.5l-3.5-7-7-3.5Z" /></>,
  shield: <Path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.7 7 9 4.1-1.3 7-4.7 7-9V6Z" />,
  bell: <><Path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" /><Path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  chat: <><Path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H11l-4.5 3.5v-3.5h-2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" /></>,
  chevronLeft: <Path d="M14.5 5.5 8 12l6.5 6.5" />,
  box: <><Path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16Z" /><Path d="M3.5 8 12 12.5 20.5 8M12 12.5v8" /></>,
  sparkles: <><Path d="M10 4.5 11.7 9.3 16.5 11l-4.8 1.7L10 17.5l-1.7-4.8L3.5 11l4.8-1.7Z" /><Path d="M18 3.5l.8 2.2 2.2.8-2.2.8L18 9.5l-.8-2.2-2.2-.8 2.2-.8ZM18 15.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6Z" /></>,
  forklift: <><Path d="M4 16.5V8.5h5l2.5 4.5v3.5" /><Path d="M14.5 5v11.5h6" /><Circle cx="6.5" cy="17.5" r="2" /><Circle cx="11.5" cy="17.5" r="2" /><Path d="M4 12.5h7" /></>,
  cloudUp: <><Path d="M7 18.5h10a4 4 0 0 0 .7-7.9 5.5 5.5 0 0 0-10.7-1.3A4.5 4.5 0 0 0 7 18.5Z" /><Path d="M12 16.5v-6M9.5 12.5 12 10l2.5 2.5" /></>,
  paper: <><Path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5Z" /><Path d="M14 3.5V8h4" /></>,
  lock: <><Rect x="5.5" y="10.5" width="13" height="10" rx="2" /><Path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  star: <Path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8 6.9 19.5l1-5.7-4.1-4 5.7-.8Z" />,
  graduation: <><Path d="M2.5 9 12 4.5 21.5 9 12 13.5Z" /><Path d="M6.5 11.5v4.5c1.5 1.5 3.5 2 5.5 2s4-.5 5.5-2v-4.5M21.5 9v5" /></>,
  globe: <><Circle cx="12" cy="12" r="8.5" /><Path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5Z" /></>,
  pencil: <><Path d="M4.5 19.5 5.5 15.5 16 5l3 3L8.5 18.5Z" /><Path d="M14 7l3 3" /></>,
  users: <><Circle cx="9" cy="9" r="3" /><Path d="M3.5 19c.5-2.9 2.6-4.5 5.5-4.5s5 1.6 5.5 4.5" /><Path d="M15.5 6.3a3 3 0 0 1 0 5.4M17 14.8c1.9.5 3.1 1.9 3.5 4.2" /></>,
} as const;

export type IconName = keyof typeof SHAPES;

export function Icon({ name, size = 22, color = '#0E2747', filled = false }: { name: IconName; size?: number; color?: ColorValue; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {SHAPES[name]}
    </Svg>
  );
}
