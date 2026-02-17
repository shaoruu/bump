/**
 * Selection Manager - Handles text selection in the terminal
 *
 * Features:
 * - Mouse drag selection
 * - Double-click word selection
 * - Text extraction from terminal buffer
 * - Automatic clipboard copy
 * - Visual selection highlighting (integrated into CanvasRenderer cell rendering)
 * - Auto-scroll during drag selection
 */

import { EventEmitter } from './event-emitter';
import type { GhosttyTerminal } from './ghostty';
import type { IEvent } from './interfaces';
import type { CanvasRenderer } from './renderer';
import type { Terminal } from './terminal';
import type { GhosttyCell } from './types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SelectionCoordinates {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

// ============================================================================
// SelectionManager Class
// ============================================================================

export class SelectionManager {
  private terminal: Terminal;
  private renderer: CanvasRenderer;
  private wasmTerm: GhosttyTerminal;
  private textarea: HTMLTextAreaElement;

  // Selection state - coordinates are in ABSOLUTE buffer space (viewportY + viewportRow)
  // This ensures selection persists correctly when scrolling
  private selectionStart: { col: number; absoluteRow: number } | null = null;
  private selectionEnd: { col: number; absoluteRow: number } | null = null;
  private isSelecting: boolean = false;
  private mouseDownTarget: EventTarget | null = null; // Track where mousedown occurred

  // Track rows that need redraw for clearing old selection
  // Using a Set prevents the overwrite bug where mousemove would clobber
  // the rows marked by clearSelection()
  private dirtySelectionRows: Set<number> = new Set();

  // Event emitter
  private selectionChangedEmitter = new EventEmitter<void>();

  // Store bound event handlers for cleanup
  private boundMouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private boundContextMenuHandler: ((e: MouseEvent) => void) | null = null;
  private boundClickHandler: ((e: MouseEvent) => void) | null = null;
  private boundDocumentMouseMoveHandler: ((e: MouseEvent) => void) | null = null;

  // Auto-scroll state for drag selection
  private autoScrollInterval: ReturnType<typeof setInterval> | null = null;
  private autoScrollDirection: number = 0; // -1 = up, 0 = none, 1 = down
  private static readonly AUTO_SCROLL_EDGE_SIZE = 30; // pixels from edge to trigger scroll

  /**
   * Get current viewport Y position (how many lines scrolled into history)
   */
  private getViewportY(): number {
    const rawViewportY =
      typeof (this.terminal as any).getViewportY === 'function'
        ? (this.terminal as any).getViewportY()
        : (this.terminal as any).viewportY || 0;
    return Math.max(0, Math.floor(rawViewportY));
  }

  /**
   * Convert viewport row to absolute buffer row
   * Absolute row is an index into combined buffer: scrollback (0 to len-1) + screen (len to len+rows-1)
   */
  private viewportRowToAbsolute(viewportRow: number): number {
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    const viewportY = this.getViewportY();
    return scrollbackLength + viewportRow - viewportY;
  }

  /**
   * Convert absolute buffer row to viewport row (may be outside visible range)
   */
  private absoluteRowToViewport(absoluteRow: number): number {
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    const viewportY = this.getViewportY();
    return absoluteRow - scrollbackLength + viewportY;
  }
  private static readonly AUTO_SCROLL_SPEED = 3; // lines per interval
  private static readonly AUTO_SCROLL_INTERVAL = 50; // ms between scroll steps

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

