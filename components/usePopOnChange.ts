"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A counter that increments when `value` changes, for figures that should land
 * rather than blink: put it on the element's `key` so it remounts and replays
 * its entry animation, and only add `pop-in` once it is above zero, so a number
 * that was already on screen when the page loaded stays still.
 *
 *   const pop = usePopOnChange(amount);
 *   <p key={pop} className={cn("tnum", pop > 0 && "pop-in")}>{amount}</p>
 */
export function usePopOnChange(value: unknown): number {
  const [tick, setTick] = useState(0);
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setTick((n) => n + 1);
  }, [value]);
  return tick;
}
