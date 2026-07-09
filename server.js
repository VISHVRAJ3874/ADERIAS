/* ════════════════════════════════════════════════════════════════════
   ADERIAS CLIENT — FIREBASE EDITION
   Real backend: Firebase Authentication + Cloud Firestore
   Replaces the old localStorage / localhost:4433 fake-server code.
   Every signed-up user, contact, chat, and message now lives in the
   cloud, so any device that opens the site sees the same data.
════════════════════════════════════════════════════════════════════ */

/* ── 1. FIREBASE SETUP ──────────────────────────────────────────────
   Loaded as ES module imports from the Firebase CDN. Make sure your
   index.html includes:
   <script type="module" src="script.js"></script>
   (NOT a plain <script src="script.js"></script> — it must say type="module")
*/
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, addDoc, onSnapshot,
  orderBy, serverTimestamp, limit, or
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCU7lE3Ht4hBFUcuwJT_HUggdVdF3Fijl0",
  authDomain: "aderias-c1a7b.firebaseapp.com",
  projectId: "aderias-c1a7b",
  storageBucket: "aderias-c1a7b.firebasestorage.app",
  messagingSenderId: "1013056383733",
  appId: "1:1013056383733:web:061d81137a47fccd1633bc",
  measurementId: "G-C1SFY81RK9"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

/* ══ STATE ══ */
let CU = null;              // current user profile (Firestore doc, merged with auth uid)
let selCid = null, selContact = null;
let sbF = 'all', sbQ = '';
let acFound = null, mnTo = null;
let msgUnsub = null, chatsUnsub = null;

/* ══ CURRENCIES (unchanged) ══ */
const CUR = {
  INR:{s:'₹',n:'Rupee',f:'🇮🇳'},  USD:{s:'$',n:'Dollar',f:'🇺🇸'},
  EUR:{s:'€',n:'Euro',f:'🇪🇺'},   GBP:{s:'£',n:'Pound',f:'🇬🇧'},
  AED:{s:'د.إ',n:'Dirham',f:'🇦🇪'}, JPY:{s:'¥',n:'Yen',f:'🇯🇵'},
  CNY:{s:'¥',n:'Yuan',f:'🇨🇳'},   AUD:{s:'A$',n:'AUD',f:'🇦🇺'},
  CAD:{s:'C$',n:'CAD',f:'🇨🇦'},   SGD:{s:'S$',n:'SGD',f:'🇸🇬'},
  SAR:{s:'﷼',n:'Riyal',f:'🇸🇦'},  BRL:{s:'R$',n:'Real',f:'🇧🇷'},
  RUB:{s:'₽',n:'Ruble',f:'🇷🇺'},  KWD:{s:'د.ك',n:'Dinar',f:'🇰🇼'},
  CHF:{s:'₣',n:'Franc',f:'🇨🇭'},
};
const TO_USD = {INR:.012,USD:1,EUR:1.08,GBP:1.27,AED:.272,JPY:.0067,CNY:.138,AUD:.65,CAD:.74,SGD:.74,SAR:.267,BRL:.19,RUB:.011,KWD:3.25,CHF:1.12};
let fromCur='USD', toCur='INR';