    // Attach mouse event listeners
    this.attachEventListeners();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get the selected text as a string
   */
  getSelection(): string {
    if (!this.selectionStart || !this.selectionEnd) return '';

    // Get absolute row coordinates (not clamped to viewport)
    let { col: startCol, absoluteRow: startAbsRow } = this.selectionStart;
    let { col: endCol, absoluteRow: endAbsRow } = this.selectionEnd;

    // Swap if selection goes backwards
    if (startAbsRow > endAbsRow || (startAbsRow === endAbsRow && startCol > endCol)) {
      [startCol, endCol] = [endCol, startCol];
      [startAbsRow, endAbsRow] = [endAbsRow, startAbsRow];
    }

    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    let text = '';

    for (let absRow = startAbsRow; absRow <= endAbsRow; absRow++) {
      // Fetch line based on absolute row position
      // Absolute row < scrollbackLength means it's in scrollback
      // Absolute row >= scrollbackLength means it's in the screen buffer
      let line: GhosttyCell[] | null = null;

      if (absRow < scrollbackLength) {
        // Row is in scrollback
        line = this.wasmTerm.getScrollbackLine(absRow);
      } else {
        // Row is in screen buffer
        const screenRow = absRow - scrollbackLength;
        line = this.wasmTerm.getLine(screenRow);
      }

      if (!line) continue;

      // Track the last non-empty column for trimming trailing spaces
      let lastNonEmpty = -1;

      // Determine column range for this row
      const colStart = absRow === startAbsRow ? startCol : 0;
      const colEnd = absRow === endAbsRow ? endCol : line.length - 1;

      // Build the line text
      let lineText = '';
      for (let col = colStart; col <= colEnd; col++) {
        const cell = line[col];
        if (cell && cell.codepoint !== 0) {
          // Use grapheme lookup for cells with multi-codepoint characters
          let char: string;
          if (cell.grapheme_len > 0) {
            // Row is in scrollback or screen - determine which and use appropriate method
            if (absRow < scrollbackLength) {
              char = this.wasmTerm.getScrollbackGraphemeString(absRow, col);
            } else {
              const screenRow = absRow - scrollbackLength;
              char = this.wasmTerm.getGraphemeString(screenRow, col);
            }
          } else {
            char = String.fromCodePoint(cell.codepoint);
          }
          lineText += char;
          if (char.trim()) {
            lastNonEmpty = lineText.length;
          }
        } else {
          lineText += ' ';
        }
      }

      // Trim trailing spaces from each line
      if (lastNonEmpty >= 0) {
        lineText = lineText.substring(0, lastNonEmpty);
      } else {
        lineText = '';
      }

      text += lineText;

      // Add newline between rows (but not after the last row)
      if (absRow < endAbsRow) {
        text += '\n';
      }
    }

    return text;
  }

  /**
   * Check if there's an active selection
   */
  hasSelection(): boolean {
    if (!this.selectionStart || !this.selectionEnd) return false;

    // Check if start and end are the same (single cell, no real selection)
    return !(
      this.selectionStart.col === this.selectionEnd.col &&
      this.selectionStart.absoluteRow === this.selectionEnd.absoluteRow
    );
  }

  /**
   * Copy the current selection to clipboard
   * @returns true if there was text to copy, false otherwise
   */
  copySelection(): boolean {
    if (!this.hasSelection()) return false;

    const text = this.getSelection();
    if (text) {
      this.copyToClipboard(text);
      return true;
    }
    return false;
  }

  /**
   * Clear the selection
   */
  clearSelection(): void {
    if (!this.hasSelection()) return;

    // Mark current selection rows as dirty for redraw
    const coords = this.normalizeSelection();
    if (coords) {
      for (let row = coords.startRow; row <= coords.endRow; row++) {
        this.dirtySelectionRows.add(row);
      }
    }

    this.selectionStart = null;
    this.selectionEnd = null;
    this.isSelecting = false;

    // Force redraw of previously selected lines to clear the overlay
    this.requestRender();
  }

  /**
   * Select all text in the terminal (entire buffer including scrollback)
   */
  selectAll(): void {
    const dims = this.wasmTerm.getDimensions();
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    this.selectionStart = { col: 0, absoluteRow: 0 };
    this.selectionEnd = { col: dims.cols - 1, absoluteRow: scrollbackLength + dims.rows - 1 };
    this.requestRender();
    this.selectionChangedEmitter.fire();
  }

  /**
   * Select text at specific column and row with length
   * xterm.js compatible API
   */
  select(column: number, row: number, length: number): void {
    // Clamp to valid ranges
    const dims = this.wasmTerm.getDimensions();
    row = Math.max(0, Math.min(row, dims.rows - 1));
    column = Math.max(0, Math.min(column, dims.cols - 1));

    // Calculate end position
    let endRow = row;
    let endCol = column + length - 1;

    // Handle wrapping if selection extends past end of line
    while (endCol >= dims.cols) {
      endCol -= dims.cols;
      endRow++;
    }

    // Clamp end row
    endRow = Math.min(endRow, dims.rows - 1);

    // Convert viewport rows to absolute rows
    const viewportY = this.getViewportY();
    this.selectionStart = { col: column, absoluteRow: viewportY + row };
    this.selectionEnd = { col: endCol, absoluteRow: viewportY + endRow };
    this.requestRender();
    this.selectionChangedEmitter.fire();
  }

