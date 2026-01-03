
function drawImageToShot(imgOrVideo, srcW, srcH){
  const longEdge = Math.max(srcW, srcH);
  const scale = Math.min(1, PREVIEW_MAX_DIM / longEdge);
  const tw = Math.max(1, Math.round(srcW * scale));
  const th = Math.max(1, Math.round(srcH * scale));
  shot.width = tw; shot.height = th;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.drawImage(imgOrVideo, 0, 0, tw, th);
}

// Photo Translator PWA (Capture/Upload -> Top-K tags -> JA/ZH/KO+EN) + TTS
// Connects to your server: POST TAGGER_ENDPOINT/tagger?topk=30 (multipart image)
// Optional: POST TRANSLATE_ENDPOINT with { target, texts } -> { textsTranslated }

const cam = document.getElementById("cam");
const shot = document.getElementById("shot");
const ctx = shot.getContext("2d");

const btnStartCam = document.getElementById("btnStartCam");
const btnPick    = document.getElementById("btnPick");
const fileInput  = document.getElementById("fileInput");
const btnCapture = document.getElementById("btnCapture");
const btnRetake  = document.getElementById("btnRetake");
const btnAnalyze = document.getElementById("btnAnalyze");

const file = document.getElementById("file");
const topkSel = document.getElementById("topk");
const statusEl = document.getElementById("status");
const tagsEl = document.getElementById("tags");

// ====== CONFIG ======
const TAGGER_ENDPOINT = "https://mazzgogo-photo-translator.hf.space/";
const TRANSLATE_ENDPOINT = "https://mazzgogo-photo-translator.hf.space/translate";


// Image upload settings
const MAX_DIM = 1024;
const PREVIEW_MAX_DIM = 1600; // keep UI responsive even for huge photos      // resize long edge to reduce bandwidth
const JPEG_QUALITY = 0.86;

let stream = null;
let frozen = false;
let lastItems = []; // [{en, ja, zh, ko, score}]


// ---------- helpers ----------
function setStatus(s){ statusEl.textContent = s; }

function langToTTS(lang){
  if (lang === "ja") return "ja-JP";
  if (lang === "en") return "en-US";
  if (lang === "zh") return "zh-CN";
  if (lang === "ko") return "ko-KR";
  return "en-US";
}


let _voices = [];
function refreshVoices(){
  try{ _voices = speechSynthesis.getVoices() || []; }catch(e){ _voices = []; }
}
function pickVoice(langTag){
  refreshVoices();
  const lt = (langTag || "").toLowerCase();
  // Prefer exact match, then prefix match (e.g., "en" matches "en-US")
  let v = _voices.find(v => (v.lang || "").toLowerCase() === lt);
  if (!v) v = _voices.find(v => (v.lang || "").toLowerCase().startsWith(lt.split("-")[0]));
  return v || null;
}
if (typeof speechSynthesis !== "undefined"){
  speechSynthesis.onvoiceschanged = refreshVoices;
  refreshVoices();
}

