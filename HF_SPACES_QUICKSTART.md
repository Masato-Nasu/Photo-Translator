# Hugging Face Spaces (Docker) quickstart

1. Create a new Space and choose **Docker**.
2. Upload all files in this folder (`app.py`, `Dockerfile`, `requirements.txt`, etc.).
3. Keep the YAML block at the top of README.md (it tells Spaces this is a Docker Space).
4. After build finishes, test:
   - `/health`
   - `/docs`

Notes:
- This build downloads an OpenCLIP model (~600MB) and builds text embeddings for ~20k labels on first startup, so first boot can take several minutes.
- Translation uses MyMemory (free). Anonymous limit is 5000 chars/day; with email (`de` param) it becomes 50000 chars/day.
  Set Space secret `MYMEMORY_EMAIL` if you want that increase.
