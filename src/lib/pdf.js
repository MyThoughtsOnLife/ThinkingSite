/* ===== Obsidian Vault — pdf.js-powered PDF viewer (vanilla DOM) =====
 *
 * One mount function usable from both markdown embeds (markdown.js) and the
 * full-file view (App.jsx). Renders every page to a <canvas> as it scrolls
 * into view, with a text layer for selection, page nav, zoom and an
 * "open in browser tab" escape hatch. destroy() frees the worker.
 *
 * Covered indirectly by scripts/test-pdf-lib.js (worker wiring + page opts).
 */
import { el, esc, escAttr } from './source-utils.js';
import { ICONS } from './icons.js';

let _libPromise = null;
async function getPdfLib() {
  if (!_libPromise) {
    _libPromise = (async () => {
      const [lib, workerMod] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline')
      ]);
      // one fresh worker per document (see mountPdfViewer) — workerSrc is
      // unused with port-based workers but must not be empty for isEval checks
      lib.GlobalWorkerOptions.workerSrc = 'mdreader-pdf-worker';
      lib.GlobalWorkerOptions.workerPort = null;
      return { lib, WorkerCtor: workerMod.default };
    })();
    _libPromise.catch(() => { _libPromise = null; });
  }
  return _libPromise;
}

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.25, 1.5, 2, 2.5, 3];
let uid = 0;

/**
 * Mount a PDF viewer into `host` (replacing its content).
 * opts: { bytes, name, initialPage = 1, height = 480, resizable = true, fill = false }
 * Returns { destroy(), goToPage(n), setScale(z | 'fit' | 'width') }.
 */
