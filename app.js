// Photo Translator PWA
// Capture/Upload -> Top-K tags (EN) -> Translate to JA/ZH/KO -> Speak via device TTS
//
// Server endpoints (FastAPI on HF Spaces):
//   POST /tagger?topk=30   (multipart: image)
//   POST /translate        (json: { target, texts }) -> { textsTranslated }

const cam = document.getElementById("cam");
const shot = document.getElementById("shot");
const ctx = shot.getContext("2d");

const btnCapture = document.getElementById("btnCapture");
const btnRetake = document.getElementById("btnRetake");
const btnAnalyze = document.getElementById("btnAnalyze");
const btnPick = document.getElementById("btnPick");
const file = document.getElementById("file");
const topkSel = document.getElementById("topk");

const statusEl = document.getElementById("status");
const tagsEl = document.getElementById("tags");

// ====== CONFIG ======
const TAGGER_ENDPOINT = "https://mazzgogo-photo-translator.hf.space";
const TRANSLATE_ENDPOINT = "https://mazzgogo-photo-translator.hf.space/translate";

// Image upload settings (speed/quality trade)
const MAX_DIM = 768;          // resize long edge to reduce bandwidth (faster)
const JPEG_QUALITY = 0.80;
const PREVIEW_MAX_DIM = 1600; // limit on-screen canvas size so UI stays usable

let stream = null;
let frozen = false;
let lastRunId = 0; // cancels stale async results

// ---------- UI helpers ----------
function setStatus(s) {
  statusEl.textContent = s;
}

function enableActions(enabled) {
  btnAnalyze.disabled = !enabled;
}

function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---------- canvas draw ----------
function drawImageToShot(src, srcW, srcH) {
  const longEdge = Math.max(srcW, srcH);
  const scale = Math.min(1, PREVIEW_MAX_DIM / longEdge);
  const tw = Math.max(1, Math.round(srcW * scale));
  const th = Math.max(1, Math.round(srcH * scale));
  shot.width = tw;
  shot.height = th;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(src, 0, 0, tw, th);
}

async function waitForVideoReady(timeoutMs = 1500) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const w = cam.videoWidth || 0;
    const h = cam.videoHeight || 0;
    if (w > 0 && h > 0 && cam.readyState >= 2) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

// ---------- TTS ----------
function langToTTS(lang) {
  if (lang === "ja") return "ja-JP";
  if (lang === "en") return "en-US";
  if (lang === "zh") return "zh-CN";
  if (lang === "ko") return "ko-KR";
  return "en-US";
}

let _voices = [];
function refreshVoices() {
  try {
    _voices = speechSynthesis.getVoices() || [];
  } catch {
    _voices = [];
  }
}
function pickVoice(langTag) {
  refreshVoices();
  const lt = (langTag || "").toLowerCase();
  let v = _voices.find((x) => (x.lang || "").toLowerCase() === lt);
  if (!v) v = _voices.find((x) => (x.lang || "").toLowerCase().startsWith(lt.split("-")[0]));
  return v || null;
}
if (typeof speechSynthesis !== "undefined") {
  speechSynthesis.onvoiceschanged = refreshVoices;
  refreshVoices();
}

function speak(text, lang) {
  const t = (text || "").trim();
  if (!t || t === "—" || t === "…") return;
  try { speechSynthesis.cancel(); } catch {}
  const u = new SpeechSynthesisUtterance(t);
  const tag = langToTTS(lang);
  u.lang = tag;
  const v = pickVoice(tag);
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// ---------- Translation cache (localStorage) ----------
const TR_CACHE_PREFIX = "pt_tr_cache_v1_";
const TR_CACHE_MAX_KEYS = 2500;

function loadTrCache(lang) {
  try {
    const raw = localStorage.getItem(TR_CACHE_PREFIX + lang);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === "object") ? obj : {};
  } catch {
    return {};
  }
}