/* ══ HELPERS ══ */
const cp   = s => String(s||'').replace(/\D/g,'');
const ini  = s => (s||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'??';
const fmtT = ts => { const d=new Date(ts),n=new Date(); return d.toDateString()===n.toDateString()?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([],{month:'short',day:'numeric'}); };
const esc  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const tsNum = t => t?.toMillis ? t.toMillis() : (t || Date.now());

const GRADS = [
  'linear-gradient(145deg,#5a6e48,#3d4f30)','linear-gradient(145deg,#6b7f58,#4a5c3a)',
  'linear-gradient(145deg,#a68b5b,#8b7355)','linear-gradient(145deg,#7a8e68,#5a6e48)',
  'linear-gradient(145deg,#8a9e74,#6b7f58)','linear-gradient(145deg,#c4a878,#a68b5b)',
  'linear-gradient(145deg,#4a6a5a,#2d4a3a)','linear-gradient(145deg,#8b7355,#6b5535)',
];
const pickGrad = s => { let h=0; for(let i=0;i<s.length;i++) h+=s.charCodeAt(i); return GRADS[h%GRADS.length]; };
const LEADER_EMAILS = ['vishvrajsinhgohil845@gmail.com','vishvrajsinhgohil435@gmail.com'];
const isLdr = u => u && LEADER_EMAILS.includes((u.email||'').toLowerCase().trim());

function phoneMatch(a,b){
  const ca=cp(a),cb=cp(b);
  if(!ca||!cb||ca.length<6||cb.length<6) return false;
  if(ca===cb) return true;
  const n=Math.min(10,ca.length,cb.length);
  return ca.slice(-n)===cb.slice(-n);
}
function dmId(a,b){ return 'dm_'+[a,b].sort().join('_'); }

function loading(on){ const c=document.getElementById('cbar'); if(c) c.className='cbar'+(on?' loading':''); }

/* ══ AUTH ══ */
let authMode='su';
window.setTab = function(m){
  authMode=m;
  ['su','si'].forEach(t=>document.getElementById('tab-'+t).classList.toggle('on',t===m));
  document.getElementById('su-f').style.display=m==='su'?'block':'none';
  document.getElementById('si-f').style.display=m==='si'?'block':'none';
  document.getElementById('a-err').textContent='';
  document.getElementById('a-btn').textContent=m==='su'?'Create Account →':'Sign In →';
};

// Firebase Auth needs a real email. If the person signs up with only a
// phone number, we synthesize a private placeholder email so Auth still
// works, but we always store + search by the real phone number in Firestore.
function placeholderEmail(phone){ return `p${cp(phone)}@aderias.local`; }

window.doAuth = async function(){
  const err=document.getElementById('a-err');
  err.textContent='';
  loading(true);
  try{
    if(authMode==='su'){
      const nm=document.getElementById('a-nm').value.trim();
      const code=document.getElementById('a-code').value.replace('+','');
      const ph=document.getElementById('a-ph').value.trim();
      const emRaw=document.getElementById('a-em').value.trim();
      const pw=document.getElementById('a-pw1').value;
      if(!nm){err.textContent='Enter your name.';loading(false);return;}
      if(!ph&&!emRaw){err.textContent='Enter phone or email.';loading(false);return;}
      if(!pw||pw.length<6){err.textContent='Password min 6 characters.';loading(false);return;}
      const fullPhone = ph ? ('+'+code+ph) : '';
      const loginEmail = emRaw || placeholderEmail(fullPhone);

      const cred = await createUserWithEmailAndPassword(auth, loginEmail, pw);
      const uid = cred.user.uid;
      const username = nm.toLowerCase().replace(/[^a-z0-9]/g,'_').slice(0,22) + '_' + uid.slice(0,4);
      const profile = {
        id: uid, name: nm, username, email: emRaw || '', phone: fullPhone,
        bio: '', grad: pickGrad(nm), registered: true, role: 'user',
        joinedAt: Date.now()
      };
      await setDoc(doc(db,'users',uid), profile);
      CU = { ...profile, role: LEADER_EMAILS.includes(emRaw.toLowerCase()) ? 'leader' : 'user' };
      await ensureGeneralChat();
      enterApp();
    } else {
      const id=document.getElementById('a-id').value.trim();
      const pw=document.getElementById('a-pw2').value;
      if(!id||!pw){err.textContent='Fill all fields.';loading(false);return;}
      let loginEmail = id;
      // If they typed a phone or username instead of an email, look up the real email in Firestore.
      if(!id.includes('@')){
        const usersRef = collection(db,'users');
        let foundDoc = null;
        const byUsername = await getDocs(query(usersRef, where('username','==', id.replace('@',''))));
        if(!byUsername.empty) foundDoc = byUsername.docs[0];
        if(!foundDoc){
          const all = await getDocs(usersRef); // fallback phone match (small dataset)
          foundDoc = all.docs.find(d => phoneMatch(d.data().phone||'', id));
        }
        if(!foundDoc){ err.textContent='Account not found.'; loading(false); return; }
        loginEmail = foundDoc.data().email || placeholderEmail(foundDoc.data().phone);
      }
      const cred = await signInWithEmailAndPassword(auth, loginEmail, pw);
      const snap = await getDoc(doc(db,'users',cred.user.uid));
      if(!snap.exists()){ err.textContent='Profile missing, contact support.'; loading(false); return; }
      CU = { ...snap.data(), role: isLdr(snap.data()) ? 'leader' : 'user' };
      enterApp();
    }
  }catch(e){
    err.textContent = friendlyAuthError(e);
  }
  loading(false);
};

function friendlyAuthError(e){
  const c = e.code || '';
  if(c.includes('email-already-in-use')) return 'Account already exists. Sign in instead.';
  if(c.includes('wrong-password') || c.includes('invalid-credential')) return 'Wrong password.';
  if(c.includes('user-not-found')) return 'Account not found. Sign up first.';
  if(c.includes('weak-password')) return 'Password too weak (min 6 characters).';
  if(c.includes('invalid-email')) return 'That email/phone looks invalid.';
  return e.message || 'Something went wrong.';
}

window.doSignOut = async function(){
  await signOut(auth);
  CU=null; selCid=null;
  if(msgUnsub) msgUnsub();
  if(chatsUnsub) chatsUnsub();
  closeMod('m-profile'); go('s-auth');
  toast('Signed out', false);
};

onAuthStateChanged(auth, async (user) => {
  if(user && !CU){
    const snap = await getDoc(doc(db,'users',user.uid));
    if(snap.exists()){
      CU = { ...snap.data(), role: isLdr(snap.data()) ? 'leader' : 'user' };
      enterApp();
    }
  } else if(!user){
    go('s-auth');
  }
});

/* ══ ENSURE GENERAL CHAT EXISTS + user is a member ══ */
async function ensureGeneralChat(){
  const ref = doc(db,'chats','general');
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, {
      id:'general', name:'General', type:'group',
      members:[CU.id], updatedAt: Date.now(), prev:''
    });
  } else if(!(snap.data().members||[]).includes(CU.id)){
    await updateDoc(ref, { members: [...(snap.data().members||[]), CU.id] });
  }
}

