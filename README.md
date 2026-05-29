# opencode-plugin-astgrep

OpenCodeローカルプラグイン — ast-grepのAST検索・書き換え・スキャンをOpenCodeのcustom toolとして使えるようにします。

## ファイル構成

```
opencode-plugin-astgrep/
├── package.json          # 依存管理
├── tsconfig.json         # TypeScript設定
├── README.md             # このファイル
└── src/
    └── index.ts          # プラグイン本体（export default）
```

## 導入手順

### 1. ast-grepのインストール

```bash
# npm
npm install -g @ast-grep/cli

# または Cargo
cargo install ast-grep

# または Homebrew
brew install ast-grep
```

確認: `ast-grep --version` が表示されればOK。

### 2. プラグインファイルの配置

このリポジトリからシンボリックリンクまたはコピーで配置します。

```bash
# プロジェクトのローカルプラグインとして使う場合
mkdir -p /path/to/your/project/.opencode/plugins
ln -s /path/to/opencode-plugin-astgrep/src/index.ts /path/to/your/project/.opencode/plugins/ast-grep.ts

# またはグローバルプラグインとして使う場合
mkdir -p ~/.config/opencode/plugins
ln -s /path/to/opencode-plugin-astgrep/src/index.ts ~/.config/opencode/plugins/ast-grep.ts
```

### 3. 依存パッケージの追加

プロジェクトの `.opencode/package.json` に以下を追加します（なければ作成）。

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1",
    "zod": "^4"
  }
}
```

OpenCodeは起動時に自動で `bun install` を実行します。

### 4. OpenCode設定例

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    // npmパッケージとしても読み込めます
    // "opencode-plugin-astgrep"
  ]
}
```

## 提供する3つのcustom tool

### `ast_grep_search`

ASTパターンでコード検索します。

| 引数 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `pattern` | `string` | yes | AST検索パターン（例: `console.log($MSG)`） |
| `lang` | `string` | no | 言語フィルター（ts, py, rs, go, java...） |
| `path` | `string` | no | 検索対象のディレクトリ/ファイル |
| `maxResults` | `number` | no | 最大結果数（default: 50, max: 200） |

戻り値（JSON）:
```json
{
  "success": true,
  "totalMatches": 42,
  "displayed": 50,
  "results": [
    {
      "file": "src/index.ts",
      "line": 15,
      "column": 2,
      "endLine": 15,
      "snippet": "console.log(result)"
    }
  ],
  "summary": "Found 42 matches for \"console.log($MSG)\""
}
```

### `ast_grep_rewrite`

ASTパターンでコード書き換え（デフォルト: dry-run）。

| 引数 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `pattern` | `string` | yes | 検索パターン |
| `rewrite` | `string` | yes | 置換パターン（$1, $2でキャプチャ参照） |
| `lang` | `string` | no | 言語フィルター |
| `path` | `string` | no | 対象ディレクトリ/ファイル |
| `apply` | `boolean` | no | `true`で実変更（default: false = dry-run） |

### `ast_grep_scan`

ルールベースのコードスキャン（`sgconfig.yml`必須）。

| 引数 | 型 | 必須 | 説明 |
|------|-----|------|------|
| `path` | `string` | no | スキャン対象 |
| `configPath` | `string` | no | sgconfig.ymlのパス |
| `rule` | `string` | no | 特定のルールIDのみ実行 |

## 使い方の具体例

```typescript
// 1. console.logを検索
ast_grep_search({
  pattern: "console.log($MSG)",
  lang: "ts",
  maxResults: 20
})

// 2. console.logをlogger.infoに書き換え（dry-run）
ast_grep_rewrite({
  pattern: "console.log($MSG)",
  rewrite: "logger.info($MSG)",
  lang: "ts"
})

// 3. 実際に書き換え
ast_grep_rewrite({
  pattern: "console.log($MSG)",
  rewrite: "logger.info($MSG)",
  lang: "ts",
  apply: true
})

// 4. 関数定義を検索
ast_grep_search({
  pattern: "function $NAME($$$) { $$$ }",
  lang: "ts",
  path: "src/"
})

// 5. ルールスキャン
ast_grep_scan({ path: "src/" })
```

## 設計上の注意点

- **インジェクション対策**: コマンド実行はBun Shell API（`$`）のテンプレートリテラルを使用し、変数は自動エスケープされます。
- **dry-run安全**: `ast_grep_rewrite`はデフォルトでdry-run（`apply: false`）です。実変更するには明示的に`apply: true`が必要です。
- **`sg`非使用**: Linuxで`sg`はshadow-utilsなどと衝突するため、コマンド名は常に`ast-grep`を使用します。
- **コンテキスト維持**: `experimental.session.compacting`フックにより、OpenCodeのsession compaction時に直近の検索・書き換え結果を要約として残します。
- **エラーメッセージ**: エラー時は原因・実行コマンド・対処法を返します。
- **Zodスキーマ**: 全てのtool引数はZodでバリデーションされます。

## 今後の拡張案

1. **ファイル単位のdiff表示**: `ast_grep_rewrite`のdry-run結果にunified diffを追加し、変更内容をより直感的に把握できるようにする
2. **インタラクティブモード**: `ast-grep -U`（interactive mode）をサポートし、`ask()` permission APIを使って1件ごとに確認しながら書き換えられるようにする
3. **ルールテンプレート管理**: `ast_grep_scan`でよく使うルールセット（ESLint移行、ログ統一など）をプリセットとして内蔵し、`rule`指定で即実行できるようにする
