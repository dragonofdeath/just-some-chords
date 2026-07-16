// Screen wake lock that survives iPhones.
//
// Layer 1 — the standard Wake Lock API. Supported in Safari since 16.4, BUT
// broken inside home-screen (standalone) web apps until iOS 18.4 (WebKit bug
// 254545), and requests reject when the page is hidden or outside a fresh
// user gesture. Layer 2 — the NoSleep trick: a tiny muted playsinline video
// kept "playing" (iOS never sleeps the screen during video playback). The
// fallback engages whenever the API is missing, rejects, or the OS releases
// the lock while we still want it.
//
// Call enableWakeLock() SYNCHRONOUSLY inside the tap that starts playback —
// before any await — so both layers run inside the user activation window.

let wanted = false;
let sentinel: { release: () => Promise<void>; addEventListener: Function } | null = null;
let requesting = false;
let video: HTMLVideoElement | null = null;

// 1.7KB of black 64×64 H.264 (generated with ffmpeg, no audio track).
const AWAKE_MP4 =
  "data:video/mp4;base64," +
  "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";

function startVideoFallback() {
  if (!wanted) return;
  if (!video) {
    video = document.createElement("video");
    video.setAttribute("playsinline", "");
    video.muted = true;
    video.setAttribute("muted", "");
    video.disableRemotePlayback = true;
    video.src = AWAKE_MP4;
    // never let it end — ending would drop the "video is playing" state that
    // keeps the screen on; random re-seek defeats short-loop detection
    video.addEventListener("timeupdate", () => {
      if (video && video.currentTime > 2) video.currentTime = Math.random();
    });
    video.style.cssText = "position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
  }
  video.play().catch(() => {
    // autoplay blocked outside a gesture — the next enable/visibility retry
  });
}

function stopVideoFallback() {
  video?.pause();
}

async function requestSentinel() {
  if (!wanted || requesting || document.visibilityState !== "visible") return;
  requesting = true;
  try {
    const s = await (navigator as any).wakeLock?.request("screen");
    if (!s) throw new Error("unsupported");
    if (!wanted) {
      s.release();
    } else {
      sentinel = s;
      stopVideoFallback(); // the real lock is held — no need for the video
      s.addEventListener("release", () => {
        sentinel = null;
        // released while we still want it (tab hidden, low battery, iOS
        // being iOS) — hold the screen with the video until re-acquired
        if (wanted) startVideoFallback();
      });
    }
  } catch {
    if (wanted) startVideoFallback();
  }
  requesting = false;
}

/** Keep the screen on. Call synchronously inside the user's tap. */
export function enableWakeLock(): void {
  wanted = true;
  // start the fallback inside the gesture (muted video autoplay is allowed
  // anyway, but this is the safest window); dropped again if the API works
  if (!(navigator as any).wakeLock) startVideoFallback();
  requestSentinel();
}

export function disableWakeLock(): void {
  wanted = false;
  stopVideoFallback();
  const s = sentinel;
  sentinel = null;
  try {
    s?.release();
  } catch {
    // already released
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wanted) {
      requestSentinel();
      if (!sentinel) startVideoFallback(); // iOS pauses hidden videos
    }
  });
}