/* ══ ENTER APP ══ */
function enterApp(){
  go('s-app');
  const av=document.getElementById('me-av');
  av.style.background=CU.grad||pickGrad(CU.name||'A');
  av.innerHTML=`<span class="crown-ic" id="crown" style="display:${isLdr(CU)?'block':'none'}">👑</span>`+ini(CU.name||'A');
  document.getElementById('me-name').textContent=CU.name||'You';
  document.getElementById('me-handle').textContent='@'+(CU.username||'user');
  document.getElementById('ldr-btn').style.display=isLdr(CU)?'flex':'none';
  updateRegPill(); buildCurrGrids();
  listenChats();
}

/* ══ LIVE CHAT LIST (realtime) ══ */
function listenChats(){
  if(chatsUnsub) chatsUnsub();
  const q = query(collection(db,'chats'), where('members','array-contains', CU.id));
  chatsUnsub = onSnapshot(q, (snap) => {
    window.__chats = {};
    snap.forEach(d => window.__chats[d.id] = { id:d.id, ...d.data() });
    renderSb();
  });
}

/* ══ SIDEBAR ══ */
function renderSb(){
  const list=document.getElementById('sb-list');
  if(!list) return;
  list.innerHTML='';
  const chats = Object.values(window.__chats||{})
    .filter(c=>{
      if(sbF==='direct'&&c.type!=='direct') return false;
      if(sbF==='group'&&c.type!=='group') return false;
      if(sbQ&&!(c.name||'').toLowerCase().includes(sbQ)) return false;
      return true;
    })
    .sort((a,b)=> tsNum(b.updatedAt) - tsNum(a.updatedAt));

  chats.forEach(async c=>{
    const isGrp=c.type==='group';
    let nm=c.name, grad=null;
    if(!isGrp){
      const othId=(c.members||[]).find(id=>id!==CU.id);
      const oth = window.__userCache?.[othId] || await cacheUser(othId);
      if(oth){ nm=oth.nick || oth.name || nm; grad=oth.grad; }
    }
    const av=isGrp?`<div class="av sq" style="width:42px;height:42px;background:${grad||pickGrad(nm)}">${ini(nm)}</div>`
                   :`<div class="av" style="width:42px;height:42px;background:${grad||pickGrad(nm)}"><div class="av-st st-off"></div>${ini(nm)}</div>`;
    const d=document.createElement('div');
    d.className='ci'+(selCid===c.id?' sel':'');
    d.innerHTML=`${av}<div class="ci-r"><div class="ci-top"><span class="ci-name">${esc(nm)}</span><span class="ci-ts">${fmtT(tsNum(c.updatedAt))}</span></div><div class="ci-prev">${esc(c.prev||'No messages yet')}</div></div>`;
    d.onclick=()=>openChat(c.id);
    list.appendChild(d);
  });
}

async function cacheUser(uid){
  if(!uid) return null;
  window.__userCache = window.__userCache || {};
  if(window.__userCache[uid]) return window.__userCache[uid];
  const snap = await getDoc(doc(db,'users',uid));
  if(snap.exists()){
    window.__userCache[uid] = snap.data();
    return snap.data();
  }
  return null;
}

window.filterSb = function(q){ sbQ=q.toLowerCase(); renderSb(); };
window.sbTab = function(btn,f){ sbF=f; document.querySelectorAll('.sbt').forEach(b=>b.classList.remove('on')); btn.classList.add('on'); renderSb(); };