  /**
   * Select entire lines from start to end
   * xterm.js compatible API
   */
  selectLines(start: number, end: number): void {
    const dims = this.wasmTerm.getDimensions();

    // Clamp to valid row ranges
    start = Math.max(0, Math.min(start, dims.rows - 1));
    end = Math.max(0, Math.min(end, dims.rows - 1));

    // Ensure start <= end
    if (start > end) {
      [start, end] = [end, start];
    }

    // Convert viewport rows to absolute rows
    const viewportY = this.getViewportY();
    this.selectionStart = { col: 0, absoluteRow: viewportY + start };
    this.selectionEnd = { col: dims.cols - 1, absoluteRow: viewportY + end };
    this.requestRender();
    this.selectionChangedEmitter.fire();
  }

  /**
   * Get selection position as buffer range
   * xterm.js compatible API
   */
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

  /**
   * Deselect all text
   * xterm.js compatible API
   */
  deselect(): void {
    this.clearSelection();
    this.selectionChangedEmitter.fire();
  }

  /**
   * Focus the terminal (make it receive keyboard input)
   */
  focus(): void {
    const canvas = this.renderer.getCanvas();
    if (canvas.parentElement) {
      canvas.parentElement.focus();
    }
  }

  /**
   * Get current selection coordinates (for rendering)
   */
  getSelectionCoords(): SelectionCoordinates | null {
    return this.normalizeSelection();
  }

  /**
   * Get dirty selection rows that need redraw (for clearing old highlight)
   */
  getDirtySelectionRows(): Set<number> {
    return this.dirtySelectionRows;
  }

  /**
   * Clear the dirty selection rows tracking (after redraw)
   */
  clearDirtySelectionRows(): void {
    this.dirtySelectionRows.clear();
  }

