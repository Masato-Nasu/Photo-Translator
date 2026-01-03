// Photo Tagger PWA (Capture -> Top-K tags) + Primary-only display + TTS
// Connects to your server: POST TAGGER_ENDPOINT/tagger?topk=30 (multipart image)
// Optional: POST TRANSLATE_ENDPOINT with { target, texts } -> { textsTranslated }

const cam = document.getElementById("cam");
const shot = document.getElementById("shot");
const ctx = shot.getContext("2d");

const btnStartCam = document.getElementById("btnStartCam");
const btnCapture = document.getElementById("btnCapture");
const btnRetake  = document.getElementById("btnRetake");
const btnAnalyze = document.getElementById("btnAnalyze");
const btnSpeakTop= document.getElementById("btnSpeakTop");

const file = document.getElementById("file");
const primarySel = document.getElementById("primary");
const topkSel = document.getElementById("topk");
const statusEl = document.getElementById("status");
const tagsEl = document.getElementById("tags");

// ====== CONFIG ======
const HF_SPACE_BASE = "https://mazzgogo-photo-translator.hf.space";
const TAGGER_ENDPOINT = HF_SPACE_BASE;
const TRANSLATE_ENDPOINT = `${HF_SPACE_BASE}/translate`;

// Image upload settings
const MAX_DIM = 1024;      // resize long edge to reduce bandwidth
const JPEG_QUALITY = 0.86;

let stream = null;
let frozen = false;
let lastTags = []; // [{label, score}] in CURRENT primary language
let lastPrimary = "en";

// ---------- helpers ----------
function setStatus(s){ statusEl.textContent = s; }

function bi(jp,en){ return `${jp} / ${en}`; }

function initUI(){
  // Buttons: add bilingual tooltips / accessibility labels
  const setBtn = (el, jp, en) => {
    if (!el) return;
    el.title = bi(jp,en);
    try{ el.setAttribute("aria-label", `${en} / ${jp}`); }catch(e){}
  };
  setBtn(btnCapture, "撮影", "Capture");
  setBtn(btnAnalyze, "解析", "Analyze");
  setBtn(btnRetake,  "再撮影", "Retake");
  setBtn(btnSpeakTop,"連続発音", "Speak top");
  if (file){ file.title = bi("画像を選択", "Choose image"); }
  if (topkSel){ topkSel.title = bi("タグ数(Top-K)", "Top-K tags"); }
  if (primarySel && primarySel.options){
    const map = {
      "ja": {jp:"日本語", en:"Japanese"},
      "en": {jp:"英語", en:"English"},
      "zh": {jp:"中文", en:"Chinese"},
      "ko": {jp:"한국어", en:"Korean"},
    };
    for (const opt of primarySel.options){
      const v = opt.value;
      if (map[v]) opt.textContent = `${map[v].jp} / ${map[v].en}`;
    }
  }
}


function langToTTS(lang){
  if (lang === "ja") return "ja-JP";
  if (lang === "en") return "en-US";
  if (lang === "zh") return "zh-CN";
  if (lang === "ko") return "ko-KR";
  return "en-US";
}

function langToTranslateTarget(lang){
  // Translation engines often prefer explicit locale for Chinese.
  if (lang === "zh") return "zh-CN";
  return lang; // en / ja / ko
}

