import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { BACKGROUND_LIMITS } from '../../shared/types';
import type { BackgroundKind } from '../../shared/types';
import { Scene } from '../appearance';
import { setBackground, useBackground } from '../lib/background';
import { errText } from '../lib/format';
import { applyTheme, useThemeName } from '../lib/theme';
import { useStore } from '../store';
import { Icon } from '../ui';

const MB = 1048576;

/* ---------- dark / light: every person, saved for them on this device ---------- */

export function ThemeCard() {
  const { staff } = useStore();
  const theme = useThemeName();
  const pick = (t: 'dark' | 'light') => applyTheme(t, staff?.username ?? '');
  return (
    <section className="card anim">
      <div className="card-h">
        <div>
          <h3>Appearance</h3>
          <p className="sub">Dark or light. Haveli remembers your choice the next time you sign in.</p>
        </div>
      </div>
      <div className="opts" role="radiogroup" aria-label="Theme">
        <button type="button" role="radio" aria-checked={theme === 'dark'} className={`opt${theme === 'dark' ? ' on' : ''}`} onClick={() => pick('dark')}>
          <span className="opt-sw s-dark"><Icon name="moon" /></span>
          <b>Dark</b>
          <small>Warm and easy on the eyes. The default.</small>
        </button>
        <button type="button" role="radio" aria-checked={theme === 'light'} className={`opt${theme === 'light' ? ' on' : ''}`} onClick={() => pick('light')}>
          <span className="opt-sw s-light"><Icon name="sun" /></span>
          <b>Light</b>
          <small>Bright, for a sunny front desk.</small>
        </button>
      </div>
    </section>
  );
}

/* ---------- the website background: owner only ---------- */

