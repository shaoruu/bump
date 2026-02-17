import { useState, useCallback } from "react";

export type Position = { x: number; y: number };

export function useMenuPosition<T = Position>(): [T | null, (pos: T) => void, () => void] {
  const [position, setPosition] = useState<T | null>(null);
  const open = useCallback((pos: T) => setPosition(pos), []);
  const close = useCallback(() => setPosition(null), []);
  return [position, open, close];
}