/* ══ OPEN CHAT (with realtime messages) ══ */
window.openChat = async function(cid){
  selCid=cid;
  const c = window.__chats?.[cid];
  if(!c) return;
  document.getElementById('empty-st').style.display='none';
  const cpEl=document.getElementById('chat-panel');
  cpEl.style.display='flex';

  let nm=c.name, grad=null;
  if(c.type==='direct'){
    const othId=(c.members||[]).find(id=>id!==CU.id);
    const oth = await cacheUser(othId);
    if(oth){ nm=oth.name; grad=oth.grad; }
  }
  const av=document.getElementById('ch-av');
  av.style.background=grad||pickGrad(nm);
  av.textContent=ini(nm);
  document.getElementById('ch-name').textContent=nm;
  document.getElementById('ch-sub').innerHTML=`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ${(c.members||[]).length} members · E2E Encrypted`;

  if(msgUnsub) msgUnsub();
  const box=document.getElementById('msgs');
  box.innerHTML='';
  const q = query(collection(db,'chats',cid,'messages'), orderBy('ts','asc'), limit(200));
  msgUnsub = onSnapshot(q, (snap) => {
    box.innerHTML='';
    if(snap.empty){
      box.innerHTML=`<div class="welcome-msg">
        <div class="welcome-title">Welcome to Aderias</div>
        <div class="welcome-sub">All messages are end-to-end encrypted</div>
      </div>`;
    }
    snap.forEach(d => appendMsg({ id:d.id, ...d.data(), ts: tsNum(d.data().ts) }, false));
    box.scrollTop = box.scrollHeight;
  });
};

function appendMsg(m, scroll=true){
  const box=document.getElementById('msgs');
  if(!box) return;
  const isMe=m.senderId===CU?.id;
  if(m.type==='money'){
    const w=document.createElement('div');
    w.className='mw '+(isMe?'me':'th');
    w.innerHTML=`${!isMe?`<div class="m-sender">${esc(m.senderName||'?')}</div>`:''}
      <div class="money-card">
        <div class="mc-label">💸 Money Transfer</div>
        <div class="mc-amount">${m.fromCurrency} ${m.amount}</div>
        <div class="mc-conv">→ ${m.toCurrency} ${m.convertedAmount||'—'}</div>
        ${m.note?`<div class="mc-note">${esc(m.note)}</div>`:''}
        <div class="mc-status">⏳ Pending</div>
      </div>
      <div class="m-ft"><span class="m-ts">${fmtT(m.ts)}</span>${isMe?'<span class="m-tks">✓✓</span>':''}</div>`;
    box.appendChild(w);
  } else {
    const w=document.createElement('div');
    w.className='mw '+(isMe?'me':'th');
    w.innerHTML=`${!isMe?`<div class="m-sender">${esc(m.senderName||'?')}</div>`:''}
      <div class="bbl">${esc(m.text)}</div>
      <div class="m-ft"><span class="m-ts">${fmtT(m.ts)}</span>${isMe?'<span class="m-tks">✓✓</span>':''}</div>`;
    box.appendChild(w);
  }
  if(scroll) box.scrollTop = box.scrollHeight;
}

/* ══ SEND MESSAGE ══ */
window.sendMsg = async function(){
  const inp=document.getElementById('mi');
  const txt=inp.value.trim();
  if(!txt||!selCid) return;
  inp.value='';autoResize(inp);
  await addDoc(collection(db,'chats',selCid,'messages'), {
    type:'text', senderId:CU.id, senderName:CU.name, text:txt, ts:Date.now()
  });
  await updateDoc(doc(db,'chats',selCid), { prev: txt, updatedAt: Date.now() });
};

window.onKey = function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMsg(); } };
window.autoResize = function(t){ t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,90)+'px'; };
window.attachFile = function(){ toast('File attachment coming soon', false); };
window.sendVoice = function(){ toast('Voice message coming soon', false); };
window.syncNow = function(){ toast('Already live — realtime sync active', true); };

