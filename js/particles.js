/**
 * Ultra-lightweight, 60fps 2D Particle System for Main Launcher
 * - Translucent 2D particles drifting with ambient physics
 * - Connects dynamic strings to cursor when mouse is in vicinity
 * - Smooth detach/fade when cursor moves away
 * - Auto-pauses animation loop when outside the launcher for zero CPU/GPU overhead
 */

export function initParticles() {
  const canvas = document.getElementById("launcher-particle-canvas");
  const launcher = document.getElementById("app-launcher");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const COLOR_PALETTE = [
    { rgb: [34, 211, 238], baseAlpha: 0.65 },  // Cyan
    { rgb: [168, 85, 247], baseAlpha: 0.65 }, // Purple
    { rgb: [244, 63, 94], baseAlpha: 0.65 },   // Rose
    { rgb: [52, 211, 153], baseAlpha: 0.65 },  // Emerald
    { rgb: [251, 191, 36], baseAlpha: 0.65 },  // Amber
    { rgb: [56, 189, 248], baseAlpha: 0.65 },  // Sky Blue
    { rgb: [236, 72, 153], baseAlpha: 0.65 },  // Magenta
    { rgb: [129, 140, 248], baseAlpha: 0.65 }  // Indigo
  ];

  const PARTICLE_COUNT = 48;
  const MOUSE_STRING_RADIUS = 145;
  const particles = [];

  let mouseX = null;
  let mouseY = null;
  let animationId = null;
  let isRunning = false;
  let width = 0;
  let height = 0;
  let dpr = window.devicePixelRatio || 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const rect = launcher?.getBoundingClientRect();
    const nextWidth = rect?.width || window.innerWidth;
    const nextHeight = rect?.height || window.innerHeight;
    const prevWidth = width;
    const prevHeight = height;

    width = nextWidth;
    height = nextHeight;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (particles.length === 0) {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const pal = COLOR_PALETTE[i % COLOR_PALETTE.length];
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.6,
          radius: 2.5 + Math.random() * 3.5,
          rgb: pal.rgb,
          alpha: pal.baseAlpha * (0.6 + Math.random() * 0.4),
        });
      }
    } else if (prevWidth > 0 && prevHeight > 0) {
      const scaleX = width / prevWidth;
      const scaleY = height / prevHeight;
      particles.forEach((particle) => {
        particle.x = Math.max(0, Math.min(width, particle.x * scaleX));
        particle.y = Math.max(0, Math.min(height, particle.y * scaleY));
      });
    }
  }

  function scheduleResize() {
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(resize);
    });
  }

  function setMouseFromEvent(e) {
    if (document.body.dataset.mode || !launcher) {
      mouseX = null;
      mouseY = null;
      return;
    }

    const rect = launcher.getBoundingClientRect();
    const isInsideLauncher =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;

    if (!isInsideLauncher) {
      mouseX = null;
      mouseY = null;
      return;
    }

    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  }

  // Track interaction only inside the launcher content, not the custom title bar.
  window.addEventListener("mousemove", (e) => {
    setMouseFromEvent(e);
  });

  window.addEventListener("mouseleave", () => {
    mouseX = null;
    mouseY = null;
  });

  window.addEventListener("resize", scheduleResize);
  window.electronAPI?.onWindowMaximizedState?.(scheduleResize);
  if (launcher && "ResizeObserver" in window) {
    new ResizeObserver(scheduleResize).observe(launcher);
  }

  function draw() {
    if (!isRunning) return;

    ctx.clearRect(0, 0, width, height);

    const hasMouse = mouseX !== null && mouseY !== null;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // Update particle positions
      p.x += p.vx;
      p.y += p.vy;

      // Soft boundary bounce/wrap
      if (p.x < -10) p.x = width + 10;
      else if (p.x > width + 10) p.x = -10;

      if (p.y < -10) p.y = height + 10;
      else if (p.y > height + 10) p.y = -10;

      // Mouse string interaction
      if (hasMouse) {
        const dx = mouseX - p.x;
        const dy = mouseY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < MOUSE_STRING_RADIUS) {
          const ratio = 1 - dist / MOUSE_STRING_RADIUS;
          const stringAlpha = ratio * 0.8;

          // Draw string line to mouse
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouseX, mouseY);
          ctx.strokeStyle = `rgba(${p.rgb[0]}, ${p.rgb[1]}, ${p.rgb[2]}, ${stringAlpha})`;
          ctx.lineWidth = 1.2 * ratio + 0.4;
          ctx.stroke();

          // Subtle interactive elastic pull
          p.vx += (dx / dist) * (ratio * 0.05);
          p.vy += (dy / dist) * (ratio * 0.05);

          // Dampen maximum velocity
          p.vx *= 0.97;
          p.vy *= 0.97;
        }
      }

      // Draw 2D Translucent Particle
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.rgb[0]}, ${p.rgb[1]}, ${p.rgb[2]}, ${p.alpha})`;
      ctx.fill();
    }

    animationId = requestAnimationFrame(draw);
  }

  function start() {
    if (isRunning) return;
    resize();
    isRunning = true;
    animationId = requestAnimationFrame(draw);
  }

  function stop() {
    if (!isRunning) return;
    isRunning = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (ctx) ctx.clearRect(0, 0, width, height);
  }

  // Observe mode changes to start/stop the loop seamlessly
  function updateRunningState() {
    const isLauncherMode = !document.body.dataset.mode;
    const isVisible = document.visibilityState === "visible";
    if (isLauncherMode && isVisible) {
      start();
    } else {
      stop();
    }
  }

  const observer = new MutationObserver(() => {
    updateRunningState();
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-mode"]
  });

  document.addEventListener("visibilitychange", updateRunningState);

  // Initial start if on launcher
  updateRunningState();
}
