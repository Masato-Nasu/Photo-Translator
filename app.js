// Photo Tagger PWA (Capture -> Top-K tags) + Primary-only display + TTS
// Connects to your server: POST TAGGER_ENDPOINT/tagger?topk=30 (multipart image)
// Optional: POST TRANSLATE_ENDPOINT with { target, texts } -> { textsTranslated }

const cam = document.getElementById("cam");
const shot = document.getElementById("shot");
const ctx = shot.getContext("2d");

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
const MAX_DIM = 1024;      // resize long edge to reduce bandwidth
const JPEG_QUALITY = 0.86;

let stream = null;
let frozen = false;
let lastTags = []; // [{label, score}] in CURRENT primary language
let lastPrimary = "en"; // kept for compatibility (not used)

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
  // Prefer exact or prefix match
  let v = _voices.find(v => (v.lang || "").toLowerCase() === lt);
  if (!v) v = _voices.find(v => (v.lang || "").toLowerCase().startsWith(lt.split("-")[0]));
  return v || null;
}
if (typeof speechSynthesis !== "undefined"){
  // Some browsers populate voices async
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

function renderTags(tags){
  tagsEl.innerHTML = "";
  if (!tags.length){
    tagsEl.textContent = "タグが取得できませんでした。";
    return;
  }

  for (const t of tags){
    const row = document.createElement("div");
    row.className = "tag";
    const en = t.en || "";
    const ja = t.ja || "";
    const zh = t.zh || "";
    const ko = t.ko || "";

    row.innerHTML = `
      <div class="tline" data-lang="ja">
        <div class="tleft">
          <span class="tlang">🇯🇵 JP</span>
          <span class="tmain">${escapeHtml(ja || "—")}</span>
          <span class="tgloss en-gloss" title="Speak English / 英語で発音">(${escapeHtml(en)})</span>
        </div>
        <div class="tright">
          <button class="sbtn" aria-label="speak-ja">🔊</button>
          <button class="sbtn sbtn-en" aria-label="speak-en">🔊EN</button>
        </div>
      </div>
      <div class="tline" data-lang="zh">
        <div class="tleft">
          <span class="tlang">🇨🇳 ZH</span>
          <span class="tmain">${escapeHtml(zh || "—")}</span>
          <span class="tgloss en-gloss" title="Speak English / 英語で発音">(${escapeHtml(en)})</span>
        </div>
        <div class="tright">
          <button class="sbtn" aria-label="speak-zh">🔊</button>
          <button class="sbtn sbtn-en" aria-label="speak-en">🔊EN</button>
        </div>
      </div>
      <div class="tline" data-lang="ko">
        <div class="tleft">
          <span class="tlang">🇰🇷 KO</span>
          <span class="tmain">${escapeHtml(ko || "—")}</span>
          <span class="tgloss en-gloss" title="Speak English / 英語で発音">(${escapeHtml(en)})</span>
        </div>
        <div class="tright">
          <button class="sbtn" aria-label="speak-ko">🔊</button>
          <button class="sbtn sbtn-en" aria-label="speak-en">🔊EN</button>
        </div>
      </div>
      <div class="score">${(t.score*100).toFixed(1)}%</div>
    `;

    const bindLine = (lang, textGetter) => {
      const line = row.querySelector(`.tline[data-lang="${lang}"]`);
      const btnMain = line.querySelector(".sbtn");
      const btnEn = line.querySelector(".sbtn-en");
      const label = line.querySelector(".tmain");
      const glossEn = line.querySelector(".en-gloss");

      const sayMain = () => {
        const txt = (textGetter() || "").trim();
        if (!txt || txt === "—") return;
        speak(txt, lang);
      };
      const sayEn = () => {
        const txt = (en || "").trim();
        if (!txt || txt === "—") return;
        speak(txt, "en");
      };

      btnMain.onclick = sayMain;
      label.onclick = sayMain;

      if (btnEn) btnEn.onclick = sayEn;
      if (glossEn) glossEn.onclick = sayEn;

      // Disable speak if missing
      const mainTxt = (textGetter() || "").trim();
      if (!mainTxt || mainTxt === "—") btnMain.disabled = true;
      const enTxt = (en || "").trim();
      if (!enTxt || enTxt === "—") { if (btnEn) btnEn.disabled = true; }
    };
      btn.onclick = say;
      label.onclick = say;
      // Disable speak if missing
      if (!textGetter() || textGetter() === "—") btn.disabled = true;
    };

    bindLine("ja", () => ja || "");
    bindLine("zh", () => zh || "");
    bindLine("ko", () => ko || "");

    tagsEl.appendChild(row);
  }
}