function trimTrCache(cacheObj) {
  const keys = Object.keys(cacheObj);
  if (keys.length <= TR_CACHE_MAX_KEYS) return;
  // Delete oldest entries (object keeps insertion order).
  const removeN = keys.length - TR_CACHE_MAX_KEYS;
  for (let i = 0; i < removeN; i++) {
    delete cacheObj[keys[i]];
  }
}

function saveTrCache(lang, cacheObj) {
  try {
    trimTrCache(cacheObj);
    localStorage.setItem(TR_CACHE_PREFIX + lang, JSON.stringify(cacheObj));
  } catch {
    // storage full or disabled -> ignore
  }
}

// ---------- API ----------
async function canvasToJpegBlob(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const longEdge = Math.max(w, h);
  const scale = Math.min(1, MAX_DIM / longEdge);

  if (scale >= 1) {
    return await new Promise((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
  }

  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const tmp = document.createElement("canvas");
  tmp.width = tw;
  tmp.height = th;
  const tctx = tmp.getContext("2d", { alpha: false });
  tctx.drawImage(canvas, 0, 0, tw, th);
  return await new Promise((res) => tmp.toBlob(res, "image/jpeg", JPEG_QUALITY));
}

async function postTags(topk) {
  const blob = await canvasToJpegBlob(shot);
  const fd = new FormData();
  fd.append("image", blob, "capture.jpg");

  const url = new URL(TAGGER_ENDPOINT.replace(/\/$/, "") + "/tagger");
  url.searchParams.set("topk", String(topk));

  const r = await fetch(url.toString(), { method: "POST", body: fd });
  if (!r.ok) throw new Error("tagger http " + r.status);
  const j = await r.json();

  const tags = (j.tags || []).map((x) => ({
    label: x.label_en ?? x.label ?? "",
    score: Number(x.score ?? 0),
  }));
  return tags.filter((t) => t.label);
}

async function translateTexts(texts, target) {
  const r = await fetch(TRANSLATE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, texts }),
  });
  if (!r.ok) throw new Error("translate http " + r.status);
  const j = await r.json();
  return j.textsTranslated || null;
}

async function translateWithCache(texts, lang) {
  const cache = loadTrCache(lang);
  const out = new Array(texts.length);
  const idxByKey = new Map();

  for (let i = 0; i < texts.length; i++) {
    const key = (texts[i] || "").trim();
    if (!key) {
      out[i] = "";
      continue;
    }
    if (cache[key]) {
      out[i] = cache[key];
      continue;
    }
    out[i] = null;
    if (!idxByKey.has(key)) idxByKey.set(key, []);
    idxByKey.get(key).push(i);
  }

  const missing = [...idxByKey.keys()];
  if (missing.length === 0) return out;

  const tr = await translateTexts(missing, lang);
  if (!tr || !Array.isArray(tr)) return out;

  for (let j = 0; j < missing.length; j++) {
    const key = missing[j];
    const val = (tr[j] || "").trim();
    if (val) cache[key] = val;
    const idxs = idxByKey.get(key) || [];
    for (const i of idxs) out[i] = val || null;
  }

  saveTrCache(lang, cache);
  return out;
}