  /**
   * Get selection change event accessor
   */
  get onSelectionChange(): IEvent<void> {
    return this.selectionChangedEmitter.event;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.selectionChangedEmitter.dispose();

    // Stop auto-scroll if active
    this.stopAutoScroll();

    // Clean up document event listener
    if (this.boundMouseUpHandler) {
      document.removeEventListener('mouseup', this.boundMouseUpHandler);
      this.boundMouseUpHandler = null;
    }

    // Clean up document mousemove listener
    if (this.boundDocumentMouseMoveHandler) {
      document.removeEventListener('mousemove', this.boundDocumentMouseMoveHandler);
      this.boundDocumentMouseMoveHandler = null;
    }

    // Clean up context menu event listener
    if (this.boundContextMenuHandler) {
      const canvas = this.renderer.getCanvas();
      canvas.removeEventListener('contextmenu', this.boundContextMenuHandler);
      this.boundContextMenuHandler = null;
    }

    // Clean up document click listener
    if (this.boundClickHandler) {
      document.removeEventListener('click', this.boundClickHandler);
      this.boundClickHandler = null;
    }

    // Canvas event listeners will be cleaned up when canvas is removed from DOM
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Attach mouse event listeners to canvas
   */
  private attachEventListeners(): void {
    const canvas = this.renderer.getCanvas();

    // Mouse down - start selection or clear existing
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0) {
        if (canvas.parentElement) {
          canvas.parentElement.focus();
        }

        // Skip selection on Cmd/Ctrl+click so link activation works
        if (e.metaKey || e.ctrlKey) {
          return;
        }

        const cell = this.pixelToCell(e.offsetX, e.offsetY);

        const hadSelection = this.hasSelection();
        if (hadSelection) {
          this.clearSelection();
        }

        const absoluteRow = this.viewportRowToAbsolute(cell.row);
        this.selectionStart = { col: cell.col, absoluteRow };
        this.selectionEnd = { col: cell.col, absoluteRow };
        this.isSelecting = true;
      }
    });

    // Mouse move on canvas - update selection
    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isSelecting) {
        // Mark current selection rows as dirty before updating
        this.markCurrentSelectionDirty();

        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        const absoluteRow = this.viewportRowToAbsolute(cell.row);
        this.selectionEnd = { col: cell.col, absoluteRow };
        this.requestRender();

        // Check if near edges for auto-scroll
        this.updateAutoScroll(e.offsetY, canvas.clientHeight);
      }
    });

    // Mouse leave - check for auto-scroll when leaving canvas during drag
    canvas.addEventListener('mouseleave', (e: MouseEvent) => {
      if (this.isSelecting) {
        // Determine scroll direction based on where mouse left
        const rect = canvas.getBoundingClientRect();
        if (e.clientY < rect.top) {
          this.startAutoScroll(-1); // Scroll up
        } else if (e.clientY > rect.bottom) {
          this.startAutoScroll(1); // Scroll down
        }
      }
    });

    // Mouse enter - stop auto-scroll when mouse returns to canvas
    canvas.addEventListener('mouseenter', () => {
      if (this.isSelecting) {
        this.stopAutoScroll();
      }
    });

    // Document-level mousemove for tracking mouse position during drag outside canvas
    this.boundDocumentMouseMoveHandler = (e: MouseEvent) => {
      if (this.isSelecting) {
        const rect = canvas.getBoundingClientRect();

        // Update selection based on clamped position
        const clampedX = Math.max(rect.left, Math.min(e.clientX, rect.right));
        const clampedY = Math.max(rect.top, Math.min(e.clientY, rect.bottom));

        // Convert to canvas-relative coordinates
        const offsetX = clampedX - rect.left;
        const offsetY = clampedY - rect.top;

        // Only update if mouse is outside the canvas
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        ) {
          // Update auto-scroll direction based on mouse position
          if (e.clientY < rect.top) {
            this.startAutoScroll(-1);
          } else if (e.clientY > rect.bottom) {
            this.startAutoScroll(1);
          } else {
            this.stopAutoScroll();
          }

          // Only update selection position if NOT auto-scrolling
          // During auto-scroll, the scroll handler extends the selection
          if (this.autoScrollDirection === 0) {
            // Mark current selection rows as dirty before updating
            this.markCurrentSelectionDirty();

            const cell = this.pixelToCell(offsetX, offsetY);
            const absoluteRow = this.viewportRowToAbsolute(cell.row);
            this.selectionEnd = { col: cell.col, absoluteRow };
            this.requestRender();
          }
        }
      }
    };
    document.addEventListener('mousemove', this.boundDocumentMouseMoveHandler);

    // Track mousedown on document to know if a click started inside the canvas
    document.addEventListener('mousedown', (e: MouseEvent) => {
      this.mouseDownTarget = e.target;
    });

    // CRITICAL FIX: Listen for mouseup on DOCUMENT, not just canvas
    // This catches mouseup events that happen outside the canvas (common during drag)
    this.boundMouseUpHandler = (e: MouseEvent) => {
      if (this.isSelecting) {
        this.isSelecting = false;
        this.stopAutoScroll();
        this.selectionChangedEmitter.fire();
      }
    };
    document.addEventListener('mouseup', this.boundMouseUpHandler);

    canvas.addEventListener('click', (e: MouseEvent) => {
      if (e.detail === 2) {
        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        this.selectWordAt(cell.col, cell.row);
      } else if (e.detail === 3) {
        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        this.selectLineAt(cell.row);
      }
    });

    this.boundContextMenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      
      if (!this.hasSelection()) {
        const cell = this.pixelToCell(e.offsetX, e.offsetY);
        this.selectWordAt(cell.col, cell.row);
      }
      
      const canvas = this.renderer.getCanvas();
      canvas.dispatchEvent(new CustomEvent("terminal-context-menu", {
        bubbles: true,
        detail: { x: e.clientX, y: e.clientY },
      }));
    };

    canvas.addEventListener('contextmenu', this.boundContextMenuHandler);

    // Click outside canvas - clear selection
    // This allows users to deselect by clicking anywhere outside the terminal
    this.boundClickHandler = (e: MouseEvent) => {
      // Don't clear selection if we're actively selecting
      if (this.isSelecting) {
        return;
      }

      // A click is only valid for clearing selection if BOTH mousedown and mouseup
      // happened outside the canvas. If mousedown was inside (drag selection),
      // don't clear even if mouseup/click is outside.
      const mouseDownWasInCanvas =
        this.mouseDownTarget && canvas.contains(this.mouseDownTarget as Node);
      if (mouseDownWasInCanvas) {
        return;
      }

      // Check if the click is outside the canvas
      const target = e.target as Node;
      if (!canvas.contains(target)) {
        // Clicked outside the canvas - clear selection
        if (this.hasSelection()) {
          this.clearSelection();
        }
      }
    };

    document.addEventListener('click', this.boundClickHandler);
  }

  /**
   * Mark current selection rows as dirty for redraw
   */
  private markCurrentSelectionDirty(): void {
    const coords = this.normalizeSelection();
    if (coords) {
      for (let row = coords.startRow; row <= coords.endRow; row++) {
        this.dirtySelectionRows.add(row);
      }
    }
  }

  /**
   * Update auto-scroll based on mouse Y position within canvas
   */
  private updateAutoScroll(offsetY: number, canvasHeight: number): void {
    const edgeSize = SelectionManager.AUTO_SCROLL_EDGE_SIZE;

    if (offsetY < edgeSize) {
      // Near top edge - scroll up
      this.startAutoScroll(-1);
    } else if (offsetY > canvasHeight - edgeSize) {
      // Near bottom edge - scroll down
      this.startAutoScroll(1);
    } else {
      // In middle - stop scrolling
      this.stopAutoScroll();
    }
  }

  /**
   * Start auto-scrolling in the given direction
   */
  private startAutoScroll(direction: number): void {
    // Don't restart if already scrolling in same direction
    if (this.autoScrollInterval !== null && this.autoScrollDirection === direction) {
      return;
    }

    // Stop any existing scroll
    this.stopAutoScroll();

    this.autoScrollDirection = direction;

    // Start scrolling interval
    this.autoScrollInterval = setInterval(() => {
      if (!this.isSelecting) {
        this.stopAutoScroll();
        return;
      }

      // Scroll the terminal to reveal more content in the direction user is dragging
      // autoScrollDirection: -1 = dragging up (wants to see history), 1 = dragging down (wants to see newer)
      // scrollLines convention: negative = scroll up into history, positive = scroll down to newer
      // So direction maps directly to scrollLines sign
      const scrollAmount = SelectionManager.AUTO_SCROLL_SPEED * this.autoScrollDirection;
      (this.terminal as any).scrollLines(scrollAmount);

      // Extend selection in the scroll direction
      // Key insight: we need to EXTEND the selection, not reset it to viewport edge
      if (this.selectionEnd) {
        const dims = this.wasmTerm.getDimensions();
        if (this.autoScrollDirection < 0) {
          // Scrolling up - extend selection upward (decrease absoluteRow)
          // Set to top of viewport, but only if it extends the selection
          const topAbsoluteRow = this.viewportRowToAbsolute(0);
          if (topAbsoluteRow < this.selectionEnd.absoluteRow) {
            this.selectionEnd = { col: 0, absoluteRow: topAbsoluteRow };
          }
        } else {
          // Scrolling down - extend selection downward (increase absoluteRow)
          // Set to bottom of viewport, but only if it extends the selection
          const bottomAbsoluteRow = this.viewportRowToAbsolute(dims.rows - 1);
          if (bottomAbsoluteRow > this.selectionEnd.absoluteRow) {
            this.selectionEnd = { col: dims.cols - 1, absoluteRow: bottomAbsoluteRow };
          }
        }
      }

      this.requestRender();
    }, SelectionManager.AUTO_SCROLL_INTERVAL);
  }

  /**
   * Stop auto-scrolling
   */
  private stopAutoScroll(): void {
    if (this.autoScrollInterval !== null) {
      clearInterval(this.autoScrollInterval);
      this.autoScrollInterval = null;
    }
    this.autoScrollDirection = 0;
  }

  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  private pixelToCell(x: number, y: number): { col: number; row: number } {
    const metrics = this.renderer.getMetrics();

    const col = Math.floor(x / metrics.width);
    const row = Math.floor(y / metrics.height);

    // Clamp to terminal bounds
    return {
      col: Math.max(0, Math.min(col, this.terminal.cols - 1)),
      row: Math.max(0, Math.min(row, this.terminal.rows - 1)),
    };
  }

  /**
   * Normalize selection coordinates (handle backward selection)
   * Returns coordinates in VIEWPORT space for rendering, clamped to visible area
   */
  private normalizeSelection(): SelectionCoordinates | null {
    if (!this.selectionStart || !this.selectionEnd) return null;

    let { col: startCol, absoluteRow: startAbsRow } = this.selectionStart;
    let { col: endCol, absoluteRow: endAbsRow } = this.selectionEnd;

    // Swap if selection goes backwards
    if (startAbsRow > endAbsRow || (startAbsRow === endAbsRow && startCol > endCol)) {
      [startCol, endCol] = [endCol, startCol];
      [startAbsRow, endAbsRow] = [endAbsRow, startAbsRow];
    }

    // Convert to viewport coordinates
    let startRow = this.absoluteRowToViewport(startAbsRow);
    let endRow = this.absoluteRowToViewport(endAbsRow);

    // Clamp to visible viewport range
    const dims = this.wasmTerm.getDimensions();
    const maxRow = dims.rows - 1;

    // If entire selection is outside viewport, return null
    if (endRow < 0 || startRow > maxRow) {
      return null;
    }

    // Clamp rows to visible range, adjusting columns for partial rows
    if (startRow < 0) {
      startRow = 0;
      startCol = 0; // Selection starts from beginning of first visible row
    }
    if (endRow > maxRow) {
      endRow = maxRow;
      endCol = dims.cols - 1; // Selection extends to end of last visible row
    }

    return { startCol, startRow, endCol, endRow };
  }

  private selectWordAt(col: number, row: number): void {
    const range = this.getSemanticRangeAt(col, row);
    if (range) {
      const absoluteRow = this.viewportRowToAbsolute(row);
      this.selectionStart = { col: range.startCol, absoluteRow };
      this.selectionEnd = { col: range.endCol, absoluteRow };
      this.requestRender();
      this.selectionChangedEmitter.fire();
    }
  }

  private selectLineAt(row: number): void {
    const line = this.wasmTerm.getLine(row);
    if (!line) return;

    let startCol = 0;
    let endCol = line.length - 1;

    while (endCol > 0) {
      const cell = line[endCol];
      if (cell && cell.codepoint !== 0 && cell.codepoint !== 32) break;
      endCol--;
    }

    const absoluteRow = this.viewportRowToAbsolute(row);
    this.selectionStart = { col: startCol, absoluteRow };
    this.selectionEnd = { col: endCol, absoluteRow };
    this.requestRender();
    this.selectionChangedEmitter.fire();
  }

  private getSemanticRangeAt(col: number, row: number): { startCol: number; endCol: number } | null {
    const line = this.wasmTerm.getLine(row);
    if (!line) return null;

    const getChar = (c: number): string => {
      const cell = line[c];
      if (!cell || cell.codepoint === 0) return ' ';
      return String.fromCodePoint(cell.codepoint);
    };

    const clickedChar = getChar(col);

    if (clickedChar === ' ') return null;

    const quotePairs: Record<string, string> = { '"': '"', "'": "'", '`': '`', '(': ')', '[': ']', '{': '}', '<': '>' };
    if (quotePairs[clickedChar]) {
      const closeChar = quotePairs[clickedChar];
      let endCol = col + 1;
      while (endCol < line.length && getChar(endCol) !== closeChar) {
        endCol++;
      }
      if (endCol < line.length) {
        return { startCol: col, endCol };
      }
    }

    const closeToOpen: Record<string, string> = { '"': '"', "'": "'", '`': '`', ')': '(', ']': '[', '}': '{', '>': '<' };
    if (closeToOpen[clickedChar]) {
      const openChar = closeToOpen[clickedChar];
      let startCol = col - 1;
      while (startCol >= 0 && getChar(startCol) !== openChar) {
        startCol--;
      }
      if (startCol >= 0) {
        return { startCol, endCol: col };
      }
    }

    const pathUrlChars = /[a-zA-Z0-9_.~\/:@!$&'()*+,;=?#%[\]-]/;
    if (pathUrlChars.test(clickedChar)) {
      let startCol = col;
      let endCol = col;

      while (startCol > 0 && pathUrlChars.test(getChar(startCol - 1))) {
        startCol--;
      }
      while (endCol < line.length - 1 && pathUrlChars.test(getChar(endCol + 1))) {
        endCol++;
      }

      while (endCol > startCol) {
        const c = getChar(endCol);
        if (/[.,;:!?)}\]>]/.test(c)) {
          endCol--;
        } else {
          break;
        }
      }

      return { startCol, endCol };
    }

    return null;
  }

  private copyToClipboard(text: string): void {
    window.bump.copyToClipboard(text);
  }

  /**
   * Request a render update (triggers selection overlay redraw)
   */
  private requestRender(): void {
    // The render loop will automatically pick up the new selection state
    // and redraw the affected lines. This happens at 60fps.
    //
    // Note: When clearSelection() is called, it adds dirty rows to dirtySelectionRows
    // which the renderer can use to know which lines to redraw.
  }
}