function speak(text, lang){
  if (!text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = langToTTS(lang);
  speechSynthesis.speak(u);
}

function escapeHtml(s){
  return (s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function enableActions(enabled){
  btnAnalyze.disabled = !enabled;
}

function renderTags(tags){
  tagsEl.innerHTML = "";
  if (!tags.length){
    tagsEl.textContent = "タグが取得できませんでした。 / Couldn’t get tags.";
    btnSpeakTop.disabled = true;
    return;
  }
  btnSpeakTop.disabled = false;

  const showEnglish = (lastPrimary !== "en");

  for (const t of tags){
    const row = document.createElement("div");
    row.className = "tag";

    const enLine = (showEnglish && t.labelEn && t.labelEn !== t.label)
      ? `<div class="en" style="font-size:12px; opacity:.78; word-break:break-word;">${escapeHtml(t.labelEn)}</div>`
      : "";

    row.innerHTML = `
      <div style="min-width:0">
        <div class="label">${escapeHtml(t.label)}</div>
        ${enLine}
        <div class="score">${(t.score*100).toFixed(1)}%</div>
      </div>
      <button class="sbtn" aria-label="speak">🔊</button>
    `;

    const sayPrimary = () => speak(t.label, lastPrimary);
    row.querySelector(".sbtn").onclick = sayPrimary;
    row.querySelector(".label").onclick = sayPrimary;

    const enEl = row.querySelector(".en");
    if (enEl){
      enEl.onclick = () => speak(t.labelEn, "en"); // tap English line to hear English
    }

    tagsEl.appendChild(row);
  }
}


function startCamOnFirstGesture(){
  const once = async () => {
    if (!stream){
      await initCam();
    }else{
      try{ await cam.play(); }catch(e){}
    }
  };
  window.addEventListener('pointerdown', once, { once: true });
  window.addEventListener('touchstart', once, { once: true });
}

// ---------- camera ----------
async function initCam(){
  try{
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      throw Object.assign(new Error("getUserMedia_not_supported"), { name: "NotSupportedError" });
    }

    // Stop existing stream if any
    if (stream){
      try{ stream.getTracks().forEach(t => t.stop()); }catch(e){}
      stream = null;
    }

    // Mobile/desktop compatible constraints ladder
    const tries = [
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: { facingMode: "environment" }, audio: false },
      { video: { facingMode: { ideal: "user" } }, audio: false },
      { video: true, audio: false },
    ];

    let lastErr = null;
    for (const c of tries){
      try{
        stream = await navigator.mediaDevices.getUserMedia(c);
        lastErr = null;
        break;
      }catch(e){
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;

    cam.srcObject = stream;
    await new Promise(res => cam.onloadedmetadata = res);
    // play() may require a user gesture on iOS; try, and we retry on next tap.
    try{ await cam.play(); }catch(e){}
    setStatus("準備完了：📸で撮影 → 🔎でタグ解析 / Ready: 📸 Capture → 🔎 Analyze");
  }catch(e){
    console.error(e);
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError"){
      setStatus("カメラ許可が必要です。ブラウザのサイト設定でカメラを「許可」にしてください。/ Camera permission required. Allow camera in site settings.");
    }else if (name === "NotReadableError"){
      setStatus("カメラが他アプリで使用中の可能性があります（Zoom/Teams/カメラ等）。/ Camera is in use by another app.");
    }else if (name === "OverconstrainedError"){
      setStatus("カメラ条件が合いませんでした。別のカメラ/ブラウザで試してください。/ Camera constraints not satisfied.");
    }else{
      setStatus("カメラを起動できませんでした。HTTPS / 権限 / ブラウザ設定を確認してください。/ Couldn’t start the camera.");
    }
  }
}

function freezeFrame(){
  const w = cam.videoWidth || 0;
  const h = cam.videoHeight || 0;
  if (!w || !h){
    setStatus("カメラ映像が取得できませんでした。 / Couldn’t get camera stream.");
    return;
  }
  shot.width = w; shot.height = h;
  ctx.drawImage(cam, 0, 0, w, h);

  cam.style.display = "none";
  shot.style.display = "block";
  frozen = true;

  btnCapture.style.display = "none";
  btnRetake.style.display = "inline-block";
  enableActions(true);
  setStatus("撮影しました：🔎で解析 / Captured: tap 🔎 to analyze");
}

function unfreeze(){
  frozen = false;
  cam.style.display = "block";
  shot.style.display = "none";

  btnCapture.style.display = "inline-block";
  btnRetake.style.display = "none";

  enableActions(false);
  btnSpeakTop.disabled = true;

  tagsEl.textContent = "まだ解析していません。 / Not analyzed yet.";
  lastTags = [];
  setStatus("準備完了：📸で撮影 → 🔎でタグ解析 / Ready: 📸 Capture → 🔎 Analyze tags");
}

btnCapture.onclick = async () => {
  if (!stream){
    setStatus("カメラ許可が必要です。まず📷を押してください。/ Please start camera first (📷).");
    try{ await initCam(); }catch(e){}
    // If still no stream, stop here.
    if (!stream) return;
  }
  freezeFrame();
};
btnRetake.onclick = unfreeze;
btnStartCam.onclick = async () => { await initCam(); };

// ---------- file load ----------
file.addEventListener("change", async () => {
  const f = file.files?.[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    shot.width = img.naturalWidth;
    shot.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    cam.style.display = "none";
    shot.style.display = "block";
    frozen = true;

    btnCapture.style.display = "none";
    btnRetake.style.display = "inline-block";
    enableActions(true);

    setStatus("画像を読み込みました：🔎で解析 / Image loaded: tap 🔎 to analyze");
  };
  img.src = URL.createObjectURL(f);
});

// ---------- resize + blob ----------
async function canvasToJpegBlob(canvas){
  const w = canvas.width, h = canvas.height;
  const longEdge = Math.max(w, h);
  const scale = Math.min(1, MAX_DIM / longEdge);

  if (scale >= 1){
    return await new Promise(res => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
  }

  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const tmp = document.createElement("canvas");
  tmp.width = tw; tmp.height = th;
  const tctx = tmp.getContext("2d", { alpha:false });
  tctx.drawImage(canvas, 0, 0, tw, th);
  return await new Promise(res => tmp.toBlob(res, "image/jpeg", JPEG_QUALITY));
}

// ---------- API ----------
async function postTags(topk){
  if (!TAGGER_ENDPOINT){
    throw new Error("TAGGER_ENDPOINT not set");
  }
  const blob = await canvasToJpegBlob(shot);
  const fd = new FormData();
  fd.append("image", blob, "capture.jpg");

  const url = new URL(TAGGER_ENDPOINT.replace(/\/$/, "") + "/tagger");
  url.searchParams.set("topk", String(topk));

  const r = await fetch(url.toString(), { method:"POST", body: fd });
  if (!r.ok) throw new Error("tagger http " + r.status);
  const j = await r.json();

  const tags = (j.tags || []).map(x => {
    const en = x.label_en ?? x.label ?? "";
    return {
      label: en,      // current display label (may be translated later)
      labelEn: en,    // always keep English
      score: Number(x.score ?? 0)
    };
  });
  return tags.filter(t => t.label);
}

async function translateTexts(texts, target){
  if (!TRANSLATE_ENDPOINT) return null;
  const r = await fetch(TRANSLATE_ENDPOINT, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ target, texts })
  });
  if (!r.ok) throw new Error("translate http " + r.status);
  const j = await r.json();
  return j.textsTranslated || null;
}

