# Photo Tagger PWA (Top-K + Primary-only Pronunciation)

スマホで **撮影した1枚**（または画像ファイル）を解析し、タグTop-Kを表示し、**Primary言語だけ**で発音（TTS）します。

## できること
- 📸 撮影 → 🔎 タグ解析（画像全体のTop-Kタグ）
- 🖼 画像読み込み → 🔎 タグ解析
- タグをタップ（または🔊）で **Primary言語で発音**
- 🔊 上位を連続発音（最大10個）

## 必要なもの（サーバ）
このPWAはタグ生成をサーバに依存します。

### タグ生成
- `POST {TAGGER_ENDPOINT}/tagger?topk=30`
- `multipart/form-data` で `image` を受け取り
- JSONで `{"tags":[{"label_en":"Cat","score":0.73}, ...]}` を返す

（例：Open Images 20,638語彙をCLIPでランキングしてTop-Kを返すサーバ）

### （任意）翻訳
- `POST {TRANSLATE_ENDPOINT}`
- JSON `{"target":"ja","texts":["Cat","Dog"]}`
- JSON `{"textsTranslated":["猫","犬"]}` を返す

## 設定
`app.js` の以下を埋めてください：

```js
const TAGGER_ENDPOINT = "https://YOUR_DOMAIN";
const TRANSLATE_ENDPOINT = "https://YOUR_DOMAIN/translate"; // optional
```

## GitHub Pages
1. このフォルダをリポジトリに置く
2. Settings → Pages → Branch を設定
3. `https://{user}.github.io/{repo}/` でアクセス

## メモ
- iPhone Safariは、ユーザー操作（タップ）をきっかけにしないと発音が動かないことがあるため、タグのタップで発音するUIにしています。
- 発音品質は端末のTTS音声に依存します（必要なら端末側の音声設定を調整してください）。