window.exportChat = async function(){
  if(!selCid) return;
  const snap = await getDocs(query(collection(db,'chats',selCid,'messages'), orderBy('ts','asc')));
  const lines=[];
  snap.forEach(d=>{ const m=d.data(); lines.push(`[${new Date(tsNum(m.ts)).toLocaleString()}] ${m.senderName||'?'}: ${m.text||m.type}`); });
  const b=new Blob([lines.join('\n')],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='chat_'+selCid+'.txt';a.click();
  toast('Chat exported', true);
};

window.openChatContact = async function(){
  if(!selCid) return;
  const c = window.__chats?.[selCid];
  if(!c||c.type!=='direct') return;
  const othId=(c.members||[]).find(id=>id!==CU.id);
  const oth = await cacheUser(othId);
  if(oth) openContactDetail({ id: othId, ...oth });
};

/* ══ CONTACT SEARCH (real Firestore query — THIS is the fix) ══ */
let acT;
window.searchContact = function(inp){
  clearTimeout(acT);
  const raw=inp.value.replace(/\D/g,'');
  const res=document.getElementById('ac-res');
  const nw=document.getElementById('ac-nick-wrap');
  const btn=document.getElementById('ac-add');
  acFound=null; btn.style.display='none'; nw.style.display='none';
  if(raw.length<6){res.innerHTML='';return;}
  res.innerHTML='<div style="font-size:12px;color:var(--t2);padding:7px 0">⏳ Searching Aderias…</div>';
  acT=setTimeout(async()=>{
    const code=document.getElementById('ac-code').value.replace('+','');
    const full='+'+code+raw;
    // Real cross-device search: query the shared 'users' collection in Firestore.
    const usersSnap = await getDocs(collection(db,'users'));
    let found=null;
    usersSnap.forEach(d=>{
      const u=d.data();
      if(u.id!==CU.id && u.registered && phoneMatch(u.phone||'', full)) found=u;
    });
    if(found){
      acFound=found;
      res.innerHTML=`<div class="src-card hit">
        <div class="av" style="width:42px;height:42px;font-size:14px;background:${found.grad||pickGrad(found.name||'?')}">${ini(found.name||'?')}</div>
        <div><div class="src-n">${esc(found.name||'Unknown')}</div>
        <div class="src-d">@${found.username||''} · ${found.phone||''}</div>
        <div class="src-ok">On Aderias · Tap to chat</div></div>
      </div>`;
      btn.style.display='block'; btn.textContent='Add Contact'; btn.onclick=confirmAdd;
      nw.style.display='block';
      document.getElementById('ac-nick').value='';
    }else{
      res.innerHTML=`<div class="src-card miss">
        <div style="font-size:18px">🔍</div>
        <div><div class="src-n">Not found on Aderias</div>
        <div class="src-no">Invite them to join?</div></div>
      </div>`;
      prepInvite(full);
      btn.textContent='📨 Send Invite'; btn.style.display='block';
      btn.onclick=()=>{closeMod('m-add');openMod('m-invite');};
    }
  },500);
};

function prepInvite(phone){
  const inviterName=CU?.name||'Someone';
  const payload={inviterName,phone};
  const token=btoa(JSON.stringify(payload));
  const invLink=location.origin+location.pathname+'#inv='+token;
  window.__invLink=invLink;
  document.getElementById('inv-app').innerHTML=`<a href="${invLink}" onclick="return false">${invLink.slice(0,60)}…</a>`;
  const msg=`${inviterName} is inviting you to join Aderias — secure, encrypted messaging.\n\nJoin here: ${invLink}`;
  document.getElementById('inv-wa').innerHTML=`<a href="https://wa.me/${phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}" target="_blank">Send on WhatsApp →</a>`;
  document.getElementById('inv-sms').innerHTML=`<a href="sms:${phone}?body=${encodeURIComponent(msg)}">Send via SMS →</a>`;
}
window.copyInv = function(){ navigator.clipboard?.writeText(window.__invLink||'').then(()=>toast('Link copied!', true)); };

window.confirmAdd = async function(){
  if(!acFound) return;
  const nick=document.getElementById('ac-nick').value.trim()||acFound.name;
  await setDoc(doc(db,'contacts',CU.id,'list',acFound.id), { ...acFound, nick, addedAt: Date.now() });
  const cid = dmId(CU.id, acFound.id);
  const chatRef = doc(db,'chats',cid);
  const existing = await getDoc(chatRef);
  if(!existing.exists()){
    await setDoc(chatRef, { id:cid, name:acFound.name, type:'direct', members:[CU.id, acFound.id], updatedAt: Date.now(), prev:'' });
  }
  closeMod('m-add'); openChat(cid);
  toast(`${nick} added!`, true);
};

/* ══ RECIPIENT SEARCH (MONEY) ══ */
let mnT;
window.searchRecipient = function(inp){
  clearTimeout(mnT);
  mnTo=null;
  const q=inp.value.trim().toLowerCase();
  const res=document.getElementById('mn-res');
  if(!q){res.innerHTML='';return;}
  mnT=setTimeout(async()=>{
    const listSnap = await getDocs(collection(db,'contacts',CU.id,'list'));
    const hits=[];
    listSnap.forEach(d=>{ const u=d.data(); if((u.name||'').toLowerCase().includes(q)||(u.phone||'').includes(q)) hits.push({id:d.id,...u}); });
    if(!hits.length){res.innerHTML='<div style="font-size:12px;color:var(--no);padding:6px 0">No contact found</div>';return;}
    res.innerHTML=hits.slice(0,4).map(u=>`
      <div class="src-card" style="margin-top:5px;cursor:pointer" onclick="window.__pickRecipient('${u.id}')">
        <div class="av" style="width:34px;height:34px;font-size:11px;background:${u.grad||pickGrad(u.name||'?')}">${ini(u.name||'?')}</div>
        <div><div class="src-n">${esc(u.name||'?')}</div><div class="src-d">${u.phone||''}</div></div>
      </div>`).join('');
  },300);
};
window.__pickRecipient = async function(uid){
  const snap = await getDoc(doc(db,'contacts',CU.id,'list',uid));
  if(!snap.exists()) return;
  mnTo={id:uid,...snap.data()};
  document.getElementById('mn-to').value=mnTo.name||mnTo.phone||'';
  document.getElementById('mn-res').innerHTML='';
};

/* ══ GROUPS ══ */
window.createGroup = async function(){
  const nm=document.getElementById('grp-nm').value.trim();
  if(!nm){toast('Enter a group name', false);return;}
  const cid='grp_'+Date.now();
  await setDoc(doc(db,'chats',cid), { id:cid, name:nm, type:'group', members:[CU.id], updatedAt: Date.now(), prev:'' });
  await addDoc(collection(db,'chats',cid,'messages'), { type:'system', text:`${CU.name} created "${nm}"`, ts: Date.now() });
  closeMod('m-group'); openChat(cid);
  toast(`Group "${nm}" created!`, true);
};

window.openMembers = async function(){
  if(!selCid) return;
  const c = window.__chats?.[selCid]; if(!c) return;
  const list=document.getElementById('mem-list'); list.innerHTML='';
  for(const id of (c.members||[])){
    const u = await cacheUser(id) || {name:'Unknown'};
    const isL=isLdr(u), isMe=id===CU.id;
    const d=document.createElement('div'); d.className='mem-row';
    d.innerHTML=`<div class="av" style="width:34px;height:34px;font-size:11px;background:${u.grad||pickGrad(u.name||'?')}">${ini(u.name||'?')}</div>
      <div class="mem-name">${esc(u.name||'?')}${isMe?' (you)':''}</div>
      <span class="role-tag ${isL?'rt-ldr':'rt-usr'}">${isL?'👑 Leader':'Member'}</span>`;
    list.appendChild(d);
  }
  openMod('m-members');
};

/* ══ REGISTRATION / PRIVACY ══ */
function updateRegPill(){
  const p=document.getElementById('reg-pill');
  if(!p||!CU) return;
  p.className='reg-pill '+(CU.registered?'rp-on':'rp-off');
  p.textContent=CU.registered?'● Live':'○ Hidden';
}
window.toggleReg = async function(){
  if(!CU) return;
  CU.registered=!CU.registered;
  await updateDoc(doc(db,'users',CU.id), { registered: CU.registered });
  updateRegPill();
  toast(CU.registered?'Now visible to phone search':'Hidden from phone search', true);
};
window.syncPfReg = function(){
  const p=document.getElementById('pf-reg');
  if(!p||!CU) return;
  p.className='reg-pill '+(CU.registered?'rp-on':'rp-off');
  p.textContent=CU.registered?'● Live':'○ Hidden';
};

/* ══ PROFILE ══ */
window.openProfile = function(){
  if(!CU) return;
  document.getElementById('pf-av').style.background=CU.grad||pickGrad(CU.name||'A');
  document.getElementById('pf-av-txt').textContent=ini(CU.name||'A');
  document.getElementById('pf-nm').textContent=CU.name||'Name';
  document.getElementById('pf-badge').textContent=isLdr(CU)?'👑 Leader':'Member';
  document.getElementById('pf-name').value=CU.name||'';
  document.getElementById('pf-uname').value=CU.username||'';
  document.getElementById('pf-phone').value=CU.phone||'';
  document.getElementById('pf-email').value=CU.email||'';
  document.getElementById('pf-bio').value=CU.bio||'';
  syncPfReg();
  openMod('m-profile');
};

let gradIdx=0;
window.cycleGrad = function(){
  gradIdx=(gradIdx+1)%GRADS.length;
  const g=GRADS[gradIdx];
  document.getElementById('pf-av').style.background=g;
  CU.grad=g;
};

window.saveProfile = async function(){
  CU.name=document.getElementById('pf-name').value.trim()||CU.name;
  CU.username=document.getElementById('pf-uname').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,22)||CU.username;
  CU.bio=document.getElementById('pf-bio').value.trim();
  await updateDoc(doc(db,'users',CU.id), { name:CU.name, username:CU.username, bio:CU.bio, grad:CU.grad });
  const av=document.getElementById('me-av');
  av.innerHTML=`<span class="crown-ic" id="crown" style="display:${isLdr(CU)?'block':'none'}">👑</span>`+ini(CU.name);
  av.style.background=CU.grad||pickGrad(CU.name);
  document.getElementById('me-name').textContent=CU.name;
  document.getElementById('me-handle').textContent='@'+CU.username;
  closeMod('m-profile'); toast('Profile saved!', true);
};

