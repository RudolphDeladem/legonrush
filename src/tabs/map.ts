// Map tab: the full-screen campus map (src/features/map).
import { registerTab } from './registry';
import { bindMap, mapHtml } from '../features/map/ui';

registerTab('map', { bare: true, render: mapHtml, bind: bindMap });
