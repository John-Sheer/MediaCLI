import { useRef, useCallback } from "react";

const SWIPE_THRESHOLD = 40;
const SWIPE_MAX_TIME = 400;
const DOUBLE_TAP_DELAY = 300;

export default function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  onTap,
  onDoubleTap,
}) {
  const touchStart = useRef(null);
  const touchStartTime = useRef(0);
  const lastTapTime = useRef(0);
  const tapTimeout = useRef(null);

  const handleTouchStart = useCallback((e) => {
    const target = e.target;
    if (target.closest && target.closest("button, input, textarea, select, a, [role='button'], [role='slider'], [role='tab']")) {
      touchStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    touchStartTime.current = Date.now();
  }, []);

  const handleTouchEnd = useCallback(
    (e) => {
      if (!touchStart.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.current.x;
      const dy = t.clientY - touchStart.current.y;
      const elapsed = Date.now() - touchStartTime.current;
      touchStart.current = null;

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (elapsed < SWIPE_MAX_TIME && (absDx > SWIPE_THRESHOLD || absDy > SWIPE_THRESHOLD)) {
        if (absDx > absDy) {
          if (dx > SWIPE_THRESHOLD) onSwipeRight?.();
          else if (dx < -SWIPE_THRESHOLD) onSwipeLeft?.();
        } else {
          if (dy > SWIPE_THRESHOLD) onSwipeDown?.();
          else if (dy < -SWIPE_THRESHOLD) onSwipeUp?.();
        }
      } else if (absDx < 10 && absDy < 10 && elapsed < 300) {
        const now = Date.now();
        if (now - lastTapTime.current < DOUBLE_TAP_DELAY) {
          if (tapTimeout.current) clearTimeout(tapTimeout.current);
          lastTapTime.current = 0;
          onDoubleTap?.();
        } else {
          lastTapTime.current = now;
          tapTimeout.current = setTimeout(() => {
            onTap?.();
          }, DOUBLE_TAP_DELAY);
        }
      }
    },
    [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, onTap, onDoubleTap]
  );

  return { handleTouchStart, handleTouchEnd };
}