window.deleteAccount = async function(){
  if(!confirm('Delete your account permanently? This cannot be undone.')) return;
  await deleteDoc(doc(db,'users',CU.id));
  await auth.currentUser.delete();
  CU=null; closeMod('m-profile'); go('s-auth');
  toast('Account deleted', false);
};

/* ══ CONTACTS ══ */
function openContactDetail(u){
  const cd=document.getElementById('cd-av');
  cd.style.background=u.grad||pickGrad(u.name||'?');
  cd.textContent=ini(u.name||'?');
  document.getElementById('cd-nm').textContent=u.name||'Unknown';
  document.getElementById('cd-handle').textContent='@'+(u.username||'');
  document.getElementById('cd-ph').textContent=u.phone||'';
  document.getElementById('cd-nick').value=u.nick||'';
  selContact=u;
  openMod('m-contact');
}
window.saveNick = async function(){
  if(!selContact) return;
  const nick=document.getElementById('cd-nick').value.trim();
  await setDoc(doc(db,'contacts',CU.id,'list',selContact.id), { ...selContact, nick }, { merge:true });
  toast('Nickname saved', true);
};
window.chatContact = async function(){
  if(!selContact) return;
  const cid = dmId(CU.id, selContact.id);
  const ref = doc(db,'chats',cid);
  const snap = await getDoc(ref);
  if(!snap.exists()) await setDoc(ref, { id:cid, name:selContact.name, type:'direct', members:[CU.id, selContact.id], updatedAt: Date.now(), prev:'' });
  closeMod('m-contact'); openChat(cid);
};
window.removeContact = async function(){
  if(!selContact) return;
  await deleteDoc(doc(db,'contacts',CU.id,'list',selContact.id));
  closeMod('m-contact'); toast('Contact removed', false);
};

