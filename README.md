# z-index-world

任意のWebページを「3D空間のステージ」として解釈し、プレイヤーを動かすChrome拡張。

DOM要素のz-indexを奥行き（高さ）として読み取り、3Dプラットフォーマーゲームのステージに変換します。
既存DOMは一切変更せず、追加のオーバーレイDOMだけでゲームを実現します。

## 必要環境

- Node.js (tsc実行用)
- TypeScript (`npm install -g typescript` または `npx tsc`)
- Chrome ブラウザ

## ビルド手順

```bash
# リポジトリに移動
cd z-index-world

# 依存関係をインストール
npm install

# ビルド（TypeScriptコンパイル + manifest.jsonコピー）
npm run build
```

または手動で:

```bash
npx tsc && cp manifest.json dist/
```

## テスト実行

```bash
# Playwrightテストを実行
npm run test
```

## Chromeへの読み込み手順

1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `dist` ディレクトリを選択
5. 拡張機能がインストールされる

## 使い方

### ON/OFF切り替え

1. ツールバーの拡張機能アイコンをクリック
2. ONになるとバッジに「ON」と表示される
3. もう一度クリックするとOFFになる

### 操作方法（Vim風キーバインド）

| キー | 動作 |
|------|------|
| `h` | 左に移動 |
| `l` | 右に移動 |
| `k` | 上に移動 |
| `j` | 下に移動 |
| `Space` | ジャンプ（z方向、手前に跳ぶ） |

**注意**: input/textarea/contenteditable要素にフォーカスがあるときは操作が無効化されます。

### ゲームの見方

- **赤い四角**: プレイヤー
- **緑のS**: スタート地点
- **青のG**: ゴール地点
- **半透明の青い四角**: DOM要素から生成されたコライダ（壁）

### Chrome DevTools Layersパネルでの確認

1. F12でDevToolsを開く
2. 右上の「...」→「More tools」→「Layers」を選択
3. 3D表示でプレイヤーやコライダが奥行き方向に配置されているのが確認できる

## 技術仕様

### 座標系

- **x**: 画面左→右 (px)
- **y**: 画面上→下 (px)
- **z**: 奥→手前 (+)、重力は手前→奥（-方向）

### z-indexのマッピング

- ページ内のDOM要素からz-indexを収集
- 0〜800pxの範囲に正規化
- z-indexが偏っているページは平面（全てz=0）として扱う

### パフォーマンス最適化

- Uniform Gridによる空間インデックス
- ビューポート+200px内のコライダのみ判定
- 500msごとのコライダ位置更新

## ファイル構成

```
z-index-world/
├── src/
│   ├── background.ts      # Service Worker
│   └── content-script.ts  # メインゲームロジック
├── dist/                  # ビルド出力
│   ├── background.js
│   ├── content-script.js
│   └── manifest.json
├── manifest.json
├── tsconfig.json
└── README.md
```

## トラブルシューティング

### 拡張機能が動作しない

- `chrome://extensions`でエラーがないか確認
- DevToolsのConsoleでエラーを確認
- ページをリロードして再度アイコンをクリック

### プレイヤーが見えない

- ページのz-indexが極端に高い場合、プレイヤーが隠れることがある
- DevTools Layersパネルで位置を確認

### 操作が効かない

- input/textareaにフォーカスがないか確認
- 他の拡張機能との競合を確認

## ライセンス

MIT
