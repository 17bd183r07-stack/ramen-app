import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, addDoc, deleteDoc, updateDoc, collection, onSnapshot, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SEARCH_CENTER } from "./config.js";

const GENRES = ["醤油","塩","味噌","豚骨","家系","二郎系","まぜそば","その他"];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){ const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
const view = html => { const v = $("#view"); v.className = "view"; v.innerHTML = html; };

if (!firebaseConfig.apiKey) {
  view(`<div class="center"><h1>設定がまだです</h1><p>config.js に Firebase の設定を貼ると使えるようになります。</p></div>`);
  throw new Error("firebaseConfig is empty");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

/* ---------- 状態 ---------- */
const S = {
  user: null, isOwner: false,
  members: new Map(),   // uid -> {name}
  shops: new Map(),     // id -> shop
  ranks: new Map(),     // uid -> {genre: [shopId]}
  posts: [],            // 新しい順
  invites: [],          // 管理者のみ
};
const photoCache = new Map();
let unsubs = [];
let tab = "shops", sub = null, rankGenre = "醤油", shopQuery = "", draft = null;

const memberName = uid => S.members.get(uid)?.name ?? "（退出したメンバー）";
const myLists = () => S.ranks.get(S.user.uid) ?? {};
const shopName = id => S.shops.get(id)?.name ?? "（削除された店）";
function eaters(shopId){ return [...S.ranks.entries()].filter(([uid, r]) => S.members.has(uid) && Object.values(r).some(l => l.includes(shopId))).map(([uid]) => uid); }
function genresOf(shopId){ const g = new Set(); S.ranks.forEach(r => Object.entries(r).forEach(([k, l]) => l.includes(shopId) && g.add(k))); return GENRES.filter(x => g.has(x)); }
const latestPost = (uid, shopId, genre) => S.posts.find(p => p.uid === uid && p.shopId === shopId && p.genre === genre && p.text);
const photoPosts = f => S.posts.filter(p => p.thumb && f(p));
const fmtDate = p => { const d = p.createdAt?.toDate?.() ?? new Date(); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`; };

/* ---------- ログイン ---------- */
onAuthStateChanged(auth, async user => {
  unsubs.forEach(u => u()); unsubs = [];
  S.user = user;
  $("#tabs").hidden = true;
  $("#whoami").textContent = "";
  if (!user) return loginView();
  view(`<p class="loading">読み込み中…</p>`);
  try {
    // まだメンバーでない人は自分のメンバー情報も読めない（守りの仕様）ので、その場合は「未参加」として扱う
    const isJoined = await getDoc(doc(db, "members", user.uid)).then(d => d.exists(), e => { if (e.code === "permission-denied") return false; throw e; });
    if (isJoined) return start();
    const owner = await getDoc(doc(db, "meta", "owner"));
    joinView(!owner.exists());
  } catch (e) {
    console.error(e);
    view(`<div class="center"><h1>読み込めませんでした</h1><p>通信状態を確認して、ページを開き直してください。</p><button class="ghost" id="out">ログアウト</button></div>`);
    $("#out").onclick = () => signOut(auth);
  }
});

function loginView(){
  view(`<div class="center"><h1>部内ラーメン帖</h1><p>部内メンバー専用です。招待されたGoogleアカウントでログインしてください。</p>
  <button class="google-btn" id="login"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Googleでログイン</button></div>`);
  $("#login").onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") toast("ログインできませんでした。もう一度お試しください"); console.error(e); }
  };
}

function joinView(firstOwner){
  const email = auth.currentUser.email;
  view(`<div class="center"><h1>${firstOwner ? "管理者として始める" : "ようこそ"}</h1>
    <p>${firstOwner ? "最初にログインした人が管理者になり、メンバーを招待できます。" : "アプリの中で表示する名前を決めてください。"}</p>
    <input class="field" id="nm" maxlength="20" placeholder="表示名（例：田中）" value="${esc(auth.currentUser.displayName?.split(" ")[0] ?? "")}">
    <button class="primary" id="join">はじめる</button>
    <p class="note">ログイン中：${esc(email)}　<button class="link" id="out">別のアカウントにする</button></p></div>`);
  $("#out").onclick = () => signOut(auth);
  $("#join").onclick = async () => {
    const name = $("#nm").value.trim();
    if (!name) { toast("表示名を入れてください"); return; }
    try {
      if (firstOwner) await setDoc(doc(db, "meta", "owner"), { uid: auth.currentUser.uid, createdAt: serverTimestamp() });
      await setDoc(doc(db, "members", auth.currentUser.uid), { name, joinedAt: serverTimestamp() });
      start();
    } catch (e) {
      console.error(e);
      view(`<div class="center"><h1>招待されていません</h1><p>${esc(email)} はまだ招待リストにありません。管理者にこのメールアドレスを伝えて、招待してもらってください。</p><button class="ghost" id="out">ログアウト</button></div>`);
      $("#out").onclick = () => signOut(auth);
    }
  };
}

/* ---------- データの購読 ---------- */
async function start(){
  const owner = await getDoc(doc(db, "meta", "owner"));
  S.isOwner = owner.exists() && owner.data().uid === S.user.uid;
  $("#tabs").hidden = false;
  let ready = 0; const need = 4 + (S.isOwner ? 1 : 0);
  const done = () => { if (++ready >= need) render(); else if (ready > need) render(); };
  const once = fn => { let first = true; return snap => { fn(snap); if (first) { first = false; done(); } else render(); }; };
  unsubs.push(onSnapshot(collection(db, "members"), once(s => { S.members = new Map(s.docs.map(d => [d.id, d.data()])); $("#whoami").textContent = memberName(S.user.uid) + "さん"; })));
  unsubs.push(onSnapshot(collection(db, "shops"), once(s => { S.shops = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])); })));
  unsubs.push(onSnapshot(collection(db, "ranks"), once(s => { S.ranks = new Map(s.docs.map(d => [d.id, d.data().lists ?? {}])); })));
  unsubs.push(onSnapshot(collection(db, "posts"), once(s => {
    S.posts = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() ?? Date.now()) - (a.createdAt?.toMillis?.() ?? Date.now()));
  })));
  if (S.isOwner) unsubs.push(onSnapshot(collection(db, "invites"), once(s => { S.invites = s.docs.map(d => d.id).sort(); })));
}

/* ---------- 画面 ---------- */
function go(t, s = null){ tab = t; sub = s; render(); window.scrollTo(0, 0); }
document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => { if (b.dataset.tab === "post" && tab !== "post") draft = null; go(b.dataset.tab); });

function render(){
  if (!S.user) return;
  // 入力中の欄があれば、カーソル位置を保ったまま描き直す
  const active = document.activeElement; const aid = active?.id; const pos = active?.selectionStart;
  document.querySelectorAll("nav.tabs button").forEach(b => b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  if (tab === "shops") view(sub ? shopDetail(sub) : shopsView());
  if (tab === "post") view(postView());
  if (tab === "rank") view(sub ? memberDetail(sub) : rankView());
  if (tab === "mine") view(mineView());
  bind();
  if (aid && $("#" + aid)) { const el = $("#" + aid); el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch {} }
  loadPhotos();
}

const thumbImg = (p, cls = "thumb") => `<img class="${cls}" src="${p.thumb}" alt="">`;
const zoomBtn = p => `<button class="zoom" data-zoom="${p.id}">${thumbImg(p, "thumb sm")}</button>`;

/* お店 */
function shopsView(){
  const q = shopQuery.trim();
  const list = [...S.shops.values()].filter(s => !q || s.name.includes(q) || (s.area ?? "").includes(q))
    .sort((a, b) => eaters(b.id).length - eaters(a.id).length || a.name.localeCompare(b.name, "ja"));
  return `<h2>お店</h2>
  <input class="field" id="shopq" type="search" placeholder="店名や地名で探す" value="${esc(shopQuery)}" autocomplete="off">
  <div class="stack" style="margin-top:12px">
  ${list.map(s => { const ph = photoPosts(p => p.shopId === s.id)[0]; return `<button class="shop" data-open="${s.id}">
      ${ph ? thumbImg(ph) : `<span class="ph-none">写真なし</span>`}
      <div class="body"><div class="name">${esc(s.name)}</div>
      <div class="meta">${esc(s.area)}　${genresOf(s.id).map(g => `<span class="tag">${g}</span>`).join("")}</div></div>
      <div class="count"><b>${eaters(s.id).length}</b>人が<br>食べた</div></button>`; }).join("") ||
    `<p class="empty">${S.shops.size ? "見つかりません。" : "まだお店がありません。"}下の「評価する」から登録できます。</p>`}
  </div>`;
}
function shopDetail(id){
  const s = S.shops.get(id);
  if (!s) return `<button class="link" data-back>‹ お店一覧</button><p class="empty">このお店は削除されました。</p>`;
  const rows = [];
  S.ranks.forEach((r, uid) => Object.entries(r).forEach(([g, l]) => { const i = l.indexOf(id); if (i >= 0 && S.members.has(uid)) rows.push({ uid, g, n: i + 1, of: l.length }); }));
  const maps = s.lat ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + " " + (s.address ?? ""))}`;
  const ps = photoPosts(p => p.shopId === id);
  return `<button class="link" data-back>‹ お店一覧</button>
  <div class="detail-head" style="margin-top:10px">
    <div class="name">${esc(s.name)}</div>
    <div class="note">${esc(s.address || "住所未登録")}</div>
    <div class="row" style="margin-top:10px"><span>${genresOf(id).map(g => `<span class="tag">${g}</span>`).join("")}</span>
    <a class="link" href="${maps}" target="_blank" rel="noopener">Googleマップで開く ›</a></div>
  </div>
  <h3>写真</h3>
  ${ps.length ? `<div class="gallery">${ps.map(p => `<button data-zoom="${p.id}"><img src="${p.thumb}" data-full="${p.id}" alt="${esc(memberName(p.uid))}さんの写真"><div class="cap">${esc(memberName(p.uid))}・${p.genre}・${fmtDate(p)}</div></button>`).join("")}</div>` : `<p class="empty">まだ写真がありません。</p>`}
  <h3>みんなの順位（${eaters(id).length}人が食べた）</h3>
  <div class="who-ranked">${rows.map(r => { const c = latestPost(r.uid, id, r.g); const p = photoPosts(x => x.uid === r.uid && x.shopId === id && x.genre === r.g)[0];
    return `<div class="r"><b>${esc(memberName(r.uid))}</b><div style="flex:1;min-width:0"><div>${r.g} ${r.n}位 <span class="note">（${r.of}店中）</span></div>${c ? `<div class="c">${esc(c.text)}</div>` : ""}</div>${p ? zoomBtn(p) : ""}</div>`; }).join("") || `<p class="empty">まだ誰も順位を付けていません。</p>`}</div>
  <button class="primary" style="margin-top:16px" data-rate="${id}">この店を評価する</button>
  ${S.isOwner ? `<button class="link danger" style="margin-top:16px" data-delshop="${id}">このお店を削除する（管理者）</button>` : ""}
  <p class="src" style="margin-top:12px">${s.osm ? "店舗データ © OpenStreetMap contributors" : "メンバーが手入力で登録"}</p>`;
}

/* 評価する */
const emptyDraft = () => ({ q: "", shopId: null, newShop: null, genre: null, pos: null, comment: "", photo: null, thumb: null, results: [], searching: false });
function postView(){
  if (!draft) draft = emptyDraft();
  const d = draft;
  const shop = d.shopId ? S.shops.get(d.shopId) : d.newShop;
  let h = `<h2>評価する</h2><div class="step">1　お店を選ぶ</div>`;
  if (!shop) {
    h += `<input class="field" id="postq" type="search" placeholder="店名を入れる（例：一蘭 新宿）" value="${esc(d.q)}" autocomplete="off" style="margin-top:6px"><div id="cands" class="stack" style="margin-top:10px">${candidates()}</div>`;
    return h;
  }
  h += `<div class="picked" style="margin-top:6px"><div><div class="name">${esc(shop.name)}</div><div class="note">${esc(shop.address || "住所未登録")}${d.newShop ? "　・新しく登録されます" : ""}</div></div><button class="link" data-reshop>変更</button></div>`;
  if (d.newShop?.manual) h += `<input class="field" id="addr" placeholder="住所や最寄り駅（わかれば）" value="${esc(d.newShop.address)}" style="margin-top:8px">`;
  h += `<div class="step">2　味の種類</div><div class="chips" style="margin-top:6px">${GENRES.map(g => `<button class="chip" data-genre="${g}" aria-pressed="${d.genre === g}">${g}</button>`).join("")}</div>`;
  if (!d.genre) return h;
  const all = myLists()[d.genre] ?? [];
  const mine = all.filter(x => x !== d.shopId);
  const prev = d.shopId ? all.indexOf(d.shopId) : -1;
  h += `<div class="step">3　あなたの${d.genre}ランキングのどこに入る？</div>`;
  if (prev >= 0) h += `<p class="note">前回は${prev + 1}位でした。入れ直すと順位が変わります。</p>`;
  if (!mine.length) { d.pos = 0; h += `<p class="note">${d.genre}はこれが1店目なので、1位として登録されます。</p>`; }
  else {
    h += `<ol class="rank-list" style="margin-top:6px">`;
    for (let i = 0; i <= mine.length; i++) {
      if (d.pos === i) h += `<li class="rank-row new"><span class="n">${i + 1}位</span><span class="nm"><b>${esc(shop.name)}</b><span class="cm">ここに入ります</span></span></li>`;
      else h += `<li><button class="slot" data-pos="${i}">${i === 0 ? "1位にする" : "ここに入れる"}</button></li>`;
      if (i < mine.length) { const n = i + 1 + (d.pos !== null && d.pos <= i ? 1 : 0); h += `<li class="rank-row"><span class="n">${n}位</span><span class="nm">${esc(shopName(mine[i]))}</span></li>`; }
    }
    h += `</ol>`;
  }
  if (d.pos === null) return h;
  h += `<div class="step">4　写真とひとこと（どちらもなくても可）</div>
  <div class="photo-pick">${d.photo ? `<div class="photo-prev"><img src="${d.photo}" alt="選んだ写真"><button data-unphoto aria-label="写真を外す">×</button></div><span class="note">この写真を付けます</span>` : `<label for="ph"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8.5 6l1.5-2h4l1.5 2"/></svg>写真を追加<input id="ph" type="file" accept="image/*"></label><span class="note">撮影またはアルバムから</span>`}</div>
  <textarea class="field" id="cm" maxlength="1000" placeholder="例：スープが濃厚。麺は硬めがおすすめ。" style="margin-top:10px">${esc(d.comment)}</textarea>
  <button class="primary" style="margin-top:14px" data-submit ${d.sending ? "disabled" : ""}>${d.sending ? "投稿中…" : "投稿する"}</button>`;
  return h;
}
function candidates(){
  const d = draft, q = d.q.trim();
  if (q.length < 2) return `<p class="note">2文字以上入れると、登録済みのお店と地図データの候補が出ます。</p>`;
  const reg = [...S.shops.values()].filter(s => s.name.includes(q) || (s.area ?? "").includes(q)).slice(0, 8);
  const osm = d.results.filter(r => !S.shops.has(r.id));
  let h = reg.map(s => `<button class="shop" data-pick="${s.id}"><div class="body"><div class="name">${esc(s.name)}</div><div class="meta">${esc(s.address)}</div></div><span class="tag" style="background:var(--accent-soft);color:var(--accent)">登録済み</span></button>`).join("");
  h += osm.map((s, i) => `<button class="shop" data-osm="${d.results.indexOf(s)}"><div class="body"><div class="name">${esc(s.name)}</div><div class="meta">${esc(s.address)}</div></div><span class="note">新規</span></button>`).join("");
  if (d.searching) h += `<p class="note">地図データを検索中…</p>`;
  else if (!reg.length && !osm.length) h += `<p class="empty">候補が見つかりません。店名を短くするか、地名を足してみてください。</p>`;
  h += `<button class="ghost" data-manual>候補にない店を「${esc(q)}」で登録</button><p class="src">店舗データ © OpenStreetMap contributors</p>`;
  return h;
}

/* OpenStreetMap（Photon）で店を探す。入力が止まってから1回だけ問い合わせる */
let searchTimer = null, searchSeq = 0;
function searchOsm(){
  clearTimeout(searchTimer);
  const q = draft.q.trim();
  if (q.length < 2) { draft.results = []; draft.searching = false; return; }
  draft.searching = true;
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lat=${SEARCH_CENTER.lat}&lon=${SEARCH_CENTER.lon}`
      + "&osm_tag=amenity:restaurant&osm_tag=amenity:fast_food&osm_tag=amenity:food_court&osm_tag=amenity:cafe";
    try {
      const res = await fetch(url); const js = await res.json();
      if (seq !== searchSeq || !draft) return;
      draft.results = (js.features ?? []).filter(f => f.properties?.name).map(f => {
        const p = f.properties;
        const area = p.district || p.locality || p.city || p.county || "";
        const address = [p.state, p.city, p.district || p.locality, p.street, p.housenumber].filter(Boolean).join(" ");
        return { id: `osm-${p.osm_type}${p.osm_id}`, name: p.name, address, area, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], osm: true };
      });
    } catch (e) { console.error(e); if (draft) draft.results = []; toast("地図データに接続できませんでした。手入力でも登録できます"); }
    if (draft) { draft.searching = false; refreshCands(); }
  }, 450);
}
function refreshCands(){ const c = $("#cands"); if (c) { c.innerHTML = candidates(); bindCands(); } }

/* ランキング */
function rankView(){
  const ms = [...S.members.entries()].sort(([a], [b]) => (a === S.user.uid ? -1 : b === S.user.uid ? 1 : 0));
  return `<h2>ランキング</h2>
  <div class="scroll-chips">${GENRES.map(g => `<button class="chip" data-rg="${g}" aria-pressed="${rankGenre === g}">${g}</button>`).join("")}</div>
  <p class="note" style="margin:0 0 10px">みんなの${rankGenre}ベスト3。名前を押すとその人の全順位が見られます。</p>
  <div class="stack">${ms.map(([uid, m]) => { const l = (S.ranks.get(uid) ?? {})[rankGenre] ?? [];
    return `<button class="member-card" data-member="${uid}" style="text-align:left;width:100%">
      <header><span class="mn">${esc(m.name)}${uid === S.user.uid ? "（あなた）" : ""}</span><span class="note">${l.length}店 ›</span></header>
      ${l.length ? `<ol class="top3">${l.slice(0, 3).map((id, i) => `<li><span class="n">${i + 1}位</span><span>${esc(shopName(id))}</span></li>`).join("")}</ol>` : `<p class="empty" style="margin:0">${rankGenre}はまだありません</p>`}
    </button>`; }).join("")}</div>`;
}
function memberDetail(uid){
  const r = S.ranks.get(uid) ?? {};
  const gs = GENRES.filter(g => (r[g] ?? []).length);
  return `<button class="link" data-back>‹ ランキング</button><h2 style="margin-top:8px">${esc(memberName(uid))}さんのランキング</h2>
  ${gs.map(g => `<h3>${g}</h3><ol class="rank-list">${r[g].map((id, i) => { const c = latestPost(uid, id, g); const p = photoPosts(x => x.uid === uid && x.shopId === id && x.genre === g)[0];
    return `<li class="rank-row ${i === 0 ? "gold" : ""}"><span class="n">${i + 1}位</span><span class="nm"><button class="link" style="color:inherit;font-weight:500;text-align:left" data-open-shop="${id}">${esc(shopName(id))}</button>${c ? `<span class="cm">${esc(c.text)}（${fmtDate(c)}）</span>` : ""}</span>${p ? zoomBtn(p) : ""}</li>`; }).join("")}</ol>`).join("") || `<p class="empty">まだ評価がありません。</p>`}`;
}

/* マイページ */
function mineView(){
  const r = myLists(); const gs = GENRES.filter(g => (r[g] ?? []).length);
  const myPosts = S.posts.filter(p => p.uid === S.user.uid);
  let h = `<h2>${esc(memberName(S.user.uid))}さんのページ</h2>
  <div class="row"><input class="field" id="rename" maxlength="20" value="${esc(memberName(S.user.uid))}" style="flex:1;min-width:0"><button class="ghost" data-rename>表示名を変更</button></div>
  <p class="note" style="margin-top:14px">順位の入れ替えは ▲▼ で。自分の分だけ変更できます。</p>`;
  h += gs.map(g => `<h3>${g}</h3><ol class="rank-list">${r[g].map((id, i) => `<li class="rank-row"><span class="n">${i + 1}位</span><span class="nm">${esc(shopName(id))}</span><span class="mv"><button aria-label="上げる" data-mv="${g}|${i}|-1" ${i === 0 ? "disabled" : ""}>▲</button><button aria-label="下げる" data-mv="${g}|${i}|1" ${i === r[g].length - 1 ? "disabled" : ""}>▼</button><button aria-label="外す" data-rm="${g}|${i}">×</button></span></li>`).join("")}</ol>`).join("") || `<p class="empty">まだ評価がありません。下の「評価する」から始めましょう。</p>`;
  if (myPosts.length) h += `<h3>自分のコメントと写真</h3><div class="stack">${myPosts.map(p => `<div class="rank-row">${p.thumb ? zoomBtn(p) : ""}<span class="nm">${esc(shopName(p.shopId))}・${p.genre}<span class="cm">${esc(p.text || "（写真のみ）")}（${fmtDate(p)}）</span></span><button class="link danger" data-delpost="${p.id}">削除</button></div>`).join("")}</div>`;
  if (S.isOwner) {
    h += `<h3>メンバーの招待（管理者だけに表示）</h3>
    <p class="note">招待したいメンバーのGoogleアカウントのメールアドレスを入れてください。招待後、その人がアプリのURLを開いてログインすると参加できます。</p>
    <div class="row"><input class="field" id="inv" type="email" placeholder="example@gmail.com" style="flex:1;min-width:0" autocomplete="off"><button class="ghost" data-invite>招待</button></div>
    <div class="stack" style="margin-top:10px">${S.invites.map(e => `<div class="rank-row"><span class="nm">${esc(e)}</span><button class="link danger" data-uninvite="${esc(e)}">招待を取り消す</button></div>`).join("") || `<p class="empty">まだ誰も招待していません。</p>`}</div>
    <h3>参加中のメンバー</h3><div class="stack">${[...S.members.entries()].map(([uid, m]) => `<div class="rank-row"><span class="nm">${esc(m.name)}${uid === S.user.uid ? "（管理者）" : ""}</span>${uid === S.user.uid ? "" : `<button class="link danger" data-kick="${uid}">外す</button>`}</div>`).join("")}</div>
    <p class="note">メンバーを外したあとは、そのメールアドレスの招待も取り消してください。</p>`;
  }
  h += `<button class="ghost" style="margin-top:24px;width:100%" data-logout>ログアウト</button>`;
  return h;
}

/* ---------- 操作 ---------- */
function bind(){
  const v = $("#view");
  const on = (sel, fn) => v.querySelectorAll(sel).forEach(b => b.onclick = () => fn(b));
  on("[data-open]", b => go("shops", b.dataset.open));
  on("[data-open-shop]", b => go("shops", b.dataset.openShop));
  on("[data-back]", () => go(tab));
  on("[data-rate]", b => { draft = { ...emptyDraft(), shopId: b.dataset.rate }; go("post"); });
  const sq = $("#shopq"); if (sq) sq.oninput = e => { shopQuery = e.target.value; render(); };
  const pq = $("#postq"); if (pq) pq.oninput = e => { draft.q = e.target.value; searchOsm(); refreshCands(); };
  bindCands();
  on("[data-reshop]", () => { draft = emptyDraft(); render(); });
  const ad = $("#addr"); if (ad) ad.oninput = e => draft.newShop.address = e.target.value;
  on("[data-genre]", b => { draft.genre = b.dataset.genre; draft.pos = null; render(); });
  on("[data-pos]", b => { draft.pos = +b.dataset.pos; render(); });
  const cm = $("#cm"); if (cm) cm.oninput = e => draft.comment = e.target.value;
  const ph = $("#ph"); if (ph) ph.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { draft.photo = await shrink(f, 800, 0.75); draft.thumb = await shrink(f, 160, 0.6); render(); }
    catch { toast("この写真は読み込めませんでした。別の写真を選んでください"); }
  };
  on("[data-unphoto]", () => { draft.photo = draft.thumb = null; render(); });
  on("[data-submit]", submit);
  on("[data-rg]", b => { rankGenre = b.dataset.rg; render(); });
  on("[data-member]", b => go("rank", b.dataset.member));
  on("[data-zoom]", b => zoom(b.dataset.zoom));
  on("[data-mv]", b => { const [g, i, dir] = b.dataset.mv.split("|"); const l = [...myLists()[g]]; const a = +i, z = a + +dir; [l[a], l[z]] = [l[z], l[a]]; saveList(g, l); });
  on("[data-rm]", b => { const [g, i] = b.dataset.rm.split("|"); const l = [...myLists()[g]]; l.splice(+i, 1); saveList(g, l).then(() => toast("ランキングから外しました")); });
  on("[data-rename]", async () => { const n = $("#rename").value.trim(); if (!n) return toast("表示名を入れてください");
    try { await updateDoc(doc(db, "members", S.user.uid), { name: n }); toast("表示名を変更しました"); } catch (e) { console.error(e); toast("変更できませんでした"); } });
  on("[data-delpost]", async b => { try { const id = b.dataset.delpost; const p = S.posts.find(x => x.id === id);
    if (p?.thumb) await deleteDoc(doc(db, "photos", id)).catch(() => {}); await deleteDoc(doc(db, "posts", id)); toast("削除しました"); } catch (e) { console.error(e); toast("削除できませんでした"); } });
  on("[data-invite]", async () => { const e = $("#inv").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast("メールアドレスの形が正しくありません");
    try { await setDoc(doc(db, "invites", e), { at: serverTimestamp() }); $("#inv").value = ""; toast(`${e} を招待リストに追加しました`); } catch (err) { console.error(err); toast("追加できませんでした"); } });
  on("[data-uninvite]", async b => { try { await deleteDoc(doc(db, "invites", b.dataset.uninvite)); toast("招待を取り消しました"); } catch (e) { console.error(e); toast("取り消せませんでした"); } });
  on("[data-kick]", async b => { try { await deleteDoc(doc(db, "members", b.dataset.kick)); toast("メンバーから外しました"); } catch (e) { console.error(e); toast("外せませんでした"); } });
  on("[data-delshop]", async b => { try { await deleteDoc(doc(db, "shops", b.dataset.delshop)); toast("お店を削除しました"); go("shops"); } catch (e) { console.error(e); toast("削除できませんでした"); } });
  on("[data-logout]", () => signOut(auth));
}
function bindCands(){
  const v = $("#view");
  v.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { draft.shopId = b.dataset.pick; render(); });
  v.querySelectorAll("[data-osm]").forEach(b => b.onclick = () => { draft.newShop = draft.results[+b.dataset.osm]; render(); });
  v.querySelectorAll("[data-manual]").forEach(b => b.onclick = () => { draft.newShop = { name: draft.q.trim(), address: "", area: "", manual: true }; render(); });
}

async function saveList(genre, list){
  const lists = { ...myLists(), [genre]: list };
  if (!list.length) delete lists[genre];
  try { await setDoc(doc(db, "ranks", S.user.uid), { lists, updatedAt: serverTimestamp() }); }
  catch (e) { console.error(e); toast("保存できませんでした。通信状態を確認してください"); }
}

async function submit(){
  const d = draft; if (d.sending) return;
  d.sending = true; render();
  try {
    // 1. お店（OpenStreetMapの店は番号で見分けるので、同じ店が2つ作られない）
    let shopId = d.shopId;
    if (!shopId && d.newShop) {
      const s = d.newShop;
      if (s.osm) {
        const ref = doc(db, "shops", s.id);
        await runTransaction(db, async t => { const cur = await t.get(ref);
          if (!cur.exists()) t.set(ref, { name: s.name, address: s.address, area: s.area, lat: s.lat, lon: s.lon, osm: true, createdBy: S.user.uid, createdAt: serverTimestamp() }); });
        shopId = s.id;
      } else {
        const same = [...S.shops.values()].find(x => x.name === s.name);
        if (same) shopId = same.id;
        else shopId = (await addDoc(collection(db, "shops"), { name: s.name, address: s.address.trim(), area: s.address.trim().slice(0, 12), osm: false, createdBy: S.user.uid, createdAt: serverTimestamp() })).id;
      }
    }
    // 2. 自分の順位
    const list = (myLists()[d.genre] ?? []).filter(x => x !== shopId);
    list.splice(d.pos, 0, shopId);
    await saveList(d.genre, list);
    // 3. コメントと写真
    if (d.comment.trim() || d.photo) {
      const post = { uid: S.user.uid, shopId, genre: d.genre, text: d.comment.trim(), createdAt: serverTimestamp() };
      if (d.thumb) post.thumb = d.thumb;
      const ref = await addDoc(collection(db, "posts"), post);
      if (d.photo) { await setDoc(doc(db, "photos", ref.id), { uid: S.user.uid, data: d.photo }); photoCache.set(ref.id, d.photo); }
    }
    const name = shopName(shopId) === "（削除された店）" ? (d.newShop?.name ?? "") : shopName(shopId);
    draft = null; rankGenre = d.genre;
    go("rank", S.user.uid);
    toast(`${name} を${d.genre} ${d.pos + 1}位で投稿しました`);
  } catch (e) {
    console.error(e); d.sending = false; render();
    toast("投稿できませんでした。通信状態を確認して、もう一度押してください");
  }
}

/* ---------- 写真 ---------- */
function shrink(file, max, quality){
  return new Promise((ok, ng) => {
    const r = new FileReader(); r.onerror = ng;
    r.onload = () => { const im = new Image(); im.onerror = ng; im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      ok(c.toDataURL("image/jpeg", quality));
    }; im.src = r.result; };
    r.readAsDataURL(file);
  });
}
async function fullPhoto(id){
  if (photoCache.has(id)) return photoCache.get(id);
  const s = await getDoc(doc(db, "photos", id));
  const data = s.exists() ? s.data().data : null;
  if (data) photoCache.set(id, data);
  return data;
}
// お店の画面の写真一覧は、小さい写真を先に出してから大きい写真に差し替える
function loadPhotos(){
  document.querySelectorAll("img[data-full]").forEach(async im => { const d = await fullPhoto(im.dataset.full).catch(() => null); if (d && im.isConnected) im.src = d; });
}
async function zoom(id){
  const p = S.posts.find(x => x.id === id); if (!p) return;
  const box = document.createElement("div"); box.className = "lightbox"; box.setAttribute("role", "dialog");
  box.innerHTML = `<img src="${p.thumb}" alt=""><p>${esc(memberName(p.uid))}・${esc(shopName(p.shopId))}・${p.genre}・${fmtDate(p)}${p.text ? `<br>${esc(p.text)}` : ""}</p><button>閉じる</button>`;
  box.onclick = e => { if (e.target === box || e.target.tagName === "BUTTON") box.remove(); };
  document.body.appendChild(box); box.querySelector("button").focus();
  const d = await fullPhoto(id).catch(() => null); if (d && box.isConnected) box.querySelector("img").src = d;
}
