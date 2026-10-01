/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"
import { Window } from "happy-dom"
import { parseNativeMarkdown } from "./marked"

const cases = [
  { escaped: "&amp;quot; &amp;#39;", text: "&quot; &#39;" },
  { escaped: "&amp;lt; &amp;gt; &amp;amp;", text: "&lt; &gt; &amp;" },
  { escaped: "&amp;amp;quot;", text: "&amp;quot;" },
  { escaped: "&lt;tag&gt; &quot;quoted&quot; &#39;single&#39; &amp;", text: '<tag> "quoted" \'single\' &' },
  { escaped: "&lt;script&gt;alert(1)&lt;/script&gt;", text: "<script>alert(1)</script>" },
  { escaped: "$x$ &amp;quot;", text: "$x$ &quot;" },
]

for (const { escaped, text } of cases) {
  test(`NativeMarkdown_CodeEntities_DecodeExactlyOnce: ${escaped}`, async () => {
    const window = new Window()
    try {
      const calls: string[] = []
      const html = await parseNativeMarkdown("native source", async (source) => {
        calls.push(source)
        return `<pre><code class="language-text">${escaped}</code></pre>`
      })
      expect(calls).toEqual(["native source"])
      const container = window.document.createElement("div")
      container.innerHTML = html
      expect(container.querySelector("code")?.textContent).toBe(text)
      expect(container.querySelector("script")).toBeNull()
      expect(container.querySelector(".shiki")).not.toBeNull()
    } finally {
      await window.happyDOM.close()
    }
  })
}
