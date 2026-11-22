/**
 * What is behind the app: the warm wash, and the owner's hotel scene, photo or video.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBackground } from '../lib/background';
import { sceneSvg } from '../lib/scene';
import { useThemeName } from '../lib/theme';

/** The drawn hotel scene as an element (also used for the small preview in Settings). */
export function Scene({ uid, className }: { uid: string; className?: string }) {
  const light = useThemeName() === 'light';
  const svg = useMemo(() => sceneSvg(light, uid), [light, uid]);
  return <div className={className ?? 'scene'} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Whether a video should move: not on small phones, not when the person asked for less motion or to save data. */
function videoMayPlay(): boolean {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (window.matchMedia('(max-width: 600px)').matches) return false;
    const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (c?.saveData) return false;
  } catch {
    /* assume yes */
  }
  return true;
}

function BackgroundVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const play = useMemo(videoMayPlay, []);

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [url]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !play) return;
    const sync = () => {
      if (document.hidden) v.pause();
      else void v.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [play, url]);

  if (failed) return null;
  return (
    <video
      key={url}
      ref={ref}
      className={`layer${ready ? ' ready' : ''}`}
      // #t=0.1 makes a paused video show a picture (its first moments) instead of a black box.
      src={play ? url : `${url}#t=0.1`}
      muted
      loop={play}
      autoPlay={play}
      playsInline
      preload={play ? 'auto' : 'metadata'}
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
      onLoadedData={() => setReady(true)}
      // If the browser held back autoplay, ask again as soon as there is enough video to play.
      onCanPlay={(e) => {
        if (play && !document.hidden && e.currentTarget.paused) void e.currentTarget.play().catch(() => undefined);
      }}
      onError={() => setFailed(true)}
      // Some browsers leave a tiny pause at the loop point; restarting by hand on "ended" covers that.
      onEnded={(e) => {
        const v = e.currentTarget;
        v.currentTime = 0;
        void v.play().catch(() => undefined);
      }}
    />
  );
}

function BackgroundImage({ url }: { url: string }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [url]);
  if (failed) return null;
  return <img key={url} className={`layer${ready ? ' ready' : ''}`} src={url} alt="" decoding="async" aria-hidden="true" onLoad={() => setReady(true)} onError={() => setFailed(true)} />;
}

/**
 * Everything behind the app: the warm wash and grain (always), and on top of that the owner's choice of
 * hotel scene, photo or video. If a file cannot load, the plain wash simply stays: nothing breaks.
 */
export function Backdrop({ view }: { view: 'app' | 'login' }) {
  const bg = useBackground();
  const media = bg.kind === 'image' ? 'is-image' : bg.kind === 'video' ? 'is-video' : bg.kind === 'scene' ? 'is-scene' : '';
  return (
    <div className={`bgfx ${view} ${media}`} aria-hidden="true">
      {bg.kind === 'scene' && <Scene uid="bg" className="scene layer ready" />}
      {bg.kind === 'image' && bg.url && <BackgroundImage url={bg.url} />}
      {bg.kind === 'video' && bg.url && <BackgroundVideo url={bg.url} />}
      {media && <div className="shade" />}
    </div>
  );
}
