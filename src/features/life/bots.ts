// The students who keep Campus Life lively: names, halls, looks and what they say.
import { HALLS } from '../../data/campus';
import type { Theme } from './venues';

const NAMES_M = ['Kwame', 'Kofi', 'Yaw', 'Kojo', 'Kwesi', 'Kwabena', 'Nana', 'Selorm', 'Edem', 'Mawuli', 'Elikem', 'Fuseini', 'Abdul', 'Nii', 'Fiifi', 'Ekow', 'Jojo', 'Delali', 'Ato', 'Kobby', 'Papa', 'Senyo', 'Issah', 'Bright', 'Prince', 'Emmanuel', 'Samuel', 'Daniel', 'Kelvin', 'Desmond'];
const NAMES_F = ['Ama', 'Akosua', 'Efua', 'Abena', 'Esi', 'Adwoa', 'Afia', 'Dzifa', 'Sena', 'Aisha', 'Mariam', 'Naa', 'Ayele', 'Lamisi', 'Yaaba', 'Araba', 'Baaba', 'Makafui', 'Enyonam', 'Kukua', 'Akua', 'Elorm', 'Nhyira', 'Maame', 'Gifty', 'Priscilla', 'Joyce', 'Esther', 'Mercy', 'Vida'];
const INITIALS = 'ABDEFGKMNOPQSTY';
export const SKINS = ['#3b2219', '#4a2c1c', '#5a3523', '#6b4430', '#7a4b2e', '#8d5a3b'];
const SHIRTS = ['#f2f2f2', '#2b2f3a', '#c8102e', '#1f3a93', '#f5c518', '#2e8b3a', '#e08a1e', '#8e24aa', '#16a3a3', '#d9c7a3', '#e4572e', '#ff7aa8', '#1b1b1b', '#7fb3ff'];
const BOTTOMS = ['#1e2633', '#2b3a55', '#3a3a3a', '#6b5b45', '#14161b', '#4a5a7a', '#d9c7a3'];

export interface BotPerson {
  key: string;
  name: string;
  hall: string;
  female: boolean;
  skin: string;
  shirt: string;
  bottom: string;
  /** dress or skirt instead of trousers */
  dress: boolean;
  /** 0..3: how this person dances */
  moves: number;
}

let n = 0;
export function makeBot(rand: () => number, hallColor?: string): BotPerson {
  const female = rand() < 0.5;
  const pick = <T,>(a: T[]) => a[(rand() * a.length) | 0];
  const hall = pick(HALLS.filter((h) => h.id !== 'none'));
  return {
    key: `bot:${++n}`,
    name: `${pick(female ? NAMES_F : NAMES_M)} ${INITIALS[(rand() * INITIALS.length) | 0]}.`,
    hall: hall.short,
    female,
    skin: pick(SKINS),
    // at a hall hangout many wear the hall's colour
    shirt: hallColor && rand() < 0.55 ? hallColor : pick(SHIRTS),
    bottom: pick(BOTTOMS),
    dress: female && rand() < 0.45,
    moves: (rand() * 4) | 0,
  };
}

const LINES: Record<Theme | 'any', string[]> = {
  any: ['Chale, the vibes here 🔥', 'Who else is here from my hall?', 'Exams next week but we move', 'This song is a vibe', 'Legon no dey sleep', 'Make we take picture!', 'First time here? Welcome!', 'Who rode here? My legs 😅', 'I came on my bike, 2 km from the hall', 'Abeg who has the past questions?'],
  market: ['Who is buying waakye?', 'The kelewele here is top', 'This jollof dey burn 🔥', 'Indomie with egg, abeg', 'Night Market never sleeps', 'Kenkey or fried rice, I can’t decide', 'Sachet water dey?', 'Auntie, add shito small'],
  jam: ['DJ, play that one again!', 'Who is dancing with me?', 'This amapiano dey sweet', 'The bass is too much 🔊', 'Dance battle later?', 'Vandals in the building!', 'Photo wall, let’s go', 'Lights are crazy tonight'],
  square: ['Meet me by Stanbic', 'ATM queue is long today', 'Did you pay fees yet?', 'Momo vendor is around', 'Group study at 7?', 'Library closes at what time?', 'I need a quiet corner'],
  garden: ['This sunset is beautiful', 'Picnic again next week?', 'Canopy walk on Saturday?', 'So peaceful here', 'Take my picture with the sunset'],
  hall: ['Hall week loading!', 'Hall for life! 💪', 'Who has the new hall jersey?', 'Inter-hall finals tomorrow', 'Our hall has the best vibes', 'Hall merch is out, check the table'],
};
export const lineFor = (theme: Theme, rand: () => number) => { const a = rand() < 0.45 ? LINES.any : LINES[theme]; return a[(rand() * a.length) | 0]; };

const HELLO = ['Hey! 👋', 'Chale, how far?', 'Hi! Welcome', 'Hello! First time here?', 'Hey hey 🙌', 'Charley!'];
const REPLY = ['True talk', 'Haha 😂', 'Same here', 'Chale, for real', 'You know it', 'Lol yes', '😂😂', 'Let’s go!', 'Facts'];
/** what a student says back to you in chat, or null to stay quiet */
export function replyTo(text: string, rand: () => number) {
  if (/\b(hi|hey|hello|how far|charley|chale|yo|sup|good (morning|evening|afternoon))\b/i.test(text)) return HELLO[(rand() * HELLO.length) | 0];
  if (rand() < 0.35) return REPLY[(rand() * REPLY.length) | 0];
  return null;
}