// ---------- Rendering (group 4 languages per tag) ----------
function renderTags(items) {
  tagsEl.innerHTML = "";
  if (!items || !items.length) {
    tagsEl.textContent = "タグが取得できませんでした。";
    return;
  }

  const makeSeg = (lang, label, text) => {
    const safeText = escapeHtml(text || "—");
    const disabled = (!text || text === "—" || text === "…") ? "disabled" : "";
    return `
      <div class="seg" data-lang="${lang}">
        <span class="tlang">${label}</span>
        <span class="ttext">${safeText}</span>
        <button class="sbtn" type="button" ${disabled} aria-label="speak-${lang}">🔊</button>
      </div>
    `;
  };

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "tag";

    row.innerHTML = `
      <div class="tagHead">
        <span class="tagRank">#${it.rank ?? ""}</span>
        <span class="score">${((it.score ?? 0) * 100).toFixed(1)}%</span>
      </div>
      <div class="tgroup">
        ${makeSeg("en", "🇺🇸 EN", it.en)}
        ${makeSeg("ja", "🇯🇵 JA", it.ja)}
        ${makeSeg("zh", "🇨🇳 ZH", it.zh)}
        ${makeSeg("ko", "🇰🇷 KO", it.ko)}
      </div>
    `;

    // Bind speak actions
    for (const seg of row.querySelectorAll(".seg")) {
      const lang = seg.dataset.lang;
      const textEl = seg.querySelector(".ttext");
      const btn = seg.querySelector(".sbtn");
      const say = () => speak(textEl.textContent, lang);
      textEl.onclick = say;
      btn.onclick = say;
    }

    tagsEl.appendChild(row);
  }
}

// ---------- Camera ----------
async function initCam() {
  const primary = { video: { facingMode: { ideal: "environment" } }, audio: false };
  const fallback = { video: true, audio: false };

  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia(primary);
    } catch (e1) {
      console.warn("primary getUserMedia failed, retrying with fallback", e1);
      stream = await navigator.mediaDevices.getUserMedia(fallback);
    }

    cam.srcObject = stream;
    await new Promise((res) => (cam.onloadedmetadata = res));
    await cam.play();

    // Now the preview is live. Next tap captures.
    btnCapture.textContent = "📸 撮影 / Capture";

    setStatus("準備完了：📸で撮影 → 🔎でタグ解析 / または 🖼で画像選択");
    return true;
  } catch (e) {
    console.error(e);
    stream = null;
    cam.srcObject = null;
    setStatus("カメラを起動できませんでした。権限（カメラ許可）/ HTTPS / ブラウザ設定をご確認ください。ダメな場合は🖼から選べます。");
    return false;
  }
}

async function freezeFrame() {
  const ready = await waitForVideoReady(1500);
  const w = cam.videoWidth || 0;
  const h = cam.videoHeight || 0;

  if (!ready || !w || !h) {
    setStatus("カメラ映像の準備に時間がかかっています。もう一度📸を押すか、🖼から画像を選んでください。");
    return false;
  }

  drawImageToShot(cam, w, h);
  cam.style.display = "none";
  shot.style.display = "block";
  frozen = true;

  btnCapture.style.display = "none";
  btnRetake.style.display = "inline-block";
  enableActions(true);
  setStatus("撮影しました：🔎で解析");
  return true;
}

function unfreeze() {
  frozen = false;
  cam.style.display = "block";
  shot.style.display = "none";

  btnCapture.style.display = "inline-block";
  btnRetake.style.display = "none";

  enableActions(false);
  tagsEl.textContent = "まだ解析していません。";

  if (stream) {
    btnCapture.textContent = "📸 撮影 / Capture";
    setStatus("準備完了：📸で撮影 → 🔎でタグ解析 / または 🖼で画像選択");
  } else {
    btnCapture.textContent = "🎥 カメラ起動 / Start camera";
    setStatus("📸を押すとカメラが起動します（許可が必要です） / または 🖼で画像選択");
  }
}

btnCapture.onclick = async () => {
  // Many mobile browsers require a user gesture for getUserMedia.
  if (!stream) {
    setStatus("カメラ起動中…（許可が必要です）");
    const ok = await initCam();
    if (!ok) {
      try {
        file.value = "";
        file.click();
      } catch {}
      return;
    }
    // Start camera only (do not capture immediately).
    return;
  }
  await freezeFrame();
};

btnRetake.onclick = unfreeze;

// ---------- Image picker ----------
btnPick?.addEventListener("click", () => {
  try {
    file.value = "";
    file.click();
  } catch {}
});