export async function mountPdfViewer(host, opts) {
  const bytes = opts && opts.bytes;
  if (!bytes) throw new Error('mountPdfViewer: no bytes');
  const name = (opts && opts.name) || 'document.pdf';
  const initialPage = Math.max(1, (opts && opts.initialPage) || 1);
  const fill = !!(opts && opts.fill);

  host.classList.add('pdf-embed');
  if (fill) host.classList.add('fill');
  host.innerHTML = '';
  const loading = el('div', 'pdf-loading', '<span class="pdf-spin" aria-hidden="true"></span><span>Loading ' + esc(name) + '…</span>');
  host.appendChild(loading);

  let lib, WorkerCtor, doc = null, worker = null, disposed = false;
  let scale = 1, fitScale = 1, zoomIdx = 4;
  let numPages = 0;
  const pages = [];              // { div, canvas, text, n, baseW, baseH, task, textTask, renderedAt, loading }
  const pageTasks = new Map();   // n -> render promise
  let io = null;

  const root = el('div', 'pdf-viewer' + (fill ? ' fill' : ''));
  root.innerHTML =
    '<div class="pdf-toolbar">' +
      '<span class="pdf-title" title="' + escAttr(name) + '">' + esc(name) + '</span>' +
      '<span class="pdf-tsep"></span>' +
      '<button type="button" class="pdf-btn pdf-prev" title="Previous page">' + (ICONS.chevL || '') + '</button>' +
      '<span class="pdf-pagebox"><input class="pdf-pageinp" type="text" inputmode="numeric" aria-label="Page number" /><span class="pdf-pageof">/ ?</span></span>' +
      '<button type="button" class="pdf-btn pdf-next" title="Next page">' + (ICONS.chevR || '') + '</button>' +
      '<span class="pdf-tsep"></span>' +
      '<button type="button" class="pdf-btn pdf-zout" title="Zoom out">' + (ICONS.minus || '') + '</button>' +
      '<button type="button" class="pdf-btn pdf-zfit" title="Fit width">' + (ICONS.fit || '') + '</button>' +
      '<button type="button" class="pdf-btn pdf-zin" title="Zoom in">' + (ICONS.plus || '') + '</button>' +
      '<span class="pdf-zoomlbl">100%</span>' +
      '<span class="pdf-spring"></span>' +
      '<a class="pdf-btn pdf-open" title="Open in browser tab" target="_blank" rel="noopener">' + (ICONS.external || '') + '</a>' +
    '</div>' +
    '<div class="pdf-pages"></div>';
  host.removeChild(loading);
  host.appendChild(root);
  if (!fill) {
    host.style.height = Math.max(160, (opts && opts.height) || 480) + 'px';
    if (opts && opts.resizable !== false) host.appendChild(buildResizeGrip(host));
  }

  const pagesEl = root.querySelector('.pdf-pages');
  const pageInp = root.querySelector('.pdf-pageinp');
  const pageOf = root.querySelector('.pdf-pageof');
  const zoomLbl = root.querySelector('.pdf-zoomlbl');
  const openBtn = root.querySelector('.pdf-open');
  const blobURL = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  openBtn.href = blobURL;
  openBtn.download = name;

  function setLoading(msg) {
    host.innerHTML = '';
    host.appendChild(el('div', 'pdf-loading pdf-error', (ICONS.warning || '') + '<span>' + esc(msg || 'Could not load PDF') + '</span>'));
  }

  root.querySelector('.pdf-prev').addEventListener('click', () => goToPage(curPage() - 1));
  root.querySelector('.pdf-next').addEventListener('click', () => goToPage(curPage() + 1));
  root.querySelector('.pdf-zin').addEventListener('click', () => setZoomIdx(zoomIdx + 1));
  root.querySelector('.pdf-zout').addEventListener('click', () => setZoomIdx(zoomIdx - 1));
  root.querySelector('.pdf-zfit').addEventListener('click', () => applyScale(fitScale));
  pageInp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { pageInp.value = String(curPage()); pageInp.blur(); }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const n = parseInt(pageInp.value, 10);
    if (n >= 1 && n <= numPages) goToPage(n);
    else pageInp.value = String(curPage());
    pageInp.blur();
  });
  pageInp.addEventListener('blur', () => { pageInp.value = String(curPage()); });

  function curPage() {
    // topmost page whose midpoint is above the fold (or the first visible)
    const st = pagesEl.scrollTop, vh = pagesEl.clientHeight;
    let best = 1;
    for (const p of pages) {
      const top = p.div.offsetTop, h = p.div.offsetHeight;
      if (top + h / 2 <= st + vh * 0.5) best = p.n;
      else if (top < st + vh && top + h > st) best = best === 0 ? p.n : best;
    }
    return Math.min(Math.max(1, best), Math.max(1, numPages));
  }

  function syncPageLabel() {
    const n = curPage();
    if (document.activeElement !== pageInp) pageInp.value = String(n);
    pageOf.textContent = '/ ' + numPages;
  }

  function goToPage(n) {
    n = Math.min(Math.max(1, n), numPages || 1);
    const p = pages[n - 1];
    if (!p) return;
    pagesEl.scrollTop = p.div.offsetTop - 6;
    syncPageLabel();
  }

  function setZoomIdx(i) {
    const idx = Math.min(Math.max(0, i), ZOOMS.length - 1);
    if (idx === zoomIdx) return;
    zoomIdx = idx;
    applyScale(ZOOMS[zoomIdx]);
  }

  function applyScale(s) {
    s = Math.min(Math.max(0.3, s), 4);
    scale = s;
    zoomLbl.textContent = Math.round(s * 100) + '%';
    for (const p of pages) {
      const w = Math.round(p.baseW * s), h = Math.round(p.baseH * s);
      p.div.style.width = w + 'px';
      p.div.style.height = h + 'px';
      p.canvas.style.width = w + 'px';
      p.canvas.style.height = h + 'px';
      p.renderedAt = -1; // force re-render when visible
      if (p.textLayer) { p.textLayer.dataset.stale = '1'; }
    }
    // re-check what's visible right away
    if (io) updateVisible();
  }

  function computeFitScale() {
    if (!pages.length) return 1;
    const avail = pagesEl.clientWidth - 24;
    return avail > 0 && pages[0].baseW > 0 ? avail / pages[0].baseW : 1;
  }

  async function renderPage(p) {
    if (p.loading || p.renderedAt === scale) return;
    p.loading = true;
    try {
      const page = await doc.getPage(p.n);
      if (disposed) return;
      // real page dims can differ from the page-1 placeholder
      const vp1 = page.getViewport({ scale: 1 });
      if (Math.abs(vp1.width - p.baseW) > 1 || Math.abs(vp1.height - p.baseH) > 1) {
        p.baseW = vp1.width; p.baseH = vp1.height;
        const w = Math.round(vp1.width * scale), h = Math.round(vp1.height * scale);
        p.div.style.width = w + 'px';
        p.div.style.height = h + 'px';
      }
      const vp = page.getViewport({ scale: scale });
      const out = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = p.canvas;
      canvas.width = Math.floor(vp.width * out);
      canvas.height = Math.floor(vp.height * out);
      canvas.style.width = Math.floor(vp.width) + 'px';
      canvas.style.height = Math.floor(vp.height) + 'px';
      if (p.task) { try { p.task.cancel(); } catch (e) {} }
      const task = page.render({
        canvasContext: canvas.getContext('2d', { alpha: false }),
        viewport: vp,
        transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null
      });
      p.task = task;
      await task.promise;
      if (disposed) return;
      p.renderedAt = scale;
      // text layer for selection (skip re-render if same scale)
      if (!p.textLayer || p.textLayer.dataset.stale) {
        if (p.textTask) { try { p.textTask.cancel(); } catch (e) {} }
        const tl = el('div', 'textLayer');
        p.div.replaceChild(tl, p.textLayer || p.textSlot);
        p.textLayer = tl;
        const t = new lib.TextLayer({
          textContentSource: page.streamTextContent({ disableNormalization: true }),
          container: tl,
          viewport: vp
        });
        p.textTask = t;
        await t.render();
      }
    } catch (err) {
      if (!disposed && err && err.name !== 'RenderingCancelledException' && err.message !== 'Rendering cancelled') {
        console.warn('pdf page render failed', err);
      }
    } finally {
      p.loading = false;
    }
  }

  function updateVisible() {
    if (!io) return;
    const st = pagesEl.scrollTop, vh = pagesEl.clientHeight;
    for (const p of pages) {
      const top = p.div.offsetTop, h = p.div.offsetHeight;
      const visible = top < st + vh + 400 && top + h > st - 400;
      if (visible && p.renderedAt !== scale) renderPage(p);
    }
    syncPageLabel();
  }

  try {
    ({ lib, WorkerCtor } = await getPdfLib());
    if (disposed) return { destroy() {} };
    worker = new lib.PDFWorker({ port: new WorkerCtor(), name: 'ovv-pdf-' + (++uid) });
    doc = await lib.getDocument({
      data: bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes),
      worker,
      isEvalSupported: false
    }).promise;
  } catch (err) {
    console.warn('pdf load failed', err);
    if (!disposed) {
      const pw = err && err.name === 'PasswordException';
      setLoading(pw ? 'This PDF is password-protected' : 'Could not load PDF: ' + (err && err.message ? err.message : err));
    }
    try { if (worker) worker.destroy(); } catch (e) {}
    return { destroy() { disposed = true; } };
  }
  if (disposed) { try { await doc.destroy(); } catch (e) {} return { destroy() {} }; }

  numPages = doc.numPages;
  pageOf.textContent = '/ ' + numPages;

  // layout from page 1; per-page dims corrected on demand in renderPage
  const p1 = await doc.getPage(1);
  const vp1 = p1.getViewport({ scale: 1 });
  for (let n = 1; n <= numPages; n++) {
    const div = el('div', 'pdf-page');
    div.dataset.n = String(n);
    const canvas = el('canvas');
    const textSlot = el('div', 'textLayer');
    const badge = el('div', 'pdf-pagebadge', String(n));
    div.appendChild(canvas);
    div.appendChild(textSlot);
    div.appendChild(badge);
    pagesEl.appendChild(div);
    pages.push({
      n, div, canvas, textSlot, textLayer: null,
      baseW: vp1.width, baseH: vp1.height,
      task: null, textTask: null, renderedAt: -1, loading: false
    });
  }

  fitScale = computeFitScale();
  zoomIdx = ZOOMS.reduce((bi, z, i) => (Math.abs(z - fitScale) < Math.abs(ZOOMS[bi] - fitScale) ? i : bi), 4);
  applyScale(Math.min(Math.max(fitScale, ZOOMS[0]), 2.5));
  // keep fitScale fresh so "fit width" uses the current pane size
  const ro = new ResizeObserver(() => { fitScale = computeFitScale(); });
  ro.observe(pagesEl);

  io = new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) updateVisible();
  }, { root: pagesEl, rootMargin: '600px 0px' });
  for (const p of pages) io.observe(p.div);

  let scrollRaf = 0;
  pagesEl.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateVisible(); });
  }, { passive: true });
  updateVisible();
  if (initialPage > 1) goToPage(initialPage);

  async function destroy() {
    disposed = true;
    try { if (io) io.disconnect(); } catch (e) {}
    try { ro && ro.disconnect(); } catch (e) {}
    for (const p of pages) {
      try { if (p.task) p.task.cancel(); } catch (e) {}
      try { if (p.textTask) p.textTask.cancel(); } catch (e) {}
    }
    try { if (doc) await doc.destroy(); } catch (e) {}
    try { if (worker) worker.destroy(); } catch (e) {}
    try { URL.revokeObjectURL(blobURL); } catch (e) {}
  }

  return {
    destroy,
    goToPage,
    setScale: z => (z === 'fit' ? applyScale(fitScale) : applyScale(z)),
    get page() { return curPage(); },
    get numPages() { return numPages; }
  };
}

/* bottom drag grip — same interaction as the html embed's */
function buildResizeGrip(host) {
  const grip = el('div', 'embed-resize');
  grip.title = 'Drag to resize';
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = host.offsetHeight;
    const onMove = ev => {
      ev.preventDefault();
      host.style.height = Math.min(Math.max(160, startH + (ev.clientY - startY)), window.innerHeight - 80) + 'px';
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { once: true });
  });
  return grip;
}
