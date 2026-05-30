# opencode-plugin-astgrep

OpenCodeプラグイン — ast-grepによるASTパターン検索・書き換え・スキャンをcustom toolとして提供します。

## ファイル構成

```
opencode-plugin-astgrep/
├── .github/workflows/release.yml    # タグpushで自動Release
├── package.json                      # npm公開用（main: src/index.ts）
├── tsconfig.json                     # 型チェック用
├── README.md
└── src/
    └── index.ts                       # プラグイン本体（default + server export）
```

## 導入手順

### 1. ast-grepのインストール

```bash
npm install -g @ast-grep/cli
# または cargo install ast-grep
# または brew install ast-grep
```

`ast-grep --version` が通ればOK。

### 2. opencode.jsonに追記

`~/.config/opencode/opencode.json` の `plugin` 配列に以下を追加:

```json
{
  "plugin": [
    "opencode-plugin-astgrep@git+https://github.com/tnmt-1/opencode-plugin-astgrep.git"
  ]
}
```

OpenCode起動時に自動でインストール・ロードされます。

## 提供するcustom tool

### `ast_grep_search`

ASTパターンでコード検索。

| 引数 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `pattern` | `string` | yes | ASTパターン（例: `console.log($MSG)`） |
| `lang` | `string` | no | 言語フィルター（ts, py, rs, go...） |
| `path` | `string` | no | 検索対象パス |
| `maxResults` | `number` | no | 返却件数の上限（default: 50, max: 200。CLIではなくプラグイン側で適用） |

### `ast_grep_rewrite`

ASTパターン書き換え。**デフォルトdry-run**。`apply: true` で実変更。

| 引数 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `pattern` | `string` | yes | 検索パターン |
| `rewrite` | `string` | yes | 置換パターン（`$1`, `$2` でキャプチャ参照） |
| `lang` | `string` | no | 言語フィルター |
| `path` | `string` | no | 対象パス |
| `apply` | `boolean` | no | `true` で実変更（default: false） |

### `ast_grep_scan`

ルールベースのコードスキャン。`sgconfig.yml` が必要。

| 引数 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `path` | `string` | no | スキャン対象 |
| `configPath` | `string` | no | sgconfig.ymlのパス |
| `rule` | `string` | no | 特定ルールIDのみ実行 |

## 使い方の例

```typescript
// console.logを検索
ast_grep_search({ pattern: "console.log($MSG)", lang: "ts" })

// logger.infoに書き換え（dry-run）
ast_grep_rewrite({ pattern: "console.log($MSG)", rewrite: "logger.info($MSG)" })

// 実際に書き換え実行
ast_grep_rewrite({ pattern: "console.log($MSG)", rewrite: "logger.info($MSG)", apply: true })

// 関数定義を検索
ast_grep_search({ pattern: "function $NAME($$$) { $$$ }", lang: "ts", path: "src/" })

// ルールスキャン
ast_grep_scan({ path: "src/" })
```

## 設計上の注意点

- **インジェクション対策**: Bun Shell API（`$`）のテンプレートリテラルによる自動エスケープ
- **`sg`非使用**: Linuxで`sg`はshadow-utilsと衝突するため常に`ast-grep`コマンドを使用
- **dry-run安全**: 書き換えはデフォルトdry-run、`apply: true` で `ast-grep run -U` により実変更
- **ast-grep 0.4x対応**: `run` / `scan` サブコマンドを使用（`--max-results` 等の非推奨フラグは不使用）
- **コンテキスト維持**: `experimental.session.compacting` フックで直近5件の検索/書き換え結果をsession compaction時に注入
- **エラー時**: 原因・実行コマンド・対処法をJSONで返却
- **Zodスキーマ**: 全引数をZodでバリデーション

## 今後の拡張案

1. **unified diff表示**: dry-run結果にdiffを追加し変更内容を可視化
2. **インタラクティブモード**: `ast-grep run -i` + `ask()` permission APIで1件ずつ確認しながら書き換え
3. **ルールテンプレート**: よく使うスキャンルールセットをプリセット内蔵
