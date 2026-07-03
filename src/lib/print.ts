// Printing checklists (§19). Renders a clean, print-only document into a hidden
// iframe and triggers the browser print dialog. Printouts intentionally:
//   - ignore completed (checked) items — you only print what's left to do,
//   - show an empty checkbox beside each item to tick off by hand,
//   - show no app icons/controls (just names, and quantity where relevant).

export interface PrintList {
  /** List/section heading. */
  name: string
  /** Item lines to print (already filtered to outstanding items). */
  items: string[]
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ))
}

/**
 * Print one or more lists under a shared document title. Lists with no
 * outstanding items are skipped. No-op if there is nothing to print.
 */
export function printLists(title: string, lists: PrintList[]) {
  const nonEmpty = lists.filter((l) => l.items.length > 0)
  if (nonEmpty.length === 0) {
    alert('Nothing to print — all items are completed.')
    return
  }

  const sections = nonEmpty.map((l) => `
    <section>
      <h2>${escapeHtml(l.name)}</h2>
      <ul>
        ${l.items.map((it) => `<li><span class="box"></span><span class="txt">${escapeHtml(it)}</span></li>`).join('')}
      </ul>
    </section>
  `).join('')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  section { margin: 0 0 20px; break-inside: avoid; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.04em; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 0 0 8px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 15px; break-inside: avoid; }
  .box { display: inline-block; width: 16px; height: 16px; border: 1.5px solid #333; border-radius: 3px; flex: 0 0 auto; }
  .txt { line-height: 1.3; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${sections}
</body>
</html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const cleanup = () => {
    // Give the print dialog time to grab the document before removing it.
    setTimeout(() => iframe.remove(), 1000)
  }

  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) { cleanup(); return }
    win.focus()
    win.print()
    // Remove after the dialog closes (best-effort across browsers).
    win.onafterprint = cleanup
    setTimeout(cleanup, 60000)
  }

  const doc = iframe.contentDocument
  if (!doc) { iframe.remove(); return }
  doc.open()
  doc.write(html)
  doc.close()
}
