import { EventEmitter } from './event-emitter';
import type { GhosttyTerminal } from './ghostty';
import type { IEvent } from './interfaces';
import type { CanvasRenderer } from './renderer';
import type { Terminal } from './terminal';
import type { GhosttyCell } from './types';

export interface SelectionCoordinates {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

type Pos = { col: number; absoluteRow: number };

type DragState =
  | { type: 'idle' }
  | { type: 'char' }
  | { type: 'word'; anchor: { start: Pos; end: Pos } };

export class SelectionManager {
  private terminal: Terminal;
  private renderer: CanvasRenderer;
  private wasmTerm: GhosttyTerminal;
  private textarea: HTMLTextAreaElement;
  private canvas!: HTMLCanvasElement;

  private start: Pos | null = null;
  private end: Pos | null = null;
  private drag: DragState = { type: 'idle' };

  // Survives mouseup so the click handler can skip selectWordAt when user dragged.
  private wordDragOccurred = false;

  // Viewport-relative rows that need redrawing to clear stale selection highlight.
  private dirtyRows = new Set<number>();

  private mouseDownTarget: EventTarget | null = null;
  private selectionChangedEmitter = new EventEmitter<void>();

  private boundMouseUpHandler: (() => void) | null = null;
  private boundContextMenuHandler: ((e: MouseEvent) => void) | null = null;
  private boundClickHandler: ((e: MouseEvent) => void) | null = null;
  private boundDocumentMouseMoveHandler: ((e: MouseEvent) => void) | null = null;

  private autoScrollInterval: ReturnType<typeof setInterval> | null = null;
  private autoScrollDirection = 0;
  private static readonly AUTO_SCROLL_EDGE = 30;
  private static readonly AUTO_SCROLL_SPEED = 3;
  private static readonly AUTO_SCROLL_INTERVAL_MS = 50;

