import io, json, os, time, hashlib
from typing import List, Optional, Dict, Any

import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Query, Body
from fastapi.middleware.cors import CORSMiddleware

import requests
import torch
import open_clip

LABELS_PATH = os.getenv("LABELS_PATH", "data/openimages_v7_labels.json")

# Choose a CLIP model that is widely available and fairly light.
# You can change via env:
#   CLIP_MODEL=ViT-B-32
#   CLIP_PRETRAINED=laion2b_s34b_b79k
MODEL_NAME = os.getenv("CLIP_MODEL", "ViT-B-32")
PRETRAINED = os.getenv("CLIP_PRETRAINED", "laion2b_s34b_b79k")

# Prompt template: quality lever (can tweak later)
PROMPT_TEMPLATE = os.getenv("PROMPT_TEMPLATE", "a photo of {}")

# CORS
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

# Cache file for text embeddings (speeds up restarts)
TEXT_EMB_CACHE = os.getenv("TEXT_EMB_CACHE", "data/text_emb_cache.pt")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

app = FastAPI(title="Photo Translator Server", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()] or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None
_preprocess = None
_tokenizer = None
_labels: Optional[List[Dict[str, str]]] = None
_text_emb = None   # [N,D] normalized


def _load_labels() -> List[Dict[str, str]]:
    with open(LABELS_PATH, "r", encoding="utf-8") as f:
        labels = json.load(f)
    # minimal validation
    out = []
    for x in labels:
        mid = x.get("mid")
        name = x.get("label_en")
        if mid and name:
            out.append({"mid": mid, "label_en": name})
    return out


@torch.inference_mode()
def _build_text_embeddings(labels: List[Dict[str, str]]):
    global _model, _tokenizer
    prompts = [PROMPT_TEMPLATE.format(x["label_en"]) for x in labels]
    # Tokenize in batches to keep memory stable
    batch = 256
    vecs = []
    for i in range(0, len(prompts), batch):
        toks = _tokenizer(prompts[i:i+batch]).to(DEVICE)
        te = _model.encode_text(toks)
        te = te / te.norm(dim=-1, keepdim=True)
        vecs.append(te)
    te_all = torch.cat(vecs, dim=0)
    # store in fp16 on GPU to save memory
    if DEVICE == "cuda":
        te_all = te_all.half()
    else:
        te_all = te_all.float()
    return te_all


def _cache_key() -> str:
    # Tie cache to model + prompt + vocab file hash
    h = hashlib.sha256()
    h.update((MODEL_NAME + "|" + PRETRAINED + "|" + PROMPT_TEMPLATE).encode("utf-8"))
    try:
        with open(LABELS_PATH, "rb") as f:
            h.update(f.read(1024 * 1024))  # first 1MB is enough
    except Exception:
        pass
    return h.hexdigest()[:16]


def _load_or_build_text_emb():
    global _labels, _text_emb
    _labels = _load_labels()

    ck = _cache_key()
    if os.path.exists(TEXT_EMB_CACHE):
        try:
            obj = torch.load(TEXT_EMB_CACHE, map_location=DEVICE)
            if isinstance(obj, dict) and obj.get("cache_key") == ck and "text_emb" in obj:
                _text_emb = obj["text_emb"].to(DEVICE)
                # ensure normalized
                _text_emb = _text_emb / _text_emb.norm(dim=-1, keepdim=True)
                return "cache"
        except Exception:
            pass

    t0 = time.time()
    _text_emb = _build_text_embeddings(_labels)
    dt = time.time() - t0
    try:
        torch.save({"cache_key": ck, "text_emb": _text_emb.detach().cpu()}, TEXT_EMB_CACHE)
    except Exception:
        pass
    return f"built ({dt:.1f}s)"


@torch.inference_mode()
def _encode_image(pil_img: Image.Image):
    img = pil_img.convert("RGB")
    x = _preprocess(img).unsqueeze(0).to(DEVICE)
    ie = _model.encode_image(x)
    ie = ie / ie.norm(dim=-1, keepdim=True)
    if DEVICE == "cuda":
        ie = ie.half()
    else:
        ie = ie.float()
    return ie


@app.on_event("startup")
def startup():
    global _model, _preprocess, _tokenizer
    _model, _, _preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
    _tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    _model = _model.to(DEVICE)
    _model.eval()
    mode = _load_or_build_text_emb()
    print(f"[startup] device={DEVICE} labels={len(_labels or [])} text_emb={mode}")


@app.get("/health")
def health():
    return {
        "ok": True,
        "device": DEVICE,
        "classes": len(_labels) if _labels else 0,
        "model": f"open_clip:{MODEL_NAME}/{PRETRAINED}",
        "prompt_template": PROMPT_TEMPLATE,
        "vocab": "openimages-v7-class-descriptions",
        "text_emb_cache": TEXT_EMB_CACHE,
    }


