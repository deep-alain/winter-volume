import { useEffect, useRef } from 'react';
import { mountEngine } from './engine';

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLSpanElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const value = useRef<HTMLOutputElement>(null);

  useEffect(() => {
    if (!canvas.current || !slider.current || !status.current || !room.current || !value.current) return;
    const engine = mountEngine({
      canvas: canvas.current,
      slider: slider.current,
      status: status.current,
      room: room.current,
      value: value.current,
    });
    const render = (time: number) => engine.renderAt(time);
    window.__render = render;
    return () => {
      if (window.__render === render) delete window.__render;
      engine.dispose();
    };
  }, []);

  return (
    <div className="room" ref={room}>
      <main className="instrument" aria-labelledby="scene-title">
        <header className="caption">
          <p className="eyebrow">一段藏在音量里的冬天</p>
          <h1 id="scene-title">把声音，送进冬天。</h1>
        </header>

        <div className="control-frame">
          <canvas ref={canvas} width={96} height={176} aria-hidden="true" />
          <input
            ref={slider}
            className="volume-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            defaultValue="50"
            aria-label="冬日音量"
            aria-orientation="vertical"
            aria-describedby="volume-help"
          />
        </div>

        <div className="readout" aria-hidden="true">
          <span>音量</span>
          <output ref={value}>50%</output>
        </div>
        <p className="help" id="volume-help">向上拖动 · 方向键调节 · Home / End</p>
        <span ref={status} className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          音量 50%
        </span>
      </main>
    </div>
  );
}