btnAnalyze.onclick = async () => {
  try{
    if (!frozen){
      setStatus("まず📸で撮影するか、🖼で画像を読み込んでください。 / Capture (📸) or load an image (🖼) first.");
      return;
    }
    const topk = Number(topkSel.value || 30);
    const primary = primarySel.value || "en";
    lastPrimary = primary;

    setStatus("タグ解析中… / Analyzing tags…");
    tagsEl.textContent = "解析中… / Working…";
    btnSpeakTop.disabled = true;

    const tagsEn = await postTags(topk);
    if (!tagsEn.length){
      renderTags([]);
      setStatus("タグが空でした。 / No tags returned.");
      return;
    }

    let tagsPrimary = tagsEn;

    if (primary !== "en"){
      if (!TRANSLATE_ENDPOINT){
        setStatus("翻訳API未設定のため英語で表示しています（TRANSLATE_ENDPOINTを設定してください） / Translation not configured; showing English (set TRANSLATE_ENDPOINT).");
      } else {
        setStatus("翻訳中… / Translating…");
        const texts = tagsEn.map(t => t.label);
        const tr = await translateTexts(texts, langToTranslateTarget(primary));
        if (tr && tr.length){
          tagsPrimary = tagsEn.map((t,i)=>({ label: tr[i] || t.label, labelEn: t.labelEn || t.label, score: t.score }));
        } else {
          setStatus("翻訳に失敗したため英語で表示しています。 / Translation failed; showing English.");
        }
      }
    }

    lastTags = tagsPrimary;
    renderTags(tagsPrimary);
    setStatus("完了：タグをタップすると発音します / Done: tap a tag to hear pronunciation.");
  }catch(e){
    console.error(e);
    if (String(e?.message || "").includes("TAGGER_ENDPOINT not set")){
      setStatus("TAGGER_ENDPOINT が未設定です。app.js を開いてエンドポイントを設定してください。 / TAGGER_ENDPOINT is not set. Open app.js and set the endpoint.");
    } else {
      setStatus("エラー / Error: " + (e?.message || e));
    }
    tagsEl.textContent = "エラーが発生しました。 / An error occurred.";
  }
};

// Speak top N sequentially (simple queue)
btnSpeakTop.onclick = async () => {
  if (!lastTags.length) return;
  const n = Math.min(10, lastTags.length);
  setStatus("連続発音中…（上位" + n + "） / Speaking… (Top " + n + ")");

  speechSynthesis.cancel();

  let i = 0;
  const speakNext = () => {
    if (i >= n){
      setStatus("完了：タグをタップすると発音します / Done: tap a tag to hear pronunciation.");
      return;
    }
    const text = lastTags[i].label;
    i++;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langToTTS(lastPrimary);
    u.onend = speakNext;
    u.onerror = speakNext;
    speechSynthesis.speak(u);
  };
  speakNext();
};

// Kickoff
startCamOnFirstGesture();
initUI();
initCam();

// PWA service worker
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
