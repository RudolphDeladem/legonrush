const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/dating-DrEKmDmT.js","assets/dating-CDaUeTrK.js","assets/host-BZoY8u8y.js","assets/host-C2_Kq0qi.css","assets/people-BO9XCCp9.js","assets/campus-Tb9Sk4Ms.js","assets/cloud-O25x3nui.js","assets/cloud-config-Zo246MEV.js","assets/icons-B1WEXSUY.js","assets/people-DTJXEos_.css","assets/chat-oAuUI3lD.js"])))=>i.map(i=>d[i]);
import{x as e}from"./cloud-O25x3nui.js";import{c as t,i as n,t as r}from"./host-BZoY8u8y.js";import{Dt as i,N as a,T as o,f as s,g as c,k as l,n as u,w as d,wt as f,xt as p,z as m}from"./people-BO9XCCp9.js";import{t as h}from"./icons-B1WEXSUY.js";function g(t){let n=r().profile(),u=m(n),f=new Set(u.statuses),p=i(n)===`ok`,h=d(`${o(`Your social status`)}
    <p class="muted small">Tell riders what kind of connection you're open to. You can pick more than one.</p>
    <div class="cm-status-pick">${s.map(([e,t,n,r])=>{let i=e===`dating`&&!p;return`<button class="cm-status-opt ${e}${f.has(e)?` on`:``}" data-s="${e}" ${i?`disabled`:``}><span class="cm-st-ico">${t}</span><span><b>${n}</b><small>${i?`For riders 18+. Add your birthday in Dating.`:r}</small></span><i class="cm-tick">${c.check}</i></button>`}).join(``)}</div>
    <label class="cm-switch"><span><b>Show my status</b><small>Off: you can still use Community, but your status isn't shown and you're not listed in Find your people.</small></span><input type="checkbox" id="cmShowSt" ${u.showStatus?`checked`:``}><i></i></label>
    <button class="btn btn-primary" id="cmStSave">Save</button>`);h.el.querySelectorAll(`[data-s]`).forEach(e=>e.addEventListener(`click`,()=>{let t=e.dataset.s;f.has(t)?f.delete(t):(t===`none`?f.clear():f.delete(`none`),f.add(t)),h.el.querySelectorAll(`[data-s]`).forEach(e=>e.classList.toggle(`on`,f.has(e.dataset.s)))})),h.el.querySelector(`#cmStSave`).addEventListener(`click`,()=>{f.has(`dating`)&&!u.dating.on&&(f.delete(`dating`),l(`${c.heart} Turn on Dating first to show you're open to it`,[[`Set up Dating`,async()=>(await e(async()=>{let{datingScreen:e}=await import(`./dating-DrEKmDmT.js`);return{datingScreen:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10]))).datingScreen(),!0]])),u.statuses=[...f],u.showStatus=h.el.querySelector(`#cmShowSt`).checked,a(n),h.close(),t()})}var _=(e,t,n)=>`<div class="seg wide cm-seg" data-key="${e}">${t.map(([e,t])=>`<button data-v="${e}" class="${e===n?`on`:``}">${t}</button>`).join(``)}</div>`,v=(e,t,n,r)=>`<label class="cm-switch"><span><b>${t}</b><small>${n}</small></span><input type="checkbox" data-sw="${e}" ${r?`checked`:``}><i></i></label>`;function y(e=()=>r().home(`social`)){let i=r().profile(),o=m(i),s=o.privacy;t(`
    <div class="cm-head"><span class="cm-head-ico">${c.shield}</span><div><h1 class="title">Privacy &amp; safety</h1><p class="muted">You decide who finds you and what they see. These apply everywhere in LEGONRUSH.</p></div></div>
    ${p()?``:`<div class="cm-note">${h.info}<span>You're playing as a guest. These choices are saved on this phone and apply to Riders Online.</span></div>`}
    <section class="card stack cm-form">
      <b class="cm-label">Who can find me?</b>
      ${_(`findMe`,[[`everyone`,`Everyone`],[`fof`,`Friends of friends`],[`hall`,`Same hall`],[`course`,`Same course`],[`nobody`,`Nobody`]],s.findMe)}
      <b class="cm-label">Who can message me?</b>
      ${_(`messageMe`,[[`everyone`,`Everyone`],[`friends`,`Friends`],[`connections`,`Connections`],[`nobody`,`Nobody`]],s.messageMe)}
      <p class="muted small">Connections: friends, crew mates and Dating connections.</p>
      <b class="cm-label">Who can send me friend requests?</b>
      ${_(`requests`,[[`everyone`,`Everyone`],[`shared`,`Shared connections`],[`nobody`,`Nobody`]],s.requests)}
      <b class="cm-label">Who sees my game activity?</b>
      ${_(`activity`,[[`everyone`,`Everyone`],[`friends`,`Friends`],[`off`,`Nobody`]],s.activity)}
    </section>
    <section class="card stack cm-form">
      ${v(`showOnline`,`Show online status`,`Appear in Riders Online and as online to friends.`,s.showOnline)}
      ${v(`showHall`,`Show my hall`,`Your hall on your profile, hall mates and leaderboards.`,s.showHall)}
      ${v(`showCourse`,`Show my course`,`Your programme on your profile and course mates.`,s.showCourse)}
      ${v(`showStatus`,`Show my social status`,`Friends, riding buddies, competition… on your profile.`,o.showStatus)}
      ${v(`showMap`,`Show me on the map`,`While you ride, others can see roughly where on campus.`,s.showMap)}
      ${v(`showLevel`,`Show my academic level`,`Optional: lets level mates on your course find you.`,s.showLevel)}
      <div class="cm-level-row" ${s.showLevel?``:`hidden`}><label class="cm-label" for="cmLevel">My level</label><select class="cm-input" id="cmLevel">${[``,`100`,`200`,`300`,`400`,`500`,`600`].map(e=>`<option value="${e}" ${e===o.level?`selected`:``}>${e?`Level ${e}`:`Not set`}</option>`).join(``)}</select></div>
    </section>
    <section class="card stack cm-form">
      <b class="cm-label">${c.bell} Notifications</b>
      ${[[`friends`,`Friends`,`Requests, accepts and follows`],[`messages`,`Messages`,`New private and crew messages`],[`crews`,`Crews`,`Join requests and crew news`],[`dating`,`Dating`,`New connections`],[`feed`,`Reactions`,`When someone reacts to your post`]].map(([e,t,n])=>v(`n:${e}`,t,n,o.notify[e])).join(``)}
    </section>
    <section class="card stack cm-form">
      <b class="cm-label">${c.block} Blocked riders</b>
      <p class="muted small">Blocked riders can't find you, message you, invite you or see your posts.</p>
      <div id="cmBlocked" class="cm-list"></div>
    </section>
    <p class="muted small">${h.shield} ${n(f)} To report someone, open their profile and tap Report.</p>`,e,`cm-screen`);let l=r().app;l.querySelectorAll(`.cm-seg`).forEach(e=>e.querySelectorAll(`button`).forEach(t=>t.addEventListener(`click`,()=>{s[e.dataset.key]=t.dataset.v,e.querySelectorAll(`button`).forEach(e=>e.classList.toggle(`on`,e===t)),a(i)}))),l.querySelectorAll(`[data-sw]`).forEach(e=>e.addEventListener(`change`,()=>{let t=e.dataset.sw;t.startsWith(`n:`)?o.notify[t.slice(2)]=e.checked:t===`showStatus`?o.showStatus=e.checked:s[t]=e.checked,t===`showLevel`&&(l.querySelector(`.cm-level-row`).hidden=!e.checked),a(i)})),l.querySelector(`#cmLevel`)?.addEventListener(`change`,e=>{o.level=e.target.value,a(i)}),u(l.querySelector(`#cmBlocked`))}export{g as n,y as t};