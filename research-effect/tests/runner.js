const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")
const toml = require("toml")

const ROOT = path.resolve(__dirname, "..")
const POLICY_PATH = path.join(ROOT, "policies", "groundwork-effect.toml")
const FIXTURES_DIR = path.join(ROOT, "fixtures")
const TMP_DIR = path.join(ROOT, "node_modules", ".tmp-groundwork-tests")
const QUARTZ_PATH = process.env.QUARTZ_PATH || findQuartz()

function findQuartz() {
  const candidates = [
    "/Users/guilhermecastro/.local/share/mise/installs/npm-skastr0-quartz/latest/bin/quartz",
    "quartz",
  ]
  for (const c of candidates) {
    try {
      execSync(`which ${JSON.stringify(c)}`, { stdio: "ignore" })
      return c
    } catch {}
  }
  return null
}

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

const policy = toml.parse(fs.readFileSync(POLICY_PATH, "utf8"))
const fixtures = fs
  .readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(FIXTURES_DIR, f))

const rules = policy.rules || []
const quartzRules = rules.filter((r) => (r.content || []).some((c) => c.type === "quartz"))
const astGrepRules = rules.filter((r) => (r.content || []).some((c) => c.type === "ast_grep"))

function escapeYaml(str) {
  // YAML is a superset of JSON, so a JSON string is always valid YAML and
  // handles quotes, backslashes, newlines, and special characters correctly.
  return JSON.stringify(str)
}

function writeAstGrepRule(ruleId, pattern) {
  const file = path.join(TMP_DIR, `${ruleId}.yml`)
  const trimmed = pattern.trim()
  const yaml = `id: ${ruleId}\nlanguage: ts\nrule:\n  pattern: ${escapeYaml(trimmed)}\n`
  fs.writeFileSync(file, yaml)
  return file
}

function runAstGrep(ruleFile, targets) {
  const cmd = [
    "sg",
    "scan",
    "--json",
    "-r",
    JSON.stringify(ruleFile),
    ...targets.map((t) => JSON.stringify(t)),
  ].join(" ")
  try {
    const out = execSync(cmd, { encoding: "utf8", cwd: ROOT })
    return JSON.parse(out)
  } catch (err) {
    // sg exits non-zero when no matches are found in some versions, but still prints [].
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout)
      } catch {}
    }
    return []
  }
}

function runQuartz(command, payload) {
  if (!QUARTZ_PATH) {
    throw new Error("Quartz CLI not found. Set QUARTZ_PATH or install @skastr0/quartz.")
  }
  const cmd = [QUARTZ_PATH, command, "-", "--format", "json"].join(" ")
  const out = execSync(cmd, {
    encoding: "utf8",
    cwd: ROOT,
    input: JSON.stringify(payload),
  })
  return JSON.parse(out)
}

function parseFixtureAnnotations(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n")
  const violations = new Map() // ruleId -> Set(lineNumbers)
  const okays = new Map() // ruleId -> Set(lineNumbers)
  const reViolation = /\/\/\s*violation:\s*([\w-]+)/
  const reOk = /\/\/\s*ok:\s*([\w-]+)/

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1
    const vMatch = line.match(reViolation)
    const oMatch = line.match(reOk)
    if (vMatch) {
      const id = vMatch[1]
      if (!violations.has(id)) violations.set(id, new Set())
      violations.get(id).add(lineNumber)
    }
    if (oMatch) {
      const id = oMatch[1]
      if (!okays.has(id)) okays.set(id, new Set())
      okays.get(id).add(lineNumber)
    }
  })

  return { violations, okays }
}

function unionMatchedLinesByFixture(rule) {
  const contents = (rule.content || []).filter((c) => c.type === "ast_grep")
  if (contents.length === 0) return new Map()

  const byFixture = new Map() // fixturePath -> Set(lineNumber)
  for (const content of contents) {
    const ruleFile = writeAstGrepRule(rule.id, content.pattern)
    const matches = runAstGrep(ruleFile, fixtures)
    for (const m of matches) {
      if (m.range && m.range.start && m.range.end && typeof m.range.start.line === "number" && typeof m.range.end.line === "number") {
        // ast-grep reports 0-indexed line numbers in its JSON output.
        const startLine = m.range.start.line + 1
        const endLine = m.range.end.line + 1
        const set = byFixture.get(m.file) || new Set()
        for (let line = startLine; line <= endLine; line++) {
          set.add(line)
        }
        byFixture.set(m.file, set)
      }
    }
  }
  return byFixture
}

