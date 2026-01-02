import csv, json, os, requests

OIDV7_CLASSES_URL = os.getenv(
    "OIDV7_CLASSES_URL",
    "https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions.csv"
)

def main():
    os.makedirs("data", exist_ok=True)
    csv_path = "data/oidv7-class-descriptions.csv"
    json_path = "data/openimages_v7_labels.json"

    if not os.path.exists(csv_path):
        print("Downloading:", OIDV7_CLASSES_URL)
        r = requests.get(OIDV7_CLASSES_URL, timeout=120)
        r.raise_for_status()
        with open(csv_path, "wb") as f:
            f.write(r.content)

    labels = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 2:
                continue
            mid, name = row[0].strip(), row[1].strip()
            if mid and name:
                labels.append({"mid": mid, "label_en": name})

    # Deduplicate by MID just in case
    seen = set()
    uniq = []
    for x in labels:
        if x["mid"] in seen: 
            continue
        seen.add(x["mid"])
        uniq.append(x)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(uniq, f, ensure_ascii=False)

    print(f"Saved {json_path} ({len(uniq)} classes)")

if __name__ == "__main__":
    main()
