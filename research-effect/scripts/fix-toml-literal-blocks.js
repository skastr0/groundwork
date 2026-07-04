const fs = require("fs")
const path = require("path")

const files = [
  "policies/groundwork-effect-schema-errors.toml",
  "policies/groundwork-effect-services-layers.toml",
]

for (const file of files) {
  const p = path.join(__dirname, "..", file)
  const text = fs.readFileSync(p, "utf8")
  const lines = text.split("\n")
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(/^(\s*)pattern\s*=\s*\|(.*)$/)
    if (match) {
      const indent = match[1]
      const suffix = match[2]
      if (suffix.trim().length > 0) {
        throw new Error(`Unexpected content after pattern = | at ${file}:${i + 1}`)
      }
      out.push(`${indent}pattern = '''`)
      i++
      // Collect subsequent indented lines as the literal block content.
      while (i < lines.length && (lines[i].startsWith(indent + "  ") || lines[i].trim() === "")) {
        out.push(lines[i])
        i++
      }
      out.push(`${indent}'''`)
    } else {
      out.push(line)
      i++
    }
  }
  fs.writeFileSync(p, out.join("\n"))
  console.log(`Fixed ${file}`)
}