  constructor(
    terminal: Terminal,
    renderer: CanvasRenderer,
    wasmTerm: GhosttyTerminal,
    textarea: HTMLTextAreaElement
  ) {
    this.terminal = terminal;
    this.renderer = renderer;
    this.wasmTerm = wasmTerm;
    this.textarea = textarea;
    this.attachEventListeners();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  hasSelection(): boolean {
    if (!this.start || !this.end) return false;
    return !(
      this.start.col === this.end.col &&
      this.start.absoluteRow === this.end.absoluteRow
    );
  }

  getSelection(): string {
    if (!this.start || !this.end) return '';

    let { col: startCol, absoluteRow: startAbsRow } = this.start;
    let { col: endCol, absoluteRow: endAbsRow } = this.end;

    if (startAbsRow > endAbsRow || (startAbsRow === endAbsRow && startCol > endCol)) {
      [startCol, endCol] = [endCol, startCol];
      [startAbsRow, endAbsRow] = [endAbsRow, startAbsRow];
    }

    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    let text = '';

    for (let absRow = startAbsRow; absRow <= endAbsRow; absRow++) {
      const line: GhosttyCell[] | null =
        absRow < scrollbackLength
          ? this.wasmTerm.getScrollbackLine(absRow)
          : this.wasmTerm.getLine(absRow - scrollbackLength);
      if (!line) continue;

      const colStart = absRow === startAbsRow ? startCol : 0;
      const colEnd = absRow === endAbsRow ? endCol : line.length - 1;

      let lineText = '';
      let lastNonEmpty = -1;

      for (let col = colStart; col <= colEnd; col++) {
        const cell = line[col];
        if (cell && cell.codepoint !== 0) {
          let char: string;
          if (cell.grapheme_len > 0) {
            char =
              absRow < scrollbackLength
                ? this.wasmTerm.getScrollbackGraphemeString(absRow, col)
                : this.wasmTerm.getGraphemeString(absRow - scrollbackLength, col);
          } else {
            char = String.fromCodePoint(cell.codepoint);
          }
          lineText += char;
          if (char.trim()) lastNonEmpty = lineText.length;
        } else {
          lineText += ' ';
        }
      }

      text += lastNonEmpty >= 0 ? lineText.substring(0, lastNonEmpty) : '';
      if (absRow < endAbsRow) text += '\n';
    }

    return text;
  }

  copySelection(): boolean {
    if (!this.hasSelection()) return false;
    const text = this.getSelection();
    if (text) {
      window.bump.copyToClipboard(text);
      return true;
    }
    return false;
  }

  clearSelection(): void {
    if (!this.hasSelection()) return;
    this.markRangeDirty();
    this.start = null;
    this.end = null;
    this.drag = { type: 'idle' };
  }

  selectAll(): void {
    const dims = this.wasmTerm.getDimensions();
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    this.setSelection(
      { col: 0, absoluteRow: 0 },
      { col: dims.cols - 1, absoluteRow: scrollbackLength + dims.rows - 1 }
    );
    this.selectionChangedEmitter.fire();
  }

  select(column: number, row: number, length: number): void {
    const dims = this.wasmTerm.getDimensions();
    row = Math.max(0, Math.min(row, dims.rows - 1));
    column = Math.max(0, Math.min(column, dims.cols - 1));

    let endRow = row;
    let endCol = column + length - 1;
    while (endCol >= dims.cols) { endCol -= dims.cols; endRow++; }
    endRow = Math.min(endRow, dims.rows - 1);

    const viewportY = this.getViewportY();
    this.setSelection(
      { col: column, absoluteRow: viewportY + row },
      { col: endCol, absoluteRow: viewportY + endRow }
    );
    this.selectionChangedEmitter.fire();
  }

  selectLines(start: number, end: number): void {
    const dims = this.wasmTerm.getDimensions();
    start = Math.max(0, Math.min(start, dims.rows - 1));
    end = Math.max(0, Math.min(end, dims.rows - 1));
    if (start > end) [start, end] = [end, start];

    const viewportY = this.getViewportY();
    this.setSelection(
      { col: 0, absoluteRow: viewportY + start },
      { col: dims.cols - 1, absoluteRow: viewportY + end }
    );
    this.selectionChangedEmitter.fire();
  }

  getSelectionPosition():
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined {
    const coords = this.normalizeSelection();
    if (!coords) return undefined;
    return {
      start: { x: coords.startCol, y: coords.startRow },
      end: { x: coords.endCol, y: coords.endRow },
    };
  }

  deselect(): void {
    this.clearSelection();
    this.selectionChangedEmitter.fire();
  }

  focus(): void {
    this.canvas.parentElement?.focus();
  }

  getSelectionCoords(): SelectionCoordinates | null {
    return this.normalizeSelection();
  }

  getDirtySelectionRows(): Set<number> {
    return this.dirtyRows;
  }

  clearDirtySelectionRows(): void {
    this.dirtyRows.clear();
  }

  get onSelectionChange(): IEvent<void> {
    return this.selectionChangedEmitter.event;
  }

  dispose(): void {
    this.selectionChangedEmitter.dispose();
    this.stopAutoScroll();

    if (this.boundMouseUpHandler) {
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseUpHandler = null;
    }
    if (this.boundDocumentMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundDocumentMouseMoveHandler);
      this.boundDocumentMouseMoveHandler = null;
    }
    if (this.boundContextMenuHandler) {
      this.canvas.removeEventListener('contextmenu', this.boundContextMenuHandler);
      this.boundContextMenuHandler = null;
    }
    if (this.boundClickHandler) {
      document.removeEventListener('click', this.boundClickHandler);
      this.boundClickHandler = null;
    }
  }

  // ── Drag interaction ──────────────────────────────────────────────────────

  private beginDrag(e: MouseEvent): void {
    const cell = this.pixelToCell(e.offsetX, e.offsetY);
    const absoluteRow = this.viewportRowToAbsolute(cell.row);

    this.markRangeDirty();

    if (e.detail === 2) {
      const range = this.getSemanticRangeAt(cell.col, cell.row);
      const s: Pos = { col: range?.startCol ?? cell.col, absoluteRow };
      const en: Pos = { col: range?.endCol ?? cell.col, absoluteRow };
      this.start = s;
      this.end = en;
      this.drag = { type: 'word', anchor: { start: s, end: en } };
      this.wordDragOccurred = false;
    } else {
      this.start = { col: cell.col, absoluteRow };
      this.end = { col: cell.col, absoluteRow };
      this.drag = { type: 'char' };
    }

    this.selectionChangedEmitter.fire();
  }

