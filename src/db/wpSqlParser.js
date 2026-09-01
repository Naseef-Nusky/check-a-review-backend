/**
 * Minimal parser for single-row MySQL INSERT statements from WP migration dumps.
 */

export function parseInsertLine(line, tableName) {
  const marker = `INSERT INTO \`${tableName}\` VALUES `
  if (!line.startsWith(marker)) return null

  const open = line.indexOf('(', marker.length)
  const close = line.lastIndexOf(')')
  if (open === -1 || close === -1 || close <= open) return null

  return parseSqlTuple(line.slice(open + 1, close))
}

export function parseSqlTuple(tuple) {
  const values = []
  let i = 0

  while (i < tuple.length) {
    while (i < tuple.length && (tuple[i] === ' ' || tuple[i] === ',')) i += 1
    if (i >= tuple.length) break

    if (tuple.startsWith('NULL', i)) {
      values.push(null)
      i += 4
      continue
    }

    if (tuple[i] === "'") {
      let value = ''
      i += 1
      while (i < tuple.length) {
        const ch = tuple[i]
        if (ch === '\\') {
          i += 1
          if (i < tuple.length) value += tuple[i]
          i += 1
          continue
        }
        if (ch === "'") {
          if (tuple[i + 1] === "'") {
            value += "'"
            i += 2
            continue
          }
          i += 1
          break
        }
        value += ch
        i += 1
      }
      values.push(value)
      continue
    }

    let raw = ''
    while (i < tuple.length && tuple[i] !== ',') {
      raw += tuple[i]
      i += 1
    }
    const trimmed = raw.trim()
    if (trimmed === '') values.push('')
    else if (/^-?\d+(\.\d+)?$/.test(trimmed)) values.push(Number(trimmed))
    else values.push(trimmed)
  }

  return values
}

export function readPhpString(serialized, key) {
  const pattern = new RegExp(`s:${key.length}:"${key}";s:(\\d+):"`, 's')
  const match = serialized.match(pattern)
  if (!match) return ''

  const length = Number(match[1])
  const start = match.index + match[0].length
  return serialized.slice(start, start + length)
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}
