// Store tab: "what I can get next". Featured collection, limited drop, free daily item, categories,
// search, bundles and the currency page. Product pages and buying live in features/garage.
import { registerTab } from './registry';
import { H } from '../features/host';
import { bindCommon } from '../features/garage/ui';
import { bindStore, storeHtml, store, type Cat } from '../features/garage/store-ui';
import { unmountStage } from '../features/garage/preview';

registerTab('store', {
  render: () => storeHtml(H().profile()),
  bind(root) {
    unmountStage();
    bindCommon(root);
    return bindStore(root);
  },
});

/** opens the Store tab at a category (results screen, Garage links) */
export function openStore(cat: Cat = 'featured') {
  store.cat = cat;
  store.sub = 'all';
  store.q = '';
  H().home('store');
}