  private extendDrag(col: number, viewportRow: number, absoluteRow: number): void {
    this.markRangeDirty();

    if (this.drag.type === 'word') {
      const { anchor } = this.drag;
      const withinAnchor =
        absoluteRow === anchor.start.absoluteRow &&
        col >= anchor.start.col &&
        col <= anchor.end.col;
      if (!withinAnchor) {
        this.wordDragOccurred = true;
        this.extendByWord(col, viewportRow, absoluteRow);
      }
    } else {
      this.end = { col, absoluteRow };
    }

    this.selectionChangedEmitter.fire();
  }

  private commitDrag(): void {
    if (this.drag.type === 'idle') return;
    this.drag = { type: 'idle' };
    this.stopAutoScroll();
    this.selectionChangedEmitter.fire();
  }

  private extendByWord(col: number, viewportRow: number, absoluteRow: number): void {
    if (this.drag.type !== 'word') return;
    const { anchor } = this.drag;

    const before =
      absoluteRow < anchor.start.absoluteRow ||
      (absoluteRow === anchor.start.absoluteRow && col < anchor.start.col);

    const range = this.getSemanticRangeAt(col, viewportRow);
    if (before) {
      this.start = { col: range?.startCol ?? col, absoluteRow };
      this.end = { ...anchor.end };
    } else {
      this.start = { ...anchor.start };
      this.end = { col: range?.endCol ?? col, absoluteRow };
    }
  }

  // ── Canvas event handlers ─────────────────────────────────────────────────

