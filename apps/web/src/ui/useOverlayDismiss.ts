import { useRef } from 'react';
import type { MouseEvent } from 'react';

/**
 * Schließen per Klick auf den Hintergrund — aber nur, wenn der Klick dort auch
 * BEGONNEN hat.
 *
 * Ohne diese Bedingung reicht ein `onClick` auf dem Overlay: markiert man einen
 * Feldwert mit gedrückter Maustaste und lässt sie einen Pixel neben dem Dialog
 * los, feuert der Klick auf dem Overlay — der Dialog schließt und die Eingabe
 * ist verloren. Genau das passiert beim Überschreiben eines Wertes ständig.
 */
export function useOverlayDismiss(onDismiss: () => void) {
  const startedOnOverlay = useRef(false);
  return {
    onMouseDown: (e: MouseEvent) => { startedOnOverlay.current = e.target === e.currentTarget; },
    onClick: (e: MouseEvent) => {
      if (startedOnOverlay.current && e.target === e.currentTarget) onDismiss();
      startedOnOverlay.current = false;
    },
  };
}
