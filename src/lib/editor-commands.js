/* Inline formatting commands adapted from obsidian-editor/src/editor/commands.js. */
import { EditorSelection } from '@codemirror/state';

/** Toggle a symmetric inline marker (**, *, ==, ~~, ^^, `) around each selection. */
export function toggleWrap(view, mark, perLine = false) {
  if (!view || view.state.readOnly) return;
  const state = view.state;
  const n = mark.length;
  const wrap = range => {
    let { from, to } = range;
    // empty selection inside a word → act on the word
    if (from === to) {
      const w = state.wordAt(from);
      if (w) { from = w.from; to = w.to; }
    }
    const before = state.sliceDoc(from - n, from);
    const after = state.sliceDoc(to, to + n);
    const inner = state.sliceDoc(from, to);
    if (before === mark && after === mark) {
      return {
        changes: [{ from: from - n, to: from }, { from: to, to: to + n }],
        range: EditorSelection.range(from - n, to - n)
      };
    }
    if (inner.length >= 2 * n && inner.startsWith(mark) && inner.endsWith(mark)) {
      return {
        changes: [{ from, to: from + n }, { from: to - n, to }],
        range: EditorSelection.range(from, to - 2 * n)
      };
    }
    if (from === to) {
      return { changes: { from, insert: mark + mark }, range: EditorSelection.cursor(from + n) };
    }
    return {
      changes: [{ from, insert: mark }, { from: to, insert: mark }],
      range: EditorSelection.range(from + n, to + n)
    };
  };
  const tr = state.changeByRange(range => {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    if (!perLine || first.number === last.number) return wrap(range);

    const changes = [];
    for (let i = first.number; i <= last.number; i++) {
      const line = state.doc.line(i);
      const from = Math.max(line.from, range.from);
      const to = Math.min(line.to, range.to);
      const text = state.sliceDoc(from, to);
      if (!text.trim()) continue;
      const wrapped = wrap(EditorSelection.range(from + text.length - text.trimStart().length, from + text.trimEnd().length));
      changes.push(...(Array.isArray(wrapped.changes) ? wrapped.changes : [wrapped.changes]));
    }
    const mapping = state.changes(changes);
    return { changes: mapping, range: EditorSelection.range(mapping.mapPos(range.anchor, range.anchor === range.from ? -1 : 1), mapping.mapPos(range.head, range.head === range.from ? -1 : 1)) };
  });
  const update = state.update(tr, { scrollIntoView: true, userEvent: 'input' });
  view.dispatch(update);
  view.focus();
}

export function insertLink(view) {
  if (!view) return;
  const { state } = view;
  const { from, to } = state.selection.main;
  const sel = state.sliceDoc(from, to);
  if (/^https?:\/\//.test(sel)) {
    view.dispatch({ changes: { from, to, insert: '[](' + sel + ')' }, selection: { anchor: from + 1 } });
  } else if (sel) {
    view.dispatch({ changes: { from, to, insert: '[' + sel + ']()' }, selection: { anchor: from + sel.length + 3 } });
  } else {
    view.dispatch({ changes: { from, insert: '[[]]' }, selection: { anchor: from + 2 } });
  }
  view.focus();
}