// ---------- camera ----------
async function initCam(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
    cam.srcObject = stream;
    await new Promise(res => cam.onloadedmetadata = res);
    await cam.play();
    setStatus("準備完了：📸で撮影 → 🔎でタグ解析");
  }catch(e){
    console.error(e);
    setStatus("カメラを起動できませんでした。HTTPS / 権限 / ブラウザ設定を確認してください。");
  }
}

function freezeFrame(){
  const w = cam.videoWidth || 0;
  const h = cam.videoHeight || 0;
  if (!w || !h){
    setStatus("カメラ映像が取得できませんでした。");
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
  lastTags = [];
  setStatus("準備完了：📸で撮影 → 🔎でタグ解析");
}

btnCapture.onclick = freezeFrame;
btnRetake.onclick = unfreeze;

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
  return j.textsTranslated || null;
}

btnAnalyze.onclick = async () => {
  try{
    if (!frozen){
      setStatus("まず📸で撮影するか、🖼で画像を読み込んでください。 / Please capture (📸) or load an image (🖼).");
      return;
    }
    const topk = Number(topkSel.value || 30);

    setStatus("タグ解析中… / Analyzing…");
    tagsEl.textContent = "解析中…";

    const tagsEn = await postTags(topk);
    if (!tagsEn.length){
      renderTags([]);
      setStatus("タグが空でした。 / No tags.");
      return;
    }

    // Always keep English labels as gloss, and translate to JA/ZH/KO.
    const texts = tagsEn.map(t => t.label);
    const out = tagsEn.map(t => ({ en: t.label, ja:"", zh:"", ko:"", score: t.score }));

    if (!TRANSLATE_ENDPOINT){
      setStatus("翻訳API未設定のため英語のみ表示します（TRANSLATE_ENDPOINTを設定してください）。 / Translation API not set; showing English only.");
      lastTags = out;
      renderTags(out);
      return;
    }

    // Translate sequentially to reduce rate-limit issues.
    setStatus("翻訳中… JP / Translating… JP");
    let trJa = null;
    try{ trJa = await translateTexts(texts, "ja"); }catch(e){ console.warn(e); }

    setStatus("翻訳中… ZH / Translating… ZH");
    let trZh = null;
    try{ trZh = await translateTexts(texts, "zh"); }catch(e){ console.warn(e); }

    setStatus("翻訳中… KO / Translating… KO");
    let trKo = null;
    try{ trKo = await translateTexts(texts, "ko"); }catch(e){ console.warn(e); }

    for (let i=0;i<out.length;i++){
      out[i].ja = (trJa && trJa[i]) ? trJa[i] : "";
      out[i].zh = (trZh && trZh[i]) ? trZh[i] : "";
      out[i].ko = (trKo && trKo[i]) ? trKo[i] : "";
    }

    lastTags = out;
    renderTags(out);
    setStatus("完了：各言語をタップで発音します / Done: tap each line to speak");
  }catch(e){
    console.error(e);
    if (String(e?.message || "").includes("TAGGER_ENDPOINT not set")){
      setStatus("TAGGER_ENDPOINT が未設定です。app.js を開いてエンドポイントを設定してください。");
    } else {
      setStatus("エラー：" + (e?.message || e));
    }
    tagsEl.textContent = "エラーが発生しました。";
  }
};


// Kickoff
initCam();

// PWA service worker
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