function speak(text, lang){
  if (!text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const tag = langToTTS(lang);
  u.lang = tag;
  const v = pickVoice(tag);
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

function escapeHtml(s){
  return (s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function enableActions(enabled){
  btnAnalyze.disabled = !enabled;
}

function renderTags(items){
  tagsEl.innerHTML = "";
  if (!items.length){
    tagsEl.textContent = "タグが取得できませんでした。";
    return;
  }

  for (const it of items){
    const row = document.createElement("div");
    row.className = "tag";

    const en = it.en || "—";
    const ja = it.ja || "—";
    const zh = it.zh || "—";
    const ko = it.ko || "—";
    const score = (it.score*100).toFixed(1) + "%";

    row.innerHTML = `
      <div class="tline" data-lang="en">
        <div class="tleft">
          <span class="tlang">🇺🇸 EN</span>
          <span class="tmain">${escapeHtml(en)}</span>
        </div>
        <div class="tright">
          <span class="score">${score}</span>
          <button class="sbtn" aria-label="speak-en">🔊</button>
        </div>
      </div>

      <div class="tline" data-lang="ja">
        <div class="tleft">
          <span class="tlang">🇯🇵 JA</span>
          <span class="tmain">${escapeHtml(ja)}</span>
          <span class="tgloss en-gloss">(${escapeHtml(en)})</span>
        </div>
        <div class="tright">
          <button class="sbtn" aria-label="speak-ja">🔊</button>
        </div>
      </div>

      <div class="tline" data-lang="zh">
        <div class="tleft">
          <span class="tlang">🇨🇳 ZH</span>
          <span class="tmain">${escapeHtml(zh)}</span>
          <span class="tgloss en-gloss">(${escapeHtml(en)})</span>
        </div>
        <div class="tright">
          <button class="sbtn" aria-label="speak-zh">🔊</button>
        </div>
      </div>

      <div class="tline" data-lang="ko">
        <div class="tleft">
          <span class="tlang">🇰🇷 KO</span>
          <span class="tmain">${escapeHtml(ko)}</span>
          <span class="tgloss en-gloss">(${escapeHtml(en)})</span>
        </div>
        <div class="tright">
          <button class="sbtn" aria-label="speak-ko">🔊</button>
        </div>
      </div>
    `;

    const bindLine = (lang, text) => {
      const line = row.querySelector(`.tline[data-lang="${lang}"]`);
      const btn = line.querySelector(".sbtn");
      const main = line.querySelector(".tmain");
      const gloss = line.querySelector(".en-gloss");

      const sayMain = () => {
        const t = (text || "").trim();
        if (!t || t === "—") return;
        speak(t, lang);
      };
      const sayEn = () => {
        const t = (en || "").trim();
        if (!t || t === "—") return;
        speak(t, "en");
      };

      btn.onclick = sayMain;
      main.onclick = sayMain;

      // English line: gloss isn't present; we still allow clicking main to speak EN
      if (lang !== "en" && gloss){
        gloss.onclick = sayEn;
      }

      if (!text || text === "—") btn.disabled = true;
    };

    bindLine("en", en);
    bindLine("ja", ja);
    bindLine("zh", zh);
    bindLine("ko", ko);

    tagsEl.appendChild(row);
  }
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
    const tries = [
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      { video: { facingMode: "environment" }, audio: false },
      { video: { facingMode: { ideal: "user" } }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr = null;
    for (const c of tries){
      try{ stream = await navigator.mediaDevices.getUserMedia(c); lastErr = null; break; }
      catch(e){ lastErr = e; }
    }
    if (lastErr) throw lastErr;

    cam.srcObject = stream;
    await new Promise(res => cam.onloadedmetadata = res);
    try{ await cam.play(); }catch(e){}

    // Show camera view
    cam.style.display = "block";
    shot.style.display = "none";
    frozen = false;
    btnRetake.style.display = "none";
    btnCapture.style.display = "inline-flex";
    btnAnalyze.disabled = true;

    setStatus("準備完了：📸で撮影 or 🖼で画像選択 → 🔎でタグ解析 / Ready: 📸 Capture or 🖼 Choose → 🔎 Analyze");
  }catch(e){
    console.error(e);
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError"){
      setStatus("カメラ許可が必要です。ブラウザのサイト設定でカメラを「許可」にしてください。 / Camera permission required. Allow camera in site settings.");
    }else if (name === "NotReadableError"){
      setStatus("カメラが他アプリで使用中の可能性があります（Zoom/Teams/カメラ等）。 / Camera may be in use by another app.");
    }else{
      setStatus("カメラを起動できませんでした。HTTPS / 権限 / ブラウザ設定を確認してください。 / Couldn’t start the camera.");
    }
  }
}

function freezeFrame(){
  const w = cam.videoWidth || 0;
  const h = cam.videoHeight || 0;
  if (!w || !h){
    setStatus("カメラ映像が取得できませんでした。");
    return;
  }
  drawImageToShot(cam, w, h);

  cam.style.display = "none";
  shot.style.display = "block";
  frozen = true;

  btnCapture.style.display = "none";
  btnRetake.style.display = "inline-block";
  enableActions(true);
  setStatus("撮影しました：🔎で解析");
}

function unfreeze(){
  frozen = false;
  cam.style.display = "block";
  shot.style.display = "none";

  btnCapture.style.display = "inline-block";
  btnRetake.style.display = "none";

  enableActions(false);
  
  tagsEl.textContent = "まだ解析していません。";
  lastItems = [];
  setStatus("準備完了：📸で撮影 → 🔎でタグ解析");
}

btnCapture.onclick = async () => {
  if (!stream){
    setStatus("カメラ許可が必要です。先に📷を押してください。 / Please tap 📷 Start Camera first.");
    await initCam();
    if (!stream) return;
  }
  freezeFrame();
};
btnRetake.onclick = unfreeze;
btnStartCam.onclick = async () => { await initCam(); };
btnPick.onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  try{
    setStatus("画像を読み込み中… / Loading image…");
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      try{
        drawImageToShot(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
        cam.style.display = "none";
        shot.style.display = "block";
        frozen = true;
        btnCapture.style.display = "none";
        btnRetake.style.display = "inline-flex";
        btnAnalyze.disabled = false;
        setStatus("画像OK：🔎でタグ解析 / Image ready: 🔎 Analyze");
      }finally{
        URL.revokeObjectURL(url);
        fileInput.value = "";
      }
    };
    img.onerror = () => {
      setStatus("画像を読み込めませんでした。別の画像で試してください。 / Could not load image.");
      URL.revokeObjectURL(url);
      fileInput.value = "";
    };
    img.src = url;
  }catch(e){
    console.error(e);
    setStatus("画像読み込みでエラーが発生しました。 / Error while loading image.");
  }
};

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

    setStatus("画像を読み込みました：🔎で解析");
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

  const tags = (j.tags || []).map(x => ({
    label: x.label_en ?? x.label ?? "",
    score: Number(x.score ?? 0)
  }));
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
  if (j && (j.error || j.detail) && !(j.textsTranslated && j.textsTranslated.length)) {
    return null;
  }
  return j.textsTranslated || null;
}

btnAnalyze.onclick = async () => {
  try{
    if (!frozen){
      setStatus("まず📸で撮影するか、🖼で画像を読み込んでください。 / Please capture (📸) or choose an image (🖼) first.");
      return;
    }
    const topk = Number(topkSel.value || 30);

    setStatus("タグ解析中… / Working… / Analyzing…");
    tagsEl.textContent = "解析中… / Working…";

    const tagsEn = await postTags(topk);
    if (!tagsEn.length){
      renderTags([]);
      setStatus("タグが空でした。 / No tags returned.");
      return;
    }

    const texts = tagsEn.map(t => t.label);

    let trJa = null, trZh = null, trKo = null;
    if (!TRANSLATE_ENDPOINT){
      setStatus("翻訳API未設定のため英語のみ表示しています（TRANSLATE_ENDPOINTを設定してください） / Translation API not set, showing English only (set TRANSLATE_ENDPOINT).");
    } else {
      setStatus("翻訳中… / Translating…");
      try{ trJa = await translateTexts(texts, "ja"); }catch(e){ trJa = null; }
      try{ trZh = await translateTexts(texts, "zh"); }catch(e){ trZh = null; }
      try{ trKo = await translateTexts(texts, "ko"); }catch(e){ trKo = null; }
    }

    const items = tagsEn.map((t, i) => ({
      en: t.label,
      ja: trJa && trJa[i] ? trJa[i] : null,
      zh: trZh && trZh[i] ? trZh[i] : null,
      ko: trKo && trKo[i] ? trKo[i] : null,
      score: t.score
    }));

    lastItems = items;
    renderTags(items);

    // If any translation is missing, mention it lightly (still usable).
    if (TRANSLATE_ENDPOINT && (!trJa || !trZh || !trKo)){
      setStatus("完了：一部翻訳に失敗した単語は英語で補っています / Done (some words fall back to English). / Done");
    } else {
      setStatus("完了：各行をタップするとその言語で発音します / Done: tap to speak. / Done");
    }
  }catch(e){
    console.error(e);
    if (String(e?.message || "").includes("TAGGER_ENDPOINT not set")){
      setStatus("TAGGER_ENDPOINT が未設定です。app.js を開いてエンドポイントを設定してください。 / TAGGER_ENDPOINT is not set. Please set it in app.js.");
    } else {
      setStatus("エラー：" + (e?.message || e));
    }
    tagsEl.textContent = "エラーが発生しました。 / An error occurred.";
  }
};

// Speak top N sequentially (simple queue)

function startCamOnFirstGesture(){
  const once = async () => {
    if (!stream){ await initCam(); }
  };
  window.addEventListener('pointerdown', once, { once:true });
  window.addEventListener('touchstart', once, { once:true });
}

// Kickoff
startCamOnFirstGesture();
try{ topkSel.value = "10"; }catch(e){}
setStatus("カメラ未開始です。📷を押して許可してください。 / Camera not started. Tap 📷 Start Camera and allow.");

// PWA service worker
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js")
  .then((reg) => {
    try{ reg.update(); }catch(e){}
    // If a new SW is waiting, activate it immediately
    if (reg.waiting){
      try{ reg.waiting.postMessage({type:"SKIP_WAITING"}); }catch(e){}
    }
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && reg.waiting){
          try{ reg.waiting.postMessage({type:"SKIP_WAITING"}); }catch(e){}
        }
      });
    });
  })
  .catch(()=>{});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Reload once when the new SW takes control
    if (window.__swReloaded) return;
    window.__swReloaded = true;
    window.location.reload();
  });
}