// Quartz checks operate on the type string of exported symbols.
const quartzChecks = {
  effect_error_channel_any: (type) => /Effect\.[A-Za-z]+<[^,]+,\s*any,/.test(type),
  effect_requirement_channel_any: (type) => /Effect\.[A-Za-z]+<[^,]+,[^,]+,\s*any\s*>/.test(type),
  effect_requirement_channel_unknown: (type) => /Effect\.[A-Za-z]+<[^,]+,[^,]+,\s*unknown\s*>/.test(type),
}

let quartzSymbols = null
let quartzSymbolTypes = new Map() // symbol name -> type string

function ensureQuartzData() {
  if (quartzSymbols) return

  const symbolsResponse = runQuartz("symbols", {})
  if (!symbolsResponse.ok) {
    throw new Error(`Quartz symbols failed: ${JSON.stringify(symbolsResponse.error)}`)
  }
  quartzSymbols = symbolsResponse.data.symbols || []

  // Batch info for all symbols in fixture files.
  const fixtureFiles = new Set(fixtures.map((f) => path.relative(ROOT, f)))
  const fixtureSymbols = quartzSymbols.filter((s) => fixtureFiles.has(s.file))
  if (fixtureSymbols.length > 0) {
    const infoPayload = fixtureSymbols.map((s) => ({ symbol: s.name }))
    const infoResponse = runQuartz("info", infoPayload)
    if (!infoResponse.ok) {
      throw new Error(`Quartz info failed: ${JSON.stringify(infoResponse.error)}`)
    }
    for (const result of infoResponse.data.results || []) {
      if (result.ok && result.data && result.data.type) {
        quartzSymbolTypes.set(result.target.symbol, result.data.type)
      }
    }
  }
}

function evaluateQuartzRule(rule) {
  ensureQuartzData()

  const content = (rule.content || []).find((c) => c.type === "quartz")
  if (!content || !content.check || !quartzChecks[content.check]) {
    return new Map()
  }
  const checkFn = quartzChecks[content.check]
  const byFixture = new Map()

  for (const symbol of quartzSymbols) {
    const type = quartzSymbolTypes.get(symbol.name)
    if (!type) continue
    if (!checkFn(type)) continue

    const fixturePath = path.join(ROOT, symbol.file)
    if (!fixtures.includes(fixturePath)) continue

    const set = byFixture.get(fixturePath) || new Set()
    set.add(symbol.line)
    byFixture.set(fixturePath, set)
  }

  return byFixture
}

const fixtureAnnotations = new Map()
for (const fixture of fixtures) {
  fixtureAnnotations.set(fixture, parseFixtureAnnotations(fixture))
}

let failures = []
let passed = 0

function assertRule(rule, matchedByFixture) {
  for (const fixture of fixtures) {
    const { violations, okays } = fixtureAnnotations.get(fixture)
    const violationLines = violations.get(rule.id) || new Set()
    const okLines = okays.get(rule.id) || new Set()
    const matchedLines = matchedByFixture.get(fixture) || new Set()

    for (const line of violationLines) {
      if (!matchedLines.has(line)) {
        failures.push(`${rule.id}: expected violation at ${fixture}:${line} was not matched`)
      } else {
        passed++
      }
    }

    for (const line of okLines) {
      if (matchedLines.has(line)) {
        failures.push(`${rule.id}: expected ok at ${fixture}:${line} was matched`)
      } else {
        passed++
      }
    }
  }
}

for (const rule of astGrepRules) {
  assertRule(rule, unionMatchedLinesByFixture(rule))
}

if (quartzRules.length > 0) {
  if (!QUARTZ_PATH) {
    console.error("Quartz rules are defined but the Quartz CLI was not found.")
    process.exit(1)
  }
  for (const rule of quartzRules) {
    assertRule(rule, evaluateQuartzRule(rule))
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} assertion(s) failed:\n`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error(`\n${passed} assertion(s) passed.`)
  process.exit(1)
}

console.log(`\nAll ${passed} assertions passed across ${rules.length} rules (${astGrepRules.length} ast-grep, ${quartzRules.length} quartz) and ${fixtures.length} fixtures.`)
