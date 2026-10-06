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
const REPLY = ['True talk', 'Haha 😂', 'Same here', 'Chale, for real', 'You know it', 'Lol yes', '😂😂', 'Let’s go!', 'Facts', 'Eiii', 'No wahala'];
const COURSES = ['Political Science', 'Computer Science', 'Economics', 'Nursing', 'Law', 'Business Admin', 'Psychology', 'Engineering', 'Linguistics', 'Geography', 'Pharmacy', 'Theatre Arts'];
const pickOf = <T,>(a: T[], rand: () => number) => a[(rand() * a.length) | 0];

/** what a student opens with when they come over to you */
export function introFor(b: { name: string; hall: string }, theme: Theme, rand: () => number) {
  const first = b.name.split(' ')[0];
  const opener = pickOf([
    `Hi! I'm ${first} from ${b.hall}. First time here?`,
    `Hey, I'm ${first}. Which hall are you in?`,
    `Chale, how far? I'm ${first} (${b.hall})`,
    `Hello! ${first} here. What are you studying?`,
    theme === 'market' ? `Hi, I'm ${first}. Have you tried the waakye here?` : theme === 'jam' ? `Yo! I'm ${first}. You dey dance?` : `Hey! I'm ${first}. You come here often?`,
  ], rand);
  return opener;
}

/** what a student says back to you in chat, or null to stay quiet */
export function replyTo(text: string, rand: () => number, b?: { name: string; hall: string }) {
  const t = text.toLowerCase();
  if (b && /\b(name|who are you)\b/.test(t)) return `I'm ${b.name.split(' ')[0]} 😊`;
  if (b && /\bhall\b|where do you (stay|live)/.test(t)) return `${b.hall}! Best hall 💪`;
  if (/\b(study|studying|course|programme|program|level)\b/.test(t)) return `${pickOf(COURSES, rand)}. Level ${pickOf(['100', '200', '300', '400'], rand)}`;
  if (/how are you|how far|how you dey|wassup|what'?s up/.test(t)) return pickOf(['I dey oo, you?', 'I’m good! You?', 'Fine, just vibing', 'Chilling 😎'], rand);
  if (/\b(dance|dancing)\b/.test(t)) return pickOf(['Let’s go! 💃', 'Only if you lead 😂', 'This song? Yes!'], rand);
  if (/\b(eat|food|hungry|waakye|jollof|kelewele|indomie)\b/.test(t)) return pickOf(['The waakye here is top', 'Let’s go buy something', 'I’m hungry too 😅'], rand);
  if (/\b(first time|new|fresher)\b/.test(t)) return pickOf(['Welcome to Legon! 🎉', 'You’ll love it here', 'Freshers! Ask me anything'], rand);
  // playful, friendly flirting: they flirt back a little, never anything explicit
  if (/\b(cute|pretty|beautiful|handsome|fine|nice (dress|shirt|smile|outfit)|you look|smile)\b/.test(t)) return pickOf(['Awww, thank you 😊', 'Stop it 🙈 you too!', 'Hehe, you’re sweet', 'Chale, you dey talk 😂 thanks', 'You’re not bad yourself 😏'], rand);
  if (/\b(number|snap|snapchat|insta|instagram|whatsapp|contact)\b/.test(t)) return pickOf(['Let’s dance first, then we’ll see 😏', 'Haha, slow down 😂 tell me about yourself first', 'Find me here at the next jam 😉', 'Maybe if you buy me kelewele 😂'], rand);
  if (/\b(single|boyfriend|girlfriend|crush|date|go out)\b/.test(t)) return pickOf(['Haha why are you asking? 😏', 'That’s classified 🙈', 'Maybe… who wants to know? 😂', 'Let’s start with a dance 💃'], rand);
  if (/\b(sit with|join you|walk with|hang out|come with)\b/.test(t)) return pickOf(['Sure, come 😊', 'Yes, plenty space', 'Let’s go!'], rand);
  if (/\b(miss|like you|love)\b/.test(t)) return pickOf(['Eiii 🙈', 'Haha, you’re funny 😂', 'Already? 😏'], rand);
  if (/\b(hi|hey|hello|charley|chale|yo|sup|good (morning|evening|afternoon))\b/.test(t)) return pickOf(HELLO, rand);
  if (/\b(thanks|thank you|bye|later)\b/.test(t)) return pickOf(['Anytime!', 'See you around 👋', 'Enjoy!'], rand);
  if (/\?$/.test(t)) return pickOf(['Hmm, good question 😂', 'I think so', 'Not sure oo', 'Yes!'], rand);
  if (rand() < 0.6) return pickOf(REPLY, rand);
  return null;
}

/** quick things to say, shown as chips over the chat box; the flirty ones only for 18+ riders who chose Date */
export const QUICK_SAY = ['Hi 👋', 'Which hall are you?', 'What do you study?', 'You dey dance?', 'Let’s get food', 'First time here 😅'];
export const QUICK_FLIRT = ['You look nice tonight 😊', 'Can I sit with you?', 'Your smile tho 😏', 'Are you single? 😂'];

/** a student in the crowd answers someone else in the group chat, so the chat feels alive */
export function chatBack(text: string, rand: () => number) {
  const t = text.toLowerCase();
  if (/\?/.test(t)) return pickOf(['Me! 🙋', 'Yes oo', 'Not me 😂', 'Ask the DJ', 'Later later', 'I dey come'], rand);
  return pickOf(['😂😂', 'True!', 'Facts', 'Eiii', 'We move 🔥', 'Same', 'Lol', '💯'], rand);
}