file.addEventListener("change", async () => {
  const f = file.files?.[0];
  if (!f) return;

  // Stop live camera stream while analyzing a picked image (battery saver)
  try {
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
      cam.srcObject = null;
    }
  } catch {}

  const img = new Image();
  const url = URL.createObjectURL(f);
  img.onload = () => {
    try { URL.revokeObjectURL(url); } catch {}
    drawImageToShot(img, img.naturalWidth || img.width, img.naturalHeight || img.height);

    cam.style.display = "none";
    shot.style.display = "block";
    frozen = true;

    btnCapture.style.display = "none";
    btnRetake.style.display = "inline-block";
    enableActions(true);

    setStatus("画像を読み込みました：🔎で解析");
  };
  img.onerror = () => {
    try { URL.revokeObjectURL(url); } catch {}
    setStatus("画像を読み込めませんでした。別の画像を選んでください。");
  };
  img.src = url;
});

// ---------- Analyze ----------
btnAnalyze.onclick = async () => {
  const runId = ++lastRunId;

  try {
    if (!frozen) {
      setStatus("まず📸で撮影するか、🖼で画像を読み込んでください。");
      return;
    }

    const topk = Number(topkSel.value || 10);

    // Phase 1: Tagger
    const t0 = performance.now();
    setStatus("タグ解析中…（画像送信中）");
    tagsEl.textContent = "解析中…";

    const tagsEn = await postTags(topk);
    if (runId !== lastRunId) return;

    if (!tagsEn.length) {
      renderTags([]);
      setStatus("タグが空でした。");
      return;
    }

    // Show English immediately (perceived speed)
    const texts = tagsEn.map((t) => t.label);
    let items = tagsEn.map((t, i) => ({
      rank: i + 1,
      en: t.label,
      ja: "…",
      zh: "…",
      ko: "…",
      score: t.score,
    }));
    renderTags(items);

    // Phase 2: Translate (parallel) + local cache
    setStatus("翻訳中…（JA / ZH / KO）");

    let trJa = null;
    let trZh = null;
    let trKo = null;

    try {
      [trJa, trZh, trKo] = await Promise.all([
        translateWithCache(texts, "ja").catch(() => null),
        translateWithCache(texts, "zh").catch(() => null),
        translateWithCache(texts, "ko").catch(() => null),
      ]);
    } catch {
      // ignore; we handle null
    }

    if (runId !== lastRunId) return;

    let hadFallback = false;
    items = tagsEn.map((t, i) => {
      const ja = trJa && trJa[i] ? trJa[i] : null;
      const zh = trZh && trZh[i] ? trZh[i] : null;
      const ko = trKo && trKo[i] ? trKo[i] : null;
      if (!ja || !zh || !ko) hadFallback = true;
      return {
        rank: i + 1,
        en: t.label,
        ja: ja || "—",
        zh: zh || "—",
        ko: ko || "—",
        score: t.score,
      };
    });

    renderTags(items);

    const dt = Math.round(performance.now() - t0);
    if (hadFallback) {
      setStatus(`完了（${dt}ms）：一部翻訳できない語は「—」になります`);
    } else {
      setStatus(`完了（${dt}ms）：各言語をタップすると発音します`);
    }
  } catch (e) {
    console.error(e);
    setStatus("エラー：" + (e?.message || e));
    tagsEl.textContent = "エラーが発生しました。";
  }
};

// ---------- PWA service worker ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js", { scope: "./" })
    .then((reg) => {
      try { reg.update(); } catch {}
      console.log("[SW] registered:", reg.scope);
    })
    .catch((err) => {
      console.warn("[SW] register failed:", err);
    });
}

// ---------- lifecycle (battery / camera permissions) ----------
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    try {
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
        stream = null;
        cam.srcObject = null;
        btnCapture.textContent = "🎥 カメラ起動 / Start camera";
      }
    } catch {}
  }
});

// Initial
enableActions(false);
btnCapture.textContent = "🎥 カメラ起動 / Start camera";
setStatus("📸を押すとカメラが起動します（許可が必要です） / または 🖼で画像選択");