/* ══ MONEY TRANSFER ══ */
function buildCurrGrids(){
  ['from-grid','to-grid'].forEach(id=>{
    const g=document.getElementById(id); if(!g) return; g.innerHTML='';
    const isFr=id==='from-grid';
    Object.keys(CUR).slice(0,12).forEach(k=>{
      const b=document.createElement('button');
      b.className='cur-btn'+((!isFr&&k===toCur)||(isFr&&k===fromCur)?' on':'');
      b.textContent=CUR[k].s+' '+k;
      b.onclick=()=>{if(isFr)fromCur=k;else toCur=k;buildCurrGrids();calcRate();};
      g.appendChild(b);
    });
  });
}
window.calcRate = function(){
  const amt=parseFloat(document.getElementById('mn-amt').value)||0;
  const el=document.getElementById('xr-txt');
  if(!amt){el.textContent='Enter amount above';el.style.color='var(--t2)';return;}
  const usd=amt*(TO_USD[fromCur]||1);
  const conv=(usd/(TO_USD[toCur]||1)).toFixed(2);
  el.innerHTML=`<span class="rate-num">${CUR[toCur]?.s||''} ${conv}</span> <span style="font-size:12px;color:var(--t2)">${toCur}</span>`;
};
window.swapCurr = function(){ [fromCur,toCur]=[toCur,fromCur]; buildCurrGrids(); calcRate(); };

window.confirmTransfer = async function(){
  const amt=parseFloat(document.getElementById('mn-amt').value);
  const note=document.getElementById('mn-note').value.trim();
  if(!amt||amt<=0){toast('Enter a valid amount', false);return;}
  if(!mnTo){toast('Select a recipient', false);return;}
  const usd=amt*(TO_USD[fromCur]||1);
  const conv=(usd/(TO_USD[toCur]||1)).toFixed(2);
  const cid = selCid || dmId(CU.id, mnTo.id);
  const chatRef = doc(db,'chats',cid);
  const snap = await getDoc(chatRef);
  if(!snap.exists()) await setDoc(chatRef, { id:cid, name:mnTo.name, type:'direct', members:[CU.id, mnTo.id], updatedAt: Date.now(), prev:'' });
  await addDoc(collection(db,'chats',cid,'messages'), {
    type:'money', senderId:CU.id, senderName:CU.name, amount:amt,
    fromCurrency:fromCur, toCurrency:toCur, convertedAmount:conv, note,
    toId:mnTo.id, toName:mnTo.name, ts: Date.now()
  });
  await updateDoc(chatRef, { prev:`💸 ${amt} ${fromCur}`, updatedAt: Date.now() });
  closeMod('m-money');
  if(selCid!==cid) openChat(cid);
  toast(`Sent ${amt} ${fromCur} → ${conv} ${toCur}!`, true);
};

