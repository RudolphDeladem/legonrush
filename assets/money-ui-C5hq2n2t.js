import{o as e}from"./campus-Tb9Sk4Ms.js";import{n as t,t as n}from"./cloud-config-Zo246MEV.js";import{f as r,t as i}from"./cloud-O25x3nui.js";import{n as a,s as o,t as s}from"./routes-Ds0WGqj7.js";import{F as c,a as l,c as u,i as d,l as f,r as p,s as m,t as h}from"./host-BZoY8u8y.js";function g(){return``}var _=()=>/^pk_(test|live)_/.test(g()),ee=()=>g().startsWith(`pk_test_`);async function te(){if(!i)return null;try{let{data:e}=await(await r()).auth.getSession();return e.session?.access_token??null}catch{return null}}async function v(e,r){if(!_())return{ok:!1,code:`not_ready`,message:`Coming soon.`};let i=await te(),a={apikey:t};i&&(a.Authorization=`Bearer ${i}`),r!==void 0&&(a[`Content-Type`]=`application/json`);try{let t=await fetch(`${n}/${e}`,{method:r===void 0?`GET`:`POST`,headers:a,body:r===void 0?void 0:JSON.stringify(r)}),i=await t.json().catch(()=>null);return i&&typeof i.ok==`boolean`?i:{ok:!1,code:t.status===404?`not_ready`:`server`,message:t.status===404?`Coming soon.`:`Something went wrong. Try again in a minute.`}}catch{return{ok:!1,code:`offline`,message:`No connection. Check your data or Wi-Fi.`}}}var y=e=>`GHS ${e%100?(e/100).toFixed(2):String(e/100)}`,ne=()=>v(`paystack-init`),re=e=>v(`paystack-init`,{bundle:e,return_to:`${location.origin}/legonrush/play/`}),b=e=>v(`paystack-init`,{verify:e}),ie=()=>v(`paystack-init`,{claim:!0}),x=[{id:`mtn`,name:`MTN MoMo`},{id:`telecel`,name:`Telecel Cash`},{id:`airteltigo`,name:`AirtelTigo Money`}],ae=()=>v(`cashout`),oe=e=>v(`cashout`,e),se=()=>v(`submit-run`),S=null;async function ce(e){let t=await v(`submit-run`,{action:`start`});return t.ok&&(S={id:t.ticket,route:t.route||e,at:Date.now()}),t}async function C(e,t,n){if(!S||!w(e.id))return null;let r=S;return S=null,t.finished?v(`submit-run`,{action:`finish`,ticket:r.id,route:e.id,time:t.time,finished:t.finished,length:e.length,trace:n}):null}var w=e=>!!S&&S.route===e&&Date.now()-S.at<36e5,T=e=>`<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e}</svg>`,E={wallet:T(`<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>`),phone:T(`<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>`),receipt:T(`<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>`),cash:T(`<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>`),podium:T(`<path d="M9 21V9h6v12M3 21v-7h6M15 21v-5h6v5M2 21h20"/><path d="M12 3.5l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.6l2-.3z"/>`),clockI:T(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),doc:T(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>`),x:T(`<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>`),soon:T(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M4.5 4.5l2 2"/>`)},D=[`1st`,`2nd`,`3rd`,`4th`,`5th`,`6th`,`7th`,`8th`,`9th`,`10th`],O=new Intl.DateTimeFormat(`en-GB`,{day:`numeric`,month:`short`}),le=new Intl.DateTimeFormat(`en-GB`,{weekday:`short`,hour:`2-digit`,minute:`2-digit`,timeZone:`Africa/Accra`});function ue(e){if(e===s.id)return s;let t=a.find(t=>t.id===e);return t?o(t):null}var k=e=>e===s.id?s.name:a.find(t=>t.id===e)?.name??e,A=(e,t)=>{let n=h().app.querySelector(e);return n&&(n.innerHTML=t),n},j=e=>`<div class="mn-loading"><span class="mn-spin"></span><span class="muted small">${d(e)}</span></div>`;function M(e,t,n){return`<div class="card mn-soon">
    <div class="mn-soon-ico">${n}</div>
    <span class="badge gold">${E.clockI} Coming soon</span>
    <h3>${d(e)}</h3>
    <p class="muted small">${t}</p>
  </div>`}function N(e){return`<div class="card stack mn-signin" style="gap:8px">
    <div class="row">${f.lock}<b>Sign in first</b></div>
    <p class="muted small">${d(e)}</p>
    <button class="btn btn-primary" data-mn-signin>Go to sign in</button>
  </div>`}var P=()=>m(`[data-mn-signin]`,`click`,()=>h().home(`you`));function F(e,t=`info`,n=7e3){document.querySelector(`.mn-notice`)?.remove();let r=document.createElement(`div`);r.className=`mn-notice light-ui ${t}`,r.setAttribute(`role`,`status`),r.innerHTML=e,document.body.appendChild(r),r.addEventListener(`click`,()=>r.remove()),setTimeout(()=>r.remove(),n)}var I=`<button class="btn btn-link mn-terms-link" data-mn-terms>Prize and payment terms</button>`;function L(e){m(`[data-mn-terms]`,`click`,()=>Q(e))}var R=[{id:`coins-500`,coins:500,price:500,label:`Pocket`},{id:`coins-1200`,coins:1200,price:1e3,label:`Saddle bag`,tag:`+20% coins`},{id:`coins-3000`,coins:3e3,price:2e3,label:`Backpack`,tag:`Popular`},{id:`coins-8000`,coins:8e3,price:5e3,label:`Treasure chest`,tag:`Best value`}];function z(e,t){return`<div class="card mn-bundle">
    ${e.tag?`<span class="mn-tag">${d(e.tag)}</span>`:``}
    <div class="mn-coins">${f.coin}<b>${l(e.coins)}</b></div>
    <p class="muted small">${d(e.label)}</p>
    ${t}
  </div>`}function B(e){return e.status===`checking`?`<div class="card mn-pay">${j(`Checking your payment with Paystack…`)}</div>`:e.status===`paid`?`<div class="card mn-pay ok"><div class="mn-pay-ico">${f.check}</div><div><b>Payment received</b><p class="muted small">${e.coins?`${l(e.coins)} Rush Coins added to your account.`:`Your coins are in your account.`} Thank you!</p></div></div>`:e.status===`pending`?`<div class="card mn-pay"><div class="mn-pay-ico">${E.clockI}</div><div><b>Waiting for your payment</b><p class="muted small">If you approved it on your phone, it can take a minute to confirm. Your coins are added as soon as it does, even if you close the game.</p><button class="btn btn-ghost btn-sm" data-mn-recheck>Check again</button></div></div>`:`<div class="card mn-pay bad"><div class="mn-pay-ico">${E.x}</div><div><b>Payment didn't go through</b><p class="muted small">No money was taken for coins. You can try again below.</p></div></div>`}function V(e=()=>h().home(),t){let n=h().profile(),r=_();u(`
    <div class="row"><div><p class="kicker">Shop</p><h1 class="title">Buy Rush Coins</h1></div><span class="grow"></span><span class="chip">${f.coin} <span class="mn-balance">${l(n.coins)}</span></span></div>
    ${r&&ee()?`<p class="mn-test">Test mode: no real money is taken.</p>`:``}
    <div id="mnPay">${t?B(t):``}</div>
    ${r?`<div id="mnBundles">${j(`Loading bundles…`)}</div>`:`${M(`Coin bundles are coming soon`,`Soon you can top up Rush Coins with MTN MoMo, Telecel Cash, AirtelTigo Money or a bank card. Until then, earn coins by riding, racing and finishing challenges.`,E.cash)}
         <div class="mn-bundles soon">${R.map(e=>z(e,`<button class="btn btn-ghost btn-sm" disabled>${y(e.price)}</button>`)).join(``)}</div>`}
    <div class="card mn-fine">
      <p class="small">${f.shield} Payments are handled by <b>Paystack</b>: Mobile Money (MTN, Telecel, AirtelTigo) or card. LEGONRUSH never sees your PIN or card number.</p>
      <p class="small muted">Rush Coins are for the game only. They can't be cashed out, swapped for money or used in prize races, which are free for everyone.</p>
      ${I}
    </div>`,e,`mn-screen`),L(()=>V(e)),m(`[data-mn-recheck]`,`click`,()=>t&&void W(t.ref,e)),r&&H(e)}async function H(e){let t=await ne();if(!h().app.querySelector(`#mnBundles`))return;if(!t.ok||!t.enabled){A(`#mnBundles`,t.ok||t.code===`not_ready`?M(`Coin bundles are coming soon`,`Payments are being set up. Check back soon.`,E.cash):`<div class="card"><p class="muted small">${d(t.message)}</p><button class="btn btn-ghost btn-sm" data-mn-retry>Try again</button></div>`),m(`[data-mn-retry]`,`click`,()=>V(e));return}let n=!!i;A(`#mnBundles`,`
    ${n?``:N(`Coins you buy are saved to your account, so you need one to buy them.`)}
    <div class="mn-bundles">${t.bundles.map(e=>z(e,`<button class="btn btn-primary btn-sm" data-mn-buy="${d(e.id)}" ${n?``:`disabled`}>${y(e.price)}</button>`)).join(``)}</div>
    <p class="mn-error" id="mnErr" hidden></p>`),P(),m(`[data-mn-buy]`,`click`,async(t,n)=>{let r=n;h().app.querySelectorAll(`[data-mn-buy]`).forEach(e=>e.disabled=!0),r.innerHTML=`<span class="mn-spin sm"></span> Opening…`;let i=await re(r.dataset.mnBuy);if(i.ok){try{sessionStorage.setItem(`legonrush.pay`,i.reference)}catch{}location.assign(i.authorization_url);return}let a=A(`#mnErr`,d(i.message));a&&(a.hidden=!1),H(e)})}async function U(){let e=await ie();if(!e.ok||!e.coins)return 0;let t=h().profile();return t.coins+=e.coins,c(t),h().app.querySelectorAll(`.mn-balance, .coin-count`).forEach(e=>e.textContent=l(t.coins)),e.coins}async function W(e,t){A(`#mnPay`,B({ref:e,status:`checking`}));let n=await b(e),r=n.ok?n.status:`pending`,i=r===`paid`?await U():0;h().app.querySelector(`#mnPay`)&&V(t,{ref:e,status:r,coins:i})}function de(){return`<button class="card selectable mn-prize-card" data-money-open="prize" data-money-back="events">
    <div class="row"><h3>${E.podium} WEEKLY PRIZE RACE</h3><span class="grow"></span><span class="badge gold">${_()?`Free entry`:`Coming soon`}</span></div>
    <p class="muted small">Ride one race all week. The three fastest riders win cash prizes, paid to Mobile Money. Free to enter.</p>
  </button>`}function fe(e){let t=e?.prizes.filter(e=>e>0).length||3;return`<div class="card mn-rules">
    <h3>${f.flag} How it works</h3>
    <ol>
      <li><b>Free to enter.</b> No purchase needed. Everyone rides the same City bike with no upgrades, helmets or energy drinks, on Normal, in clear weather: nothing you own or buy helps.</li>
      <li>Have an account and press <b>Ride the prize race</b> on this screen. Ride as often as you like; your best time counts.</li>
      <li>Every result is <b>checked by our server</b> against the recording of your ride. Results that don't add up don't count.</li>
      <li>When the week ends (Sunday 23:59, Ghana time) the top ${t} win. Ties go to whoever set the time first.</li>
      <li>Prizes go to your <b>Wallet</b>, and you cash out to MTN MoMo, Telecel Cash or AirtelTigo Money.</li>
      <li>Under 18? You can race, but a parent or guardian must agree before you cash out.</li>
      <li>Cheating, bots or shared accounts mean disqualification and no prize.</li>
    </ol>
    ${I}
  </div>`}function G(e){return`<div class="mn-podium">${e.slice(0,3).map((e,t)=>`<div class="mn-step p${t+1}"><span>${D[t]}</span><b>${y(e)}</b></div>`).join(``)}</div>
    ${e.length>3?`<p class="muted small" style="text-align:center">${e.slice(3).map((e,t)=>`${D[t+3]}: ${y(e)}`).join(` · `)}</p>`:``}`}function pe(e){let t=Date.parse(e)-Date.now();if(t<=0)return`Ended`;let n=Math.floor(t/864e5),r=Math.floor(t%864e5/36e5);return n?`${n} day${n===1?``:`s`} ${r} h left`:r?`${r} h left`:`${Math.max(1,Math.round(t/6e4))} min left`}function K(e=()=>h().home(`events`)){let t=_();u(`
    <p class="kicker">Events</p>
    <h1 class="title">Weekly prize race</h1>
    ${t?`<div id="mnPrize">${j(`Loading this week's race…`)}</div>`:`${M(`Weekly prize race: coming soon`,`Each week, one race with cash prizes for the three fastest riders, paid to Mobile Money. Free to enter. Get practising on the races in the Race tab.`,E.podium)}
         ${G([2e4,1e4,5e3])}`}
    ${fe()}`,e,`mn-screen`),L(()=>K(e)),t&&me(e)}async function me(t){let n=await se();if(!h().app.querySelector(`#mnPrize`))return;if(!n.ok){A(`#mnPrize`,n.code===`not_ready`?M(`Weekly prize race: coming soon`,`Prize races are being set up. Check back soon.`,E.podium):`<div class="card"><p class="muted small">${d(n.message)}</p><button class="btn btn-ghost btn-sm" data-mn-retry>Try again</button></div>`),m(`[data-mn-retry]`,`click`,()=>K(t));return}let r=n.event;if(!r){A(`#mnPrize`,`<div class="card mn-soon"><div class="mn-soon-ico">${E.podium}</div><h3>No prize race this week</h3><p class="muted small">A new one starts on Monday. Keep practising on the races in the Race tab.</p></div>`);return}let a=ue(r.route),o=n.mine??[],s=o.filter(e=>e.accepted).reduce((e,t)=>Math.min(e,t.time),1/0);A(`#mnPrize`,`
    <div class="card mn-event">
      <div class="row"><span class="badge gold">${f.flag} Live</span><span class="grow"></span><span class="muted small">${E.clockI} ${d(pe(r.ends_at))}</span></div>
      <h2>${d(r.title)}</h2>
      <p class="muted small">Route: <b>${d(k(r.route))}</b> · ${(r.route_length/1e3).toFixed(1)} km · ends ${d(le.format(new Date(r.ends_at)))}</p>
      ${r.sponsor?`<p class="mn-sponsor">Prizes by <b>${d(r.sponsor)}</b></p>`:``}
      ${G(r.prizes)}
      ${i?a?`<button class="btn btn-primary" id="mnRide">Ride the prize race</button>`:`<p class="mn-error">Update the game to ride this week's race.</p>`:N(`Prize races need an account, so we know who to pay.`)}
      <p class="mn-error" id="mnErr" hidden></p>
    </div>
    ${i?`<div class="card mn-mine">
      <h3>${f.target} Your week</h3>
      ${n.my_place?`<p>You're <b>${D[n.my_place-1]??`#${n.my_place}`}</b> of ${n.riders} with <b>${p(s)}</b>.</p>`:`<p class="muted small">No accepted time yet. Ride the race to get on the board.</p>`}
      ${o.length?`<div class="mn-tries">${o.map(e=>`<div class="mn-try ${e.accepted?`ok`:`bad`}">${e.accepted?f.check:E.x}<span>${p(e.time)}</span><small>${e.accepted?`Accepted`:d(e.reason??`Not accepted`)}</small></div>`).join(``)}</div>`:``}
    </div>`:``}
    <div class="card board mn-board">
      <div class="row"><h3>${f.trophy} Leaderboard</h3><span class="grow"></span><span class="muted small">${n.riders} rider${n.riders===1?``:`s`}</span></div>
      ${n.board.length?n.board.map(t=>`<div class="board-row${t.me?` me`:``}${t.place<=r.prizes.length?` prize`:``}"><span class="rank">${t.place}</span><span class="hall-swatch" style="background:${e(t.hall).color}"></span><span class="grow">${d(t.name)}<small>${t.username?`@${d(t.username)} · `:``}${d(e(t.hall).short)}</small></span><b>${p(t.best)}</b>${r.prizes[t.place-1]?`<em class="mn-win">${y(r.prizes[t.place-1])}</em>`:``}</div>`).join(``):`<p class="muted small">No times yet this week. Be the first!</p>`}
    </div>`),P(),m(`#mnRide`,`click`,async(e,t)=>{let n=t;n.disabled=!0,n.innerHTML=`<span class="mn-spin sm"></span> Getting your start ticket…`;let i=await ce(r.route);if(!i.ok){n.disabled=!1,n.textContent=`Ride the prize race`;let e=A(`#mnErr`,d(i.message));e&&(e.hidden=!1);return}h().play(a,{})})}var he=e=>w(e),ge=`city`;function _e(e,t){e.setUpgrades({speed:0,grip:0,boost:0}),e.setRideItems({energy:!1,repairKits:0}),e.setDifficulty(`normal`),e.setWeather(`clear`),e.setGear(0,t)}function ve(e,t,n){if(w(e.id)){if(!t.finished){C(e,t,n),F(`${f.flag} <span>Prize race: only finished rides count. Try again from the Weekly prize race screen.</span>`,`info`);return}F(`<span class="mn-spin sm"></span> <span>Checking your prize race time…</span>`,`info`,3e4),C(e,t,n).then(e=>{if(e){if(!e.ok)return F(`${E.x} <span>Prize race: ${d(e.message)}</span>`,`bad`,9e3);e.accepted?F(`${f.check} <span><b>Prize race time accepted: ${p(e.time)}.</b> You're ${D[e.place-1]??`#${e.place}`} of ${e.riders} this week.</span>`,`ok`,9e3):F(`${E.x} <span><b>Prize race time not accepted.</b> ${d(e.message)}</span>`,`bad`,1e4)}})}}var q=Object.fromEntries(x.map(e=>[e.id,e.name])),J={pending:`Waiting for approval`,processing:`On its way`,sent:`Sent`,failed:`Failed, money returned`};function Y(e=()=>h().home(`you`)){let t=_();u(`
    <p class="kicker">You</p>
    <h1 class="title">Wallet</h1>
    ${t?i?`<div id="mnWallet">${j(`Loading your wallet…`)}</div>`:N(`Your wallet holds prize money, so it belongs to your account.`):`${M(`Prize wallet: coming soon`,`When weekly prize races start, the money you win lands here and you can cash it out to your Mobile Money.`,E.wallet)}
      <div class="card mn-balance-card soon"><span class="muted small">Prize money</span><b>GHS 0</b></div>`}
    <div class="card mn-fine">
      <p class="small">${E.wallet} Only prize money from weekly prize races goes in your wallet. Rush Coins, bought or earned, have no cash value and can't be cashed out.</p>
      ${I}
    </div>`,e,`mn-screen`),P(),L(()=>Y(e)),t&&i&&X(e)}async function X(e,t){let n=await ae();if(!h().app.querySelector(`#mnWallet`))return;if(!n.ok){A(`#mnWallet`,n.code===`not_ready`?M(`Prize wallet: coming soon`,`Cash-outs are being set up. Check back soon.`,E.wallet):`<div class="card"><p class="muted small">${d(n.message)}</p><button class="btn btn-ghost btn-sm" data-mn-retry>Try again</button></div>`),m(`[data-mn-retry]`,`click`,()=>Y(e));return}let r=n.payouts.find(e=>e.status===`pending`||e.status===`processing`),i=!r&&n.balance>=n.min;A(`#mnWallet`,`
    ${t?`<div class="card mn-pay ${t.ok?`ok`:`bad`}" id="mnResult"><div class="mn-pay-ico">${t.ok?f.check:E.x}</div><div><b>${t.ok?`Cash-out requested`:`Cash-out failed`}</b><p class="muted small">${d(t.message)}</p></div></div>`:``}
    <div class="card mn-balance-card"><span class="muted small">Prize money</span><b>${y(n.balance)}</b>
      <small class="muted">${n.balance?`You can cash out from ${y(n.min)}.`:`Win a weekly prize race to fill it.`}</small></div>
    ${r?`<div class="card mn-open"><div class="row">${E.clockI}<b>${y(r.amount_pesewas)} to ${d(q[r.network]??r.network)} ${d(r.momo_number)}</b></div><p class="muted small">${J[r.status]}. ${r.status===`pending`?`Prize cash-outs are checked by hand, usually within 2 working days.`:`It should arrive in a few minutes.`}</p></div>`:``}
    ${i?ye(n):``}
    <div class="card mn-history">
      <h3>${E.receipt} History</h3>
      ${n.history.length?n.history.map(e=>`<div class="mn-hrow"><span class="grow">${d(e.note??e.kind)}<small>${d(O.format(new Date(e.created_at)))}</small></span><b class="${e.amount_pesewas>=0?`plus`:`minus`}">${e.amount_pesewas>=0?`+`:`−`}${y(Math.abs(e.amount_pesewas))}</b></div>`).join(``):`<p class="muted small">Nothing yet.</p>`}
      ${n.payouts.length?`<h4>Cash-outs</h4>${n.payouts.map(e=>`<div class="mn-hrow"><span class="grow">${d(q[e.network]??e.network)} ${d(e.momo_number)}<small>${d(O.format(new Date(e.created_at)))}${e.failure_reason?` · ${d(e.failure_reason)}`:``}</small></span><span class="mn-status ${e.status}">${J[e.status]}</span><b>${y(e.amount_pesewas)}</b></div>`).join(``)}`:``}
    </div>`),i&&be(n,e)}function ye(e){return`<form class="card stack mn-cash" id="mnCash" novalidate>
    <h3>${E.phone} Cash out to Mobile Money</h3>
    <div class="field"><label for="mnAmt">Amount (GHS)</label><input id="mnAmt" inputmode="decimal" value="${(e.balance/100).toFixed(2)}" autocomplete="off"></div>
    <div class="field"><label>Network</label><div class="mn-nets">${x.map((e,t)=>`<button type="button" class="chip-btn${t===0?` on`:``}" data-net="${e.id}">${d(e.name)}</button>`).join(``)}</div></div>
    <div class="field"><label for="mnNum">Mobile Money number</label><input id="mnNum" type="tel" inputmode="tel" placeholder="024 123 4567" autocomplete="tel"></div>
    <div class="field"><label for="mnName">Name on the Mobile Money account</label><input id="mnName" autocomplete="name" placeholder="As registered with your network"></div>
    <label class="mn-check"><input type="checkbox" id="mnAdult"> <span>I am 18 or older, or my parent or guardian agrees to this cash-out.</span></label>
    <p class="mn-error" id="mnErr" hidden></p>
    <div id="mnConfirm"></div>
    <button class="btn btn-primary" id="mnGo">Continue</button>
  </form>`}function Z(e){let t=e.replace(/[^0-9]/g,``),n=t.startsWith(`233`)?`0`+t.slice(3):t;return/^0[25][0-9]{8}$/.test(n)?n:null}function be(e,t){let n=h().app,r=x[0].id,i=e=>n.querySelector(e),a=e=>{let t=i(`#mnErr`);t.textContent=e,t.hidden=!e},o=i(`#mnCash`),s=()=>{i(`#mnConfirm`).innerHTML=``,i(`#mnGo`).hidden=!1};m(`[data-net]`,`click`,(e,t)=>{r=t.dataset.net,n.querySelectorAll(`[data-net]`).forEach(e=>e.classList.toggle(`on`,e===t)),s()}),o.addEventListener(`input`,s),o.addEventListener(`submit`,n=>{n.preventDefault(),a(``);let o=Math.round(Number(i(`#mnAmt`).value.replace(/[^0-9.]/g,``))*100),c=Z(i(`#mnNum`).value),l=i(`#mnName`).value.trim();if(!o||o<e.min)return a(`The smallest cash-out is ${y(e.min)}.`);if(o>e.balance)return a(`You have ${y(e.balance)} in your wallet.`);if(!c)return a(`Enter a Ghana Mobile Money number, like 024 123 4567.`);if(l.length<3)return a(`Enter the name on the Mobile Money account.`);if(!i(`#mnAdult`).checked)return a(`Tick the box to confirm your age, or that a parent or guardian agrees.`);i(`#mnGo`).hidden=!0,i(`#mnConfirm`).innerHTML=`<div class="mn-confirm">
      <p>Send <b>${y(o)}</b> to <b>${d(q[r])} ${d(c.replace(/(\d{3})(\d{3})(\d{4})/,`$1 $2 $3`))}</b> (${d(l)})?</p>
      <p class="muted small">Check the number: money sent to the wrong number may not come back.</p>
      <div class="two"><button type="button" class="btn btn-ghost" id="mnEdit">Edit</button><button type="button" class="btn btn-primary" id="mnSend">Cash out</button></div>
    </div>`,m(`#mnEdit`,`click`,s),m(`#mnSend`,`click`,async(e,n)=>{n.disabled=!0,n.innerHTML=`<span class="mn-spin sm"></span> Sending…`;let i=await oe({amount:o,network:r,number:c,name:l,adult:!0});A(`#mnWallet`,j(`Updating your wallet…`)),await X(t,i.ok?{ok:!0,message:i.message}:{ok:!1,message:i.message})})})}function Q(e){u(`
    <p class="kicker">LEGONRUSH</p>
    <h1 class="title">Prize and payment terms</h1>
    <div class="card mn-terms">
      <h3>Weekly prize races</h3>
      <ul>
        <li><b>No purchase necessary.</b> Prize races are free to enter. Buying coins, bikes or upgrades does not improve your chances: every prize ride uses the same standard bike and settings, and results are judged on time only.</li>
        <li>Prizes are paid by LEGONRUSH and, when named, by the week's sponsor. The prize table is shown on the race screen before you ride.</li>
        <li>You need a LEGONRUSH account. One account per person. Only results sent from the Weekly prize race screen while the week is open count.</li>
        <li>Each result is checked by our server against the recording of the ride. We can refuse any result that doesn't match what the game allows, and may review winning rides before paying.</li>
        <li>The fastest accepted time per rider counts. If two riders tie, the one who set the time first ranks higher. Results are final when the week closes, Sunday 23:59 Ghana time.</li>
        <li>Cheating, modified games, bots, automated tools, sharing accounts or riding for someone else means disqualification, loss of prizes and possibly the account.</li>
      </ul>
      <h3>Wallet and cash-outs</h3>
      <ul>
        <li>Prize money is credited to your Wallet in Ghana cedis and can be cashed out to MTN MoMo, Telecel Cash or AirtelTigo Money in your own name.</li>
        <li>Riders under 18 may race, but need a parent or guardian's permission to cash out. We may ask for proof of identity or permission before paying.</li>
        <li>There is a minimum cash-out amount and one cash-out at a time. If a cash-out fails, the money goes back to your Wallet.</li>
        <li>Unclaimed prize money stays in your Wallet. You are responsible for entering the right number.</li>
      </ul>
      <h3>Buying Rush Coins</h3>
      <ul>
        <li>Payments are processed by Paystack. Prices are in Ghana cedis and shown before you pay.</li>
        <li><b>Rush Coins have no cash value.</b> They can't be cashed out, refunded for money, transferred or sold, and they are never prize money.</li>
        <li>Coins are added once Paystack confirms the payment. If you paid and didn't get your coins, contact us with the payment reference.</li>
      </ul>
      <p class="muted small">LEGONRUSH may change or cancel a prize race for a fair reason (for example a bug or fraud), announcing it in the game. Questions: contact LEGONRUSH through the game's social pages.</p>
    </div>`,e,`mn-screen`)}function xe(){let e=(e,t,n,r=``)=>`<button class="fx-link" data-money-open="${e}" data-money-back="you"><span class="fx-ico">${t}</span><span>${n}</span>${r}</button>`;return`<div class="fx-links mn-links">
    ${e(`wallet`,E.wallet,`Wallet`)}
    ${e(`prize`,E.podium,`Prize race`)}
    ${e(`coins`,f.coin,`Buy coins`)}
  </div>`}var Se=()=>`<button class="btn btn-ghost btn-sm mn-buy-btn" data-money-open="coins" data-money-back="garage">${f.coin} Buy coins</button>`,$=!1;function Ce(){$||($=!0,h().app.addEventListener(`click`,e=>{let t=e.target,n=t.closest(`.coin-pill`),r=t.closest(`[data-money-open]`);if(!n&&!r)return;let i=r?.dataset.moneyBack,a=i===`garage`?()=>h().garage():i===`you`||i===`events`?()=>h().home(i):()=>h().home(),o=r?.dataset.moneyOpen??`coins`;o===`wallet`?Y(a):o===`prize`?K(a):V(a)}))}async function we(){let e=new URL(location.href),t=e.searchParams.get(`reference`)??e.searchParams.get(`trxref`);if(t||e.searchParams.has(`paid`)){for(let t of[`reference`,`trxref`,`paid`])e.searchParams.delete(t);history.replaceState(history.state,``,e.pathname+e.search+e.hash)}try{t??=sessionStorage.getItem(`legonrush.pay`),sessionStorage.removeItem(`legonrush.pay`)}catch{}if(!_()||!i)return;if(t&&/^[A-Za-z0-9_.=-]{6,80}$/.test(t)){for(let e=0;e<40&&(h().app.querySelector(`.splash`)||!h().app.firstElementChild);e++)await new Promise(e=>setTimeout(e,150));return V(()=>h().home(),{ref:t,status:`checking`}),W(t,()=>h().home())}let n=await U();n&&F(`${f.coin} <span><b>+${l(n)} Rush Coins</b> from your purchase. Thank you!</span>`,`ok`)}export{Ce as a,E as c,de as d,K as f,xe as g,Y as h,V as i,Z as l,Q as m,we as n,he as o,Se as p,ve as r,_e as s,ge as t,F as u};