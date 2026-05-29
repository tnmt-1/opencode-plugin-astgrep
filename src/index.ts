import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"

interface Finding {
  tool: "search" | "rewrite" | "rewrite(dry)"
  pattern: string
  matchCount: number
  summary: string
  timestamp: number
}

const recentFindings: Finding[] = []
const MAX_FINDINGS = 5

function addFinding(f: Finding) {
  recentFindings.unshift(f)
  if (recentFindings.length > MAX_FINDINGS) recentFindings.pop()
}

async function requireAstGrep($: PluginInput["$"]): Promise<string | null> {
  const r = await $`which ast-grep`.nothrow()
  if (r.exitCode !== 0) {
    return [
      "ast-grep is required but not found in PATH.",
      "Install: npm install -g @ast-grep/cli",
      "  or:    cargo install ast-grep",
      "  or:    brew install ast-grep",
      "  or:    scoop install ast-grep",
    ].join("\n")
  }
  return null
}

function fmtCmd(args: string[]): string {
  return `ast-grep ${args.map(a => a.includes(" ") ? `'${a}'` : a).join(" ")}`
}

function parseMatches(stdout: string): { parsed: any[]; raw: string } | null {
  const trimmed = stdout.trim()
  if (!trimmed) return { parsed: [], raw: trimmed }
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? { parsed, raw: trimmed } : { parsed: [parsed], raw: trimmed }
  } catch {
    return null
  }
}

function normalizeMatch(m: any) {
  return {
    file: m.file ?? m.path ?? "unknown",
    line: m.line ?? m.range?.start?.line ?? m.position?.line ?? 0,
    column: m.column ?? m.range?.start?.column ?? m.position?.column ?? 0,
    endLine: m.range?.end?.line ?? m.position?.end?.line,
    snippet: m.text ?? m.content ?? m.lines ?? "",
  }
}