/** Reads how long a video is, in the browser, before it is uploaded. Null when the browser cannot tell. */
function videoLength(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (n: number | null) => {
      v.removeAttribute('src');
      v.load();
      resolve(n);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

const CHOICES: { kind: BackgroundKind; title: string; text: string }[] = [
  { kind: 'none', title: 'Plain', text: 'The Clay & Sand theme on its own. The default.' },
  { kind: 'scene', title: 'Hotel scene', text: 'A drawn haveli at dusk, softly moving.' },
  { kind: 'image', title: 'Photo', text: 'Your own hotel photo.' },
  { kind: 'video', title: 'Video', text: `A looping clip, up to ${BACKGROUND_LIMITS.videoSeconds} seconds.` },
];

export function BackgroundCard() {
  const { backend, staff, toast } = useStore();
  const current = useBackground();
  const [choice, setChoice] = useState<BackgroundKind>(current.kind);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Show what is saved whenever someone else (or another tab) changes it and nothing is being edited here.
  useEffect(() => {
    if (!file) setChoice(current.kind);
  }, [current.kind, current.version, file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!staff?.owner) return null;

  function choose(kind: BackgroundKind) {
    setChoice(kind);
    setError('');
    if (kind !== 'image' && kind !== 'video') clearFile();
    else if (file && (file.type.startsWith('video/') ? 'video' : 'image') !== kind) clearFile();
  }
  function clearFile() {
    setFile(null);
    setPreview(null);
    if (input.current) input.current.value = '';
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    const isVideo = choice === 'video';
    const allowed: readonly string[] = isVideo ? BACKGROUND_LIMITS.videoTypes : BACKGROUND_LIMITS.imageTypes;
    const max = isVideo ? BACKGROUND_LIMITS.videoBytes : BACKGROUND_LIMITS.imageBytes;
    const problem = (msg: string) => {
      setError(msg);
      clearFile();
    };
    if (!allowed.includes(f.type)) return problem(isVideo ? 'Please choose an MP4 or WebM video.' : 'Please choose a JPG, PNG or WebP photo.');
    if (f.size > max) return problem(`That ${isVideo ? 'video' : 'photo'} is ${(f.size / MB).toFixed(1)} MB. The limit is ${Math.round(max / MB)} MB.`);
    const url = URL.createObjectURL(f);
    if (isVideo) {
      const len = await videoLength(url);
      // If this browser cannot read the length (some cannot open every format), the server checks it properly on upload.
      if (len !== null && len > BACKGROUND_LIMITS.videoSeconds + 0.15) {
        URL.revokeObjectURL(url);
        return problem(`That video is ${Math.ceil(len)} seconds long. The limit is ${BACKGROUND_LIMITS.videoSeconds} seconds.`);
      }
    }
    setFile(f);
    setPreview(url);
  }

  const media = choice === 'image' || choice === 'video';
  const savedSame = current.kind === choice && (!media || (!file && !!current.url));
  const canSave = !busy && !savedSame && (!media || !!file);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const r = media && file ? await backend.uploadBackground(choice as 'image' | 'video', file) : await backend.setBackground(choice as 'none' | 'scene');
      setBackground(r.background);
      clearFile();
      toast(r.background.kind === 'none' ? 'Background removed. Everyone now sees the plain theme.' : 'Background saved. Everyone sees it now.');
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  }

  const shown = file ? preview : current.kind === choice ? current.url : null;

  return (
    <section className="card anim wide-card" id="background">
      <div className="card-h">
        <div>
          <h3>Website background</h3>
          <p className="sub">Only you can change this. Whatever you save is shown to every employee, including on the sign-in screen.</p>
        </div>
      </div>
      <div className="opts" role="radiogroup" aria-label="Background">
        {CHOICES.map((c) => (
          <button key={c.kind} type="button" role="radio" aria-checked={choice === c.kind} className={`opt${choice === c.kind ? ' on' : ''}`} onClick={() => choose(c.kind)}>
            <span className={`opt-sw ${c.kind === 'none' ? 's-plain' : c.kind === 'scene' ? 's-scene' : ''}`}>
              {c.kind === 'image' && <Icon name="image" />}
              {c.kind === 'video' && <Icon name="video" />}
            </span>
            <b>{c.title}</b>
            <small>{c.text}</small>
          </button>
        ))}
      </div>

      {(media || choice === 'scene' || choice === 'none') && (
        <div style={{ marginTop: 16, display: 'grid', gap: 12, maxWidth: 560 }}>
          <div className={`bgprev${choice === 'none' ? ' s-plain' : ''}`} aria-label="Preview">
            {choice === 'scene' && <Scene uid="pv" className="scene" />}
            {choice === 'image' && shown && <img src={shown} alt="Preview of the background photo" />}
            {choice === 'video' && shown && <video key={shown} src={shown} muted loop autoPlay playsInline />}
            {media && !shown && <span className="hintline">{choice === 'image' ? 'No photo chosen yet.' : 'No video chosen yet.'}</span>}
          </div>
          {media && (
            <>
              <div className="stack">
                <label className="btn soft filebtn">
                  <Icon name="upload" />
                  {file ? 'Choose a different file' : choice === 'image' ? 'Choose a photo…' : 'Choose a video…'}
                  <input
                    ref={input}
                    type="file"
                    accept={choice === 'image' ? BACKGROUND_LIMITS.imageTypes.join(',') : BACKGROUND_LIMITS.videoTypes.join(',')}
                    onChange={(e) => void onFile(e)}
                    aria-label={choice === 'image' ? 'Choose a background photo' : 'Choose a background video'}
                  />
                </label>
                {file && <span className="hintline">{file.name} · {(file.size / MB).toFixed(1)} MB</span>}
              </div>
              <p className="hintline">
                {choice === 'image'
                  ? `JPG, PNG or WebP, up to ${Math.round(BACKGROUND_LIMITS.imageBytes / MB)} MB. A wide, bright-but-calm photo works best.`
                  : `MP4 or WebM, up to ${BACKGROUND_LIMITS.videoSeconds} seconds and ${Math.round(BACKGROUND_LIMITS.videoBytes / MB)} MB, without sound. Best: 1080p, H.264, a clip that begins and ends on a similar frame so the loop looks seamless. On small phones the first picture is shown instead of the video.`}
              </p>
            </>
          )}
          {error && <p className="errline" role="alert">{error}</p>}
          <div className="stack">
            <button type="button" className="btn primary" disabled={!canSave} onClick={() => void save()}>
              <Icon name="check" />
              {busy ? 'Saving…' : choice === 'none' ? 'Use the plain theme' : 'Save background'}
            </button>
            {savedSame && current.kind !== 'none' && <span className="okline">Saved and showing for everyone.</span>}
            {backend.mode === 'demo' && <span className="hintline">Demo only: not kept after you close this page.</span>}
          </div>
          <p className="hintline">Only one background is kept: saving a new one replaces the old one. Files are stored in the “media” folder next to the app, so include that folder in your backups.</p>
        </div>
      )}
    </section>
  );
}
