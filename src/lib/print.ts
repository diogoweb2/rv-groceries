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

  // Total item count drives how aggressively we pack columns so everything
  // tries to fit on a single page while wasting as little paper as possible.
  const total = nonEmpty.reduce((n, l) => n + l.items.length, 0)

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; margin: 16px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  /* Flow sections into balanced columns to save paper. The column count and
     spacing scale with how many items there are. */
  .cols { column-count: ${total > 24 ? 3 : 2}; column-gap: 24px; column-fill: balance; }
  section { margin: 0 0 14px; break-inside: avoid; -webkit-column-break-inside: avoid; page-break-inside: avoid; display: inline-block; width: 100%; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin: 0 0 6px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 13px; break-inside: avoid; }
  .box { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #333; border-radius: 3px; flex: 0 0 auto; }
  .txt { line-height: 1.25; }
  @media print { body { margin: 0; } @page { margin: 12mm; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="cols">${sections}</div>
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