@app.post("/tagger")
async def tagger(
    image: UploadFile = File(...),
    topk: int = Query(30, ge=1, le=200),
):
    blob = await image.read()
    pil = Image.open(io.BytesIO(blob))

    ie = _encode_image(pil)                     # [1,D]
    scores = (ie @ _text_emb.T).squeeze(0)      # [N]

    vals, idx = torch.topk(scores, k=topk)

    # Softmax over Top-K for a user-friendly "percent"
    probs = torch.softmax(vals.float(), dim=0).cpu().numpy()
    idx_np = idx.cpu().numpy()

    tags = []
    for rank, (i, p) in enumerate(zip(idx_np, probs), start=1):
        cls = _labels[int(i)]
        tags.append({
            "mid": cls["mid"],
            "label_en": cls["label_en"],
            "score": float(p),
            "rank": rank
        })

    return {
        "vocab": "openimages-v7-20638-ish",
        "model": f"open_clip:{MODEL_NAME}/{PRETRAINED}",
        "topk": topk,
        "tags": tags
    }


# -------- Translation (optional) --------
# You can use one of:
# 1) LibreTranslate (self-host or hosted): set LIBRETRANSLATE_URL, optional LIBRETRANSLATE_API_KEY
# 2) DeepL: set DEEPL_AUTH_KEY
#
# Request from PWA:
# POST /translate  JSON: { "target": "ja", "texts": ["Cat", "Dog"] }
# Response:
# { "textsTranslated": ["猫", "犬"] }

LIBRETRANSLATE_URL = os.getenv("LIBRETRANSLATE_URL", "")
LIBRETRANSLATE_API_KEY = os.getenv("LIBRETRANSLATE_API_KEY", "")

DEEPL_AUTH_KEY = os.getenv("DEEPL_AUTH_KEY", "")
DEEPL_API_URL = os.getenv("DEEPL_API_URL", "https://api-free.deepl.com/v2/translate")  # or api.deepl.com

def _map_target(lang: str) -> str:
    # normalize
    lang = (lang or "").lower()
    if lang in ("ja", "ja-jp"):
        return "JA"
    if lang in ("en", "en-us", "en-gb"):
        return "EN"
    if lang in ("zh", "zh-cn", "zh-hans"):
        return "ZH"
    if lang in ("ko", "ko-kr"):
        return "KO"
    return lang.upper()

def _translate_deepl(texts: List[str], target: str) -> List[str]:
    tgt = _map_target(target)
    data = [("text", t) for t in texts]
    data.append(("target_lang", tgt))
    headers = {"Authorization": f"DeepL-Auth-Key {DEEPL_AUTH_KEY}"}
    r = requests.post(DEEPL_API_URL, data=data, headers=headers, timeout=30)
    r.raise_for_status()
    j = r.json()
    out = []
    for x in j.get("translations", []):
        out.append(x.get("text", ""))
    return out

def _translate_libre(texts: List[str], target: str) -> List[str]:
    # LibreTranslate uses lowercase codes: en, ja, zh, ko
    tgt = (target or "en").lower()
    payload = {
        "q": texts,
        "source": "en",
        "target": tgt,
        "format": "text",
    }
    if LIBRETRANSLATE_API_KEY:
        payload["api_key"] = LIBRETRANSLATE_API_KEY
    r = requests.post(LIBRETRANSLATE_URL.rstrip("/") + "/translate", json=payload, timeout=60)
    r.raise_for_status()
    j = r.json()
    # hosted instances may return list or dict
    if isinstance(j, list):
        return [x.get("translatedText", "") for x in j]
    if isinstance(j, dict) and "translatedText" in j:
        # single
        return [j.get("translatedText", "")]
    if isinstance(j, dict) and "translatedText" not in j and "translations" in j:
        return [x.get("translatedText", "") for x in j["translations"]]
    # fallback
    return [""] * len(texts)

@app.post("/translate")
def translate(payload: Dict[str, Any] = Body(...)):
    target = payload.get("target", "en")
    texts = payload.get("texts", [])
    if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
        return {"textsTranslated": []}

    # if target is en, return as-is
    if (target or "").lower().startswith("en"):
        return {"textsTranslated": texts}

    if DEEPL_AUTH_KEY:
        try:
            tr = _translate_deepl(texts, target)
            return {"textsTranslated": tr}
        except Exception as e:
            return {"error": "deepl_failed", "detail": str(e), "textsTranslated": []}

    if LIBRETRANSLATE_URL:
        try:
            tr = _translate_libre(texts, target)
            return {"textsTranslated": tr}
        except Exception as e:
            return {"error": "libretranslate_failed", "detail": str(e), "textsTranslated": []}

    return {
        "error": "no_translation_provider_configured",
        "detail": "Set DEEPL_AUTH_KEY or LIBRETRANSLATE_URL (and optional LIBRETRANSLATE_API_KEY).",
        "textsTranslated": []
    }
