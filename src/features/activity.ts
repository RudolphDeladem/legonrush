// Game activity for the Community feed ("Kofi won Engineering Sprint"). Any system can post;
// the Community system decides how it is sent and shown. Until then posts wait on the phone.
export type ActivityKind = 'race_win' | 'pb' | 'treasure' | 'event_join' | 'event_done' | 'challenge_new' | 'challenge_win' | 'badge' | 'km' | 'hall' | 'post';
export interface Activity { kind: ActivityKind; text: string; ref?: string; at?: number }

type Sender = (a: Activity) => void;
let sender: Sender | null = null;
const queue: Activity[] = [];
export function postActivity(a: Activity) {
  const item = { ...a, at: a.at ?? Date.now() };
  if (sender) sender(item);
  else queue.push(item);
}
/** the Community system sets how activity is sent; anything posted earlier is sent then */
export function setActivitySender(s: Sender) {
  sender = s;
  while (queue.length) s(queue.shift()!);
}