const plugin = async (ctx: PluginInput) => {
  const { $ } = ctx

  const errorInstalled = await requireAstGrep($)
  if (errorInstalled) {
    return {}
  }

  return {
    "experimental.session.compacting": async (_input: unknown, output: { context: string[] }) => {
      if (recentFindings.length === 0) return
      const lines = recentFindings.map(
        (f, i) => `${i + 1}. [ast-grep:${f.tool}] "${f.pattern}" → ${f.matchCount >= 0 ? `${f.matchCount} match(es)` : "applied"}`
      )
      output.context.push(`## Recent ast-grep Findings\n${lines.join("\n")}`)
    },

    tool: {
      ast_grep_search: tool({
        description: [
          "Search code using AST-aware pattern matching via ast-grep.",
          "Supports complex AST patterns with meta-variables ($VAR for single node, $$$ for multiple nodes).",
          "Example: 'console.log($MSG)' finds all console.log calls.",
          "Example: 'function $NAME($$$) { $$$ }' finds all function declarations.",
        ].join(" "),
        args: {
          pattern: tool.schema
            .string()
            .describe("AST pattern to search for. Use $VAR for single nodes, $$$ for multi-node sequences."),
          lang: tool.schema
            .string()
            .optional()
            .describe(
              "Language filter: ts, tsx, js, jsx, py, rs, go, java, rb, c, cpp, cs, php, swift, kt, scala, elixir, haskell, lua, yaml, json, css, html, bash"
            ),
          path: tool.schema
            .string()
            .optional()
            .describe("Directory or file path to search (defaults to session directory)"),
          maxResults: tool.schema
            .number()
            .optional()
            .describe("Maximum number of results to return (default: 50, max: 200)"),
        },
        async execute(args, context) {
          const err = await requireAstGrep($)
          if (err) return JSON.stringify({ success: false, error: err })

          const maxResults = Math.min(args.maxResults ?? 50, 200)
          const target = args.path || context.directory

          const cmdArgs = ["-p", args.pattern, "--json", "--color", "never", "--max-results", String(maxResults)]
          if (args.lang) cmdArgs.push("-l", args.lang)
          cmdArgs.push(target)

          const r = await $`ast-grep ${cmdArgs}`.nothrow()

          if (r.exitCode !== 0) {
            const stderr = r.stderr.toString().trim()
            if (stderr.includes("parse error") || stderr.includes("pattern")) {
              return JSON.stringify({
                success: false,
                error: "Invalid AST pattern syntax.",
                command: fmtCmd(cmdArgs),
                details: stderr,
                hint: "Check pattern syntax: use $VAR for variables, $$$ for multi-node. See https://ast-grep.net/guide/pattern-syntax",
              })
            }
            return JSON.stringify({
              success: false,
              error: stderr || "Unknown error",
              command: fmtCmd(cmdArgs),
              exitCode: r.exitCode,
            })
          }

          const out = r.stdout.toString()
          const parsed = parseMatches(out)

          if (!parsed || parsed.parsed.length === 0) {
            return JSON.stringify({
              success: true,
              totalMatches: 0,
              displayed: 0,
              results: [],
              summary: `No matches found for pattern: ${args.pattern}`,
            })
          }

          const total = parsed.parsed.length
          const items = parsed.parsed.slice(0, maxResults).map(normalizeMatch)

          const langTag = args.lang ? ` [${args.lang}]` : ""
          const summary = `Found ${total} match${total !== 1 ? "es" : ""} for "${args.pattern}"${langTag} (showing ${items.length})`

          addFinding({ tool: "search", pattern: args.pattern, matchCount: total, summary, timestamp: Date.now() })

          return JSON.stringify({
            success: true,
            tool: "ast_grep_search",
            totalMatches: total,
            displayed: items.length,
            results: items,
            summary,
          })
        },
      }),

      ast_grep_rewrite: tool({
        description: [
          "Rewrite code using AST-aware pattern replacement via ast-grep.",
          "DRY-RUN by default (use apply: true to actually modify files).",
          "Use $1, $2 etc. in rewrite to reference captured groups from the pattern.",
          "Example pattern: 'console.log($MSG)' rewrite: 'logger.info($MSG)'",
        ].join(" "),
        args: {
          pattern: tool.schema.string().describe("AST pattern to match for replacement"),
          rewrite: tool.schema.string().describe("Replacement AST pattern. Use $1, $2 for captured groups from the search pattern."),
          lang: tool.schema.string().optional().describe("Language filter to narrow scope"),
          path: tool.schema.string().optional().describe("Directory or file to apply rewrite"),
          apply: tool.schema.boolean().optional().describe("Set to true to actually apply changes (default: false = dry-run)"),
        },
        async execute(args, context) {
          const err = await requireAstGrep($)
          if (err) return JSON.stringify({ success: false, error: err })

          const target = args.path || context.directory
          const isApply = args.apply === true

          const cmdArgs = ["-p", args.pattern, "-r", args.rewrite, "--color", "never"]
          if (args.lang) cmdArgs.push("-l", args.lang)
          cmdArgs.push(target)

          if (isApply) {
            cmdArgs.push("-i", "--no-backup")
          } else {
            cmdArgs.push("--json")
          }

          const r = await $`ast-grep ${cmdArgs}`.nothrow()

          if (r.exitCode !== 0) {
            const stderr = r.stderr.toString().trim()
            if (stderr.includes("no match") || stderr.includes("no file")) {
              return JSON.stringify({
                success: true,
                dryRun: !isApply,
                totalMatches: 0,
                summary: "No matches found; nothing to rewrite.",
              })
            }
            if (stderr.includes("parse error")) {
              return JSON.stringify({
                success: false,
                error: "Pattern or rewrite syntax error.",
                command: fmtCmd(cmdArgs),
                details: stderr,
                hint: "Check $VAR references in rewrite match your pattern captures.",
              })
            }
            return JSON.stringify({
              success: false,
              error: stderr || "Rewrite command failed",
              command: fmtCmd(cmdArgs),
              exitCode: r.exitCode,
            })
          }

          if (isApply) {
            const summary = `Applied rewrite: "${args.pattern}" -> "${args.rewrite}"`
            addFinding({ tool: "rewrite", pattern: args.pattern, matchCount: -1, summary, timestamp: Date.now() })
            return JSON.stringify({
              success: true,
              tool: "ast_grep_rewrite",
              applied: true,
              summary,
              output: r.stdout.toString().trim() || "(rewrite completed silently)",
            })
          }

          const out = r.stdout.toString()
          const parsed = parseMatches(out)

          if (!parsed || parsed.parsed.length === 0) {
            return JSON.stringify({
              success: true,
              dryRun: true,
              totalMatches: 0,
              summary: "No matches found for rewrite.",
            })
          }

          const changes = parsed.parsed.map(normalizeMatch)

          const dryMsg = `[DRY-RUN] Would rewrite ${parsed.parsed.length} match${parsed.parsed.length !== 1 ? "es" : ""}: "${args.pattern}" -> "${args.rewrite}"`
          addFinding({ tool: "rewrite(dry)", pattern: args.pattern, matchCount: parsed.parsed.length, summary: dryMsg, timestamp: Date.now() })

          return JSON.stringify({
            success: true,
            tool: "ast_grep_rewrite",
            dryRun: true,
            totalMatches: parsed.parsed.length,
            changes,
            summary: dryMsg,
            hint: 'Pass "apply": true to apply these changes',
          })
        },
      }),

      ast_grep_scan: tool({
        description: [
          "Run ast-grep rule-based code scan/analysis.",
          "Requires sgconfig.yml in the project or an explicit configPath.",
          "Use this for lint-style checks against predefined rules.",
        ].join(" "),
        args: {
          path: tool.schema.string().optional().describe("Directory or file to scan"),
          configPath: tool.schema.string().optional().describe("Explicit path to sgconfig.yml"),
          rule: tool.schema.string().optional().describe("Run only a specific rule ID"),
        },
        async execute(args, context) {
          const err = await requireAstGrep($)
          if (err) return JSON.stringify({ success: false, error: err })

          const target = args.path || context.directory

          const cmdArgs = ["scan", "--json", "--color", "never"]
          if (args.configPath) cmdArgs.push("-c", args.configPath)
          if (args.rule) cmdArgs.push("--rule", args.rule)
          cmdArgs.push(target)

          const r = await $`ast-grep ${cmdArgs}`.nothrow()

          if (r.exitCode !== 0) {
            const stderr = r.stderr.toString().trim()
            if (stderr.includes("sgconfig") || stderr.includes("config") || stderr.includes("no such file") || stderr.includes("not found")) {
              return JSON.stringify({
                success: false,
                error: "sgconfig.yml not found.",
                hint: [
                  "ast-grep scan requires a rule configuration file (sgconfig.yml).",
                  "Create sgconfig.yml in the project root, or specify configPath.",
                  "See: https://ast-grep.net/guide/scan-config",
                  "",
                  "Example minimal sgconfig.yml:",
                  "  ruleDirs:",
                  "    - ./rules",
                  "  testConfigs:",
                  "    - testDir: ./rules-test",
                ].join("\n"),
                details: stderr,
              })
            }
            return JSON.stringify({
              success: false,
              error: stderr || "Scan failed",
              command: fmtCmd(cmdArgs),
              exitCode: r.exitCode,
            })
          }

          const out = r.stdout.toString().trim()
          let parsed: any = null
          try {
            parsed = JSON.parse(out)
          } catch {
            // not JSON; return as raw text
          }

          const summary = `Scan completed for ${target}` + (args.rule ? ` (rule: ${args.rule})` : "")

          return JSON.stringify({
            success: true,
            tool: "ast_grep_scan",
            summary,
            output: parsed || out || "(no output)",
            matchedRules: parsed ? Object.keys(parsed) : undefined,
          })
        },
      }),
    },
  }
}

export default plugin
export { plugin as server }
