// The Community tab: friends, hall and course mates, crews, messages, dating (18+, opt-in),
// the feed and Vibe Ride, all following each rider's privacy. Code: src/features/community/.
import { bind, initCommunity, render } from '../features/community';
import { registerTab } from './registry';

initCommunity();
registerTab('community', { render, bind });
