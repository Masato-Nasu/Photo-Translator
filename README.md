# Photo-Translator Server (Open Images ~20k vocab Top-K)

This server provides:
- `POST /tagger?topk=30` : Image -> Top-K tags (English labels) using CLIP ranking over Open Images class descriptions.
- `POST /translate` (optional) : Translate English labels to `ja/zh/ko` for the PWA.

## Endpoints

### Health
`GET /health`

### Tagger
`POST /tagger?topk=30`

- Body: `multipart/form-data` with field `image` (jpeg/png/webp)
- Response:
```json
{
  "topk": 30,
  "tags": [{"mid":"/m/..","label_en":"Cat","score":0.73,"rank":1}]
}
```

### Translate (optional)
`POST /translate`

- JSON:
```json
{ "target":"ja", "texts":["Cat","Dog"] }
```
- Response:
```json
{ "textsTranslated":["猫","犬"] }
```

Configure a provider:
- DeepL: set `DEEPL_AUTH_KEY`
- LibreTranslate: set `LIBRETRANSLATE_URL` (and optional `LIBRETRANSLATE_API_KEY`)

## Run (local)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python build_vocab.py
uvicorn app:app --host 0.0.0.0 --port 8080
```

Test:
```bash
curl -X POST "http://localhost:8080/tagger?topk=30" -F "image=@test.jpg"
```

## Docker

```bash
docker build -t photo-translator-server .
docker run --rm -p 8080:8080 photo-translator-server
```

### GPU (recommended)
Run on a GPU machine and ensure your runtime passes the GPU through (e.g., NVIDIA Container Toolkit).
This app auto-detects CUDA.

## Environment variables

- `CLIP_MODEL` (default: ViT-B-32)
- `CLIP_PRETRAINED` (default: laion2b_s34b_b79k)
- `PROMPT_TEMPLATE` (default: `a photo of {}`)
- `ALLOWED_ORIGINS` (default: `*`) comma-separated
- `DEEPL_AUTH_KEY` / `DEEPL_API_URL`
- `LIBRETRANSLATE_URL` / `LIBRETRANSLATE_API_KEY`