  private onCanvasMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || e.metaKey || e.ctrlKey) return;
    this.beginDrag(e);
  }

  private onCanvasMouseMove(e: MouseEvent): void {
    if (this.drag.type === 'idle') return;
    const cell = this.pixelToCell(e.offsetX, e.offsetY);
    this.extendDrag(cell.col, cell.row, this.viewportRowToAbsolute(cell.row));
  }

  private onCanvasMouseLeave(e: MouseEvent): void {
    if (this.drag.type === 'idle') return;
    const rect = this.canvas.getBoundingClientRect();
    if (e.clientY < rect.top) this.startAutoScroll(-1);
    else if (e.clientY > rect.bottom) this.startAutoScroll(1);
  }

  private onCanvasMouseEnter(): void {
    if (this.drag.type !== 'idle') this.stopAutoScroll();
  }

  private onCanvasClick(e: MouseEvent): void {
    if (e.detail === 2) {
      if (!this.wordDragOccurred) {
        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        this.selectWordAt(cell.col, cell.row);
      }
    } else if (e.detail === 3) {
      const cell = this.pixelToCell(e.offsetX, e.offsetY);
      this.selectLineAt(cell.row);
    }
  }

  private onCanvasContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (!this.hasSelection()) {
      const cell = this.pixelToCell(e.offsetX, e.offsetY);
      this.selectWordAt(cell.col, cell.row);
    }
    this.canvas.dispatchEvent(
      new CustomEvent('terminal-context-menu', {
        bubbles: true,
        detail: { x: e.clientX, y: e.clientY },
      })
    );
  }

  // ── Document event handlers ───────────────────────────────────────────────

  private onDocumentMouseMove(e: MouseEvent): void {
    if (this.drag.type === 'idle') return;

    const rect = this.canvas.getBoundingClientRect();
    const outside =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;
    if (!outside) return;

    if (e.clientY < rect.top) this.startAutoScroll(-1);
    else if (e.clientY > rect.bottom) this.startAutoScroll(1);
    else this.stopAutoScroll();

    if (this.autoScrollDirection !== 0) return;

    const clampedX = Math.max(rect.left, Math.min(e.clientX, rect.right)) - rect.left;
    const clampedY = Math.max(rect.top, Math.min(e.clientY, rect.bottom)) - rect.top;
    const cell = this.pixelToCell(clampedX, clampedY);
    this.extendDrag(cell.col, cell.row, this.viewportRowToAbsolute(cell.row));
  }

  private onDocumentClick(e: MouseEvent): void {
    if (this.drag.type !== 'idle') return;
    if (this.mouseDownTarget && this.canvas.contains(this.mouseDownTarget as Node)) return;
    if (!this.canvas.contains(e.target as Node) && this.hasSelection()) {
      this.clearSelection();
    }
  }

  // ── Event listener setup ──────────────────────────────────────────────────

  private attachEventListeners(): void {
    this.canvas = this.renderer.getCanvas();

    this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
    this.canvas.addEventListener('mouseleave', (e) => this.onCanvasMouseLeave(e));
    this.canvas.addEventListener('mouseenter', () => this.onCanvasMouseEnter());
    this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));

    this.boundContextMenuHandler = (e) => this.onCanvasContextMenu(e);
    this.canvas.addEventListener('contextmenu', this.boundContextMenuHandler);

    this.boundDocumentMouseMoveHandler = (e) => this.onDocumentMouseMove(e);
    document.addEventListener('mousemove', this.boundDocumentMouseMoveHandler);

    document.addEventListener('mousedown', (e) => { this.mouseDownTarget = e.target; });

    this.boundMouseUpHandler = () => this.commitDrag();
    document.addEventListener('mouseup', this.boundMouseUpHandler);

    this.boundClickHandler = (e) => this.onDocumentClick(e);
    document.addEventListener('click', this.boundClickHandler);
  }

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  private updateAutoScroll(offsetY: number, canvasHeight: number): void {
    const edge = SelectionManager.AUTO_SCROLL_EDGE;
    if (offsetY < edge) this.startAutoScroll(-1);
    else if (offsetY > canvasHeight - edge) this.startAutoScroll(1);
    else this.stopAutoScroll();
  }

  private startAutoScroll(direction: number): void {
    if (this.autoScrollInterval !== null && this.autoScrollDirection === direction) return;
    this.stopAutoScroll();
    this.autoScrollDirection = direction;

    this.autoScrollInterval = setInterval(() => {
      if (this.drag.type === 'idle') { this.stopAutoScroll(); return; }

      (this.terminal as { scrollLines: (n: number) => void }).scrollLines(
        SelectionManager.AUTO_SCROLL_SPEED * this.autoScrollDirection
      );

      if (!this.end) return;
      const dims = this.wasmTerm.getDimensions();
      if (this.autoScrollDirection < 0) {
        const topRow = this.viewportRowToAbsolute(0);
        if (topRow < this.end.absoluteRow) this.end = { col: 0, absoluteRow: topRow };
      } else {
        const bottomRow = this.viewportRowToAbsolute(dims.rows - 1);
        if (bottomRow > this.end.absoluteRow) {
          this.end = { col: dims.cols - 1, absoluteRow: bottomRow };
        }
      }
    }, SelectionManager.AUTO_SCROLL_INTERVAL_MS);
  }

  private stopAutoScroll(): void {
    if (this.autoScrollInterval !== null) {
      clearInterval(this.autoScrollInterval);
      this.autoScrollInterval = null;
    }
    this.autoScrollDirection = 0;
  }

  // ── Selection mutation helpers ────────────────────────────────────────────

  private setSelection(start: Pos, end: Pos): void {
    this.markRangeDirty();
    this.start = start;
    this.end = end;
  }

  private markRangeDirty(): void {
    const coords = this.normalizeSelection();
    if (!coords) return;
    for (let row = coords.startRow; row <= coords.endRow; row++) {
      this.dirtyRows.add(row);
    }
  }

  private selectWordAt(col: number, row: number): void {
    const range = this.getSemanticRangeAt(col, row);
    if (!range) return;
    const absoluteRow = this.viewportRowToAbsolute(row);
    this.setSelection({ col: range.startCol, absoluteRow }, { col: range.endCol, absoluteRow });
    this.selectionChangedEmitter.fire();
  }

  private selectLineAt(row: number): void {
    const line = this.wasmTerm.getLine(row);
    if (!line) return;

    let endCol = line.length - 1;
    while (endCol > 0) {
      const cell = line[endCol];
      if (cell && cell.codepoint !== 0 && cell.codepoint !== 32) break;
      endCol--;
    }

    const absoluteRow = this.viewportRowToAbsolute(row);
    this.setSelection({ col: 0, absoluteRow }, { col: endCol, absoluteRow });
    this.selectionChangedEmitter.fire();
  }

  // ── Coordinate utilities ──────────────────────────────────────────────────

  private getViewportY(): number {
    const raw =
      typeof (this.terminal as { getViewportY?: () => number }).getViewportY === 'function'
        ? (this.terminal as { getViewportY: () => number }).getViewportY()
        : (this.terminal as { viewportY?: number }).viewportY ?? 0;
    return Math.max(0, Math.floor(raw));
  }

  private viewportRowToAbsolute(viewportRow: number): number {
    return this.wasmTerm.getScrollbackLength() + viewportRow - this.getViewportY();
  }

  private absoluteRowToViewport(absoluteRow: number): number {
    return absoluteRow - this.wasmTerm.getScrollbackLength() + this.getViewportY();
  }

  private pixelToCell(x: number, y: number): { col: number; row: number } {
    const metrics = this.renderer.getMetrics();
    return {
      col: Math.max(0, Math.min(Math.floor(x / metrics.width), this.terminal.cols - 1)),
      row: Math.max(0, Math.min(Math.floor(y / metrics.height), this.terminal.rows - 1)),
    };
  }

  private normalizeSelection(): SelectionCoordinates | null {
    if (!this.start || !this.end) return null;

    let { col: startCol, absoluteRow: startAbsRow } = this.start;
    let { col: endCol, absoluteRow: endAbsRow } = this.end;

    if (startAbsRow > endAbsRow || (startAbsRow === endAbsRow && startCol > endCol)) {
      [startCol, endCol] = [endCol, startCol];
      [startAbsRow, endAbsRow] = [endAbsRow, startAbsRow];
    }

    let startRow = this.absoluteRowToViewport(startAbsRow);
    let endRow = this.absoluteRowToViewport(endAbsRow);

    const { rows, cols } = this.wasmTerm.getDimensions();
    if (endRow < 0 || startRow > rows - 1) return null;

    if (startRow < 0) { startRow = 0; startCol = 0; }
    if (endRow > rows - 1) { endRow = rows - 1; endCol = cols - 1; }

    return { startCol, startRow, endCol, endRow };
  }

  // ── Semantic range detection ──────────────────────────────────────────────

  private getSemanticRangeAt(
    col: number,
    row: number
  ): { startCol: number; endCol: number } | null {
    const line = this.wasmTerm.getLine(row);
    if (!line) return null;

    const getChar = (c: number): string => {
      const cell = line[c];
      if (!cell || cell.codepoint === 0) return ' ';
      return String.fromCodePoint(cell.codepoint);
    };

    const ch = getChar(col);
    if (ch === ' ') return null;

    const openToClose: Record<string, string> = {
      '"': '"', "'": "'", '`': '`', '(': ')', '[': ']', '{': '}', '<': '>',
    };
    const closeToOpen: Record<string, string> = {
      '"': '"', "'": "'", '`': '`', ')': '(', ']': '[', '}': '{', '>': '<',
    };

    if (openToClose[ch]) {
      const close = openToClose[ch];
      let end = col + 1;
      while (end < line.length && getChar(end) !== close) end++;
      if (end < line.length) return { startCol: col, endCol: end };
    }

    if (closeToOpen[ch]) {
      const open = closeToOpen[ch];
      let start = col - 1;
      while (start >= 0 && getChar(start) !== open) start--;
      if (start >= 0) return { startCol: start, endCol: col };
    }

    const wordChars = /[a-zA-Z0-9_.~\/:@!$&'()*+,;=?#%[\]-]/;
    if (wordChars.test(ch)) {
      let startCol = col;
      let endCol = col;
      while (startCol > 0 && wordChars.test(getChar(startCol - 1))) startCol--;
      while (endCol < line.length - 1 && wordChars.test(getChar(endCol + 1))) endCol++;
      while (endCol > startCol && /[.,;:!?)}\]>]/.test(getChar(endCol))) endCol--;
      return { startCol, endCol };
    }

    return null;
  }
}
