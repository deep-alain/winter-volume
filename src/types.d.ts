export {};

declare global {
  interface Window {
    /** Replays a fresh seeded engine at a deterministic fixed 60fps clock. */
    __render?: (time: number) => void;
  }
}