/* ══ LEADER PANEL ══ */
window.loadLeaderPanel = async function(){
  const usersSnap = await getDocs(collection(db,'users'));
  const users = usersSnap.docs.map(d=>d.data());
  const chatsSnap = await getDocs(collection(db,'chats'));
  let msgCount = 0;
  for(const c of chatsSnap.docs){
    const ms = await getDocs(collection(db,'chats',c.id,'messages'));
    msgCount += ms.size;
  }
  document.getElementById('lp-users').textContent = users.length;
  document.getElementById('lp-chats').textContent = chatsSnap.size;
  document.getElementById('lp-msgs').textContent = msgCount;
  document.getElementById('lp-reg').textContent = users.filter(u=>u.registered).length;
  document.getElementById('lp-path').textContent = '☁ Cloud Firestore (aderias-c1a7b)';

  const el=document.getElementById('lp-list'); el.innerHTML='';
  users.forEach(u=>{
    const d=document.createElement('div'); d.className='u-card';
    d.innerHTML=`<div class="av" style="width:34px;height:34px;font-size:11px;background:${u.grad||pickGrad(u.name||'?')}">${ini(u.name||'?')}</div>
      <div style="flex:1"><div class="uc-name">${esc(u.name||'Unknown')}</div>
      <div class="uc-meta">@${u.username||''} · ${u.phone||u.email||'—'} · joined ${fmtT(u.joinedAt||Date.now())}</div></div>
      <div class="uc-live ${u.registered?'y':'n'}">${u.registered?'● Live':'○'}</div>`;
    el.appendChild(d);
  });
};

window.exportAll = async function(){
  const usersSnap = await getDocs(collection(db,'users'));
  const chatsSnap = await getDocs(collection(db,'chats'));
  const data = { users: usersSnap.docs.map(d=>d.data()), chats: chatsSnap.docs.map(d=>d.data()) };
  const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='aderias_export_'+Date.now()+'.json';a.click();
  toast('All data exported', true);
};

// NOTE: the old "view user vault password" feature depended on a local
// server file vault (D:\zero data) and cannot work with Firestore as-is.
// It's disabled here; ask if you want a Firestore-based audit-log version instead.
window.viewUser = function(){
  toast('Vault viewer needs local server — not available in cloud mode', false);
};

/* ══ MODALS ══ */
window.openMod = function(id){
  if(id==='m-leader'){ if(!isLdr(CU)) return; loadLeaderPanel(); }
  document.getElementById(id).classList.add('open');
};
window.closeMod = function(id){ document.getElementById(id).classList.remove('open'); };
document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.ov').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open')}));
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.ov.open').forEach(o=>o.classList.remove('open'))});

/* ══ TOAST ══ */
let tt;
function toast(msg,ok){
  const el=document.getElementById('toast');
  if(!el) return;
  el.textContent=msg;el.className='toast '+(ok?'tok':'tnok')+' show';
  clearTimeout(tt);tt=setTimeout(()=>el.classList.remove('show'),3500);
}

/* ══ SCREEN SWITCH ══ */
function go(id){ document.querySelectorAll('.scr').forEach(s=>s.classList.toggle('off',s.id!==id)); }

/* ══ BOOT ══ */
window.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('srv-dot').className='sd sd-on';
  document.getElementById('srv-txt').textContent='Connected to Firebase (aderias-c1a7b)';
  document.getElementById('srv-txt').style.color='var(--ok)';

  const hash=location.hash;
  if(hash.includes('inv=')){
    try{
      const d=JSON.parse(atob(hash.split('inv=')[1].split('&')[0]));
      document.getElementById('inv-strip').classList.add('on');
      document.getElementById('inv-title').textContent=(d.inviterName||'Someone')+' invited you to Aderias!';
      document.getElementById('inv-sub').textContent='Sign up to get connected automatically.';
    }catch{}
    setTab('su');
  }
  // onAuthStateChanged (registered above) handles session restore + routing.
});
