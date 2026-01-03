// Photo Tagger PWA (Capture -> Top-K tags) + Primary-only display + TTS
// Connects to your server: POST TAGGER_ENDPOINT/tagger?topk=30 (multipart image)
// Optional: POST TRANSLATE_ENDPOINT with { target, texts } -> { textsTranslated }

const cam = document.getElementById("cam");
const shot = document.getElementById("shot");
const ctx = shot.getContext("2d");

const btnCapture = document.getElementById("btnCapture");
const btnRetake  = document.getElementById("btnRetake");
const btnAnalyze = document.getElementById("btnAnalyze");
const btnSpeakTop = document.getElementById("btnSpeakTop");

const file = document.getElementById("file");
const primarySel = document.getElementById("primary");
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
let lastPrimary = "en";

// ---------- helpers ----------
function setStatus(s){ statusEl.textContent = s; }

function langToTTS(lang){
  if (lang === "ja") return "ja-JP";
  if (lang === "en") return "en-US";
  if (lang === "zh") return "zh-CN";
  if (lang === "ko") return "ko-KR";
  return "en-US";
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
    tagsEl.textContent = "タグが取得できませんでした。";
    if (btnSpeakTop) btnSpeakTop.disabled = true;
    return;
  }
  if (btnSpeakTop) btnSpeakTop.disabled = false;

  for (const t of tags){
    const row = document.createElement("div");
    row.className = "tag";
    row.innerHTML = `
      <div style="min-width:0">
        <div class="label">${escapeHtml(t.label)}</div>
        <div class="score">${(t.score*100).toFixed(1)}%</div>
      </div>
      <button class="sbtn" aria-label="speak">🔊</button>
    `;
    const say = () => speak(t.label, lastPrimary);
    row.querySelector(".sbtn").onclick = say;
    row.querySelector(".label").onclick = say;
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
  if (btnSpeakTop) btnSpeakTop.disabled = true;

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
      setStatus("まず📸で撮影するか、🖼で画像を読み込んでください。");
      return;
    }
    const topk = Number(topkSel.value || 30);
    const primary = primarySel.value || "en";
    lastPrimary = primary;

    setStatus("タグ解析中…");
    tagsEl.textContent = "解析中…";
    if (btnSpeakTop) btnSpeakTop.disabled = true;

    const tagsEn = await postTags(topk);
    if (!tagsEn.length){
      renderTags([]);
      setStatus("タグが空でした。");
      return;
    }

    let tagsPrimary = tagsEn;

    if (primary !== "en"){
      if (!TRANSLATE_ENDPOINT){
        setStatus("翻訳API未設定のため英語で表示しています（TRANSLATE_ENDPOINTを設定してください）");
      } else {
        setStatus("翻訳中…");
        const texts = tagsEn.map(t => t.label);
        const tr = await translateTexts(texts, primary);
        if (tr && tr.length){
          tagsPrimary = tagsEn.map((t,i)=>({ label: tr[i] || t.label, score: t.score }));
        } else {
          setStatus("翻訳に失敗したため英語で表示しています。");
        }
      }
    }

    lastTags = tagsPrimary;
    renderTags(tagsPrimary);
    setStatus("完了：タグをタップすると発音します");
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

// Speak top N sequentially — removed from UI (kept optional)
if (btnSpeakTop) btnSpeakTop.onclick = async () => {
  if (!lastTags.length) return;
  const n = Math.min(10, lastTags.length);
  setStatus("連続発音中…（上位" + n + "）");

  speechSynthesis.cancel();

  let i = 0;
  const speakNext = () => {
    if (i >= n){
      setStatus("完了：タグをタップすると発音します");
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
initCam();

// PWA service worker
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
