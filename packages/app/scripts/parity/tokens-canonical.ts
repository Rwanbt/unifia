// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs"
import { join } from "node:path"

type Declaration = { property: string; file: string; value: string }
type Usage = { property: string; file: string; count: number }
type Selector = { selector: string; file: string }

type Inventory = {
  declarations: Declaration[]
  usages: Usage[]
  selectors: Selector[]
  counts: Record<string, number>
}

// Keep occurrences within a file in source order: repeated CSS declarations
// can change the cascade, even when their names are identical.
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

export function canonicalTokens(input: Inventory): Inventory {
  return {
    counts: input.counts,
    declarations: [...input.declarations].sort(
      (left, right) => compare(left.file, right.file) || compare(left.property, right.property),
    ),
    usages: [...input.usages].sort(
      (left, right) => compare(left.file, right.file) || compare(left.property, right.property),
    ),
    selectors: [...input.selectors].sort((left, right) => compare(left.file, right.file)),
  }
}

export function assertBrandCssSync(root: string): void {
  const source = readFileSync(join(root, "brand", "unifia", "unifia.css"))
  const shipped = readFileSync(join(root, "packages", "app", "src", "styles", "unifia-brand.css"))
  if (source.equals(shipped)) return
  throw new Error("Brand CSS drift: packages/app/src/styles/unifia-brand.css differs from brand/unifia/unifia.css")
}
