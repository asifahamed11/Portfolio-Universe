// UI Sound & Particle Engine
window.triggerSpark = (btn) => {
  const sparkColor = '#f43f5e';
  const sparkSize = 6;
  const sparkRadius = 25;
  const sparkCount = 12;
  const duration = 500;
  
  const rect = btn.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '9999';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const startTime = performance.now();
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  
  const sparks = Array.from({ length: sparkCount }, (_, i) => ({
    angle: (2 * Math.PI * i) / sparkCount
  }));

  const draw = (timestamp) => {
    const elapsed = timestamp - startTime;
    if (elapsed >= duration) {
      canvas.remove();
      return;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const progress = elapsed / duration;
    const eased = easeOut(progress);
    
    const distance = eased * sparkRadius;
    const lineLength = sparkSize * (1 - eased);
    
    sparks.forEach(spark => {
      const x1 = x + distance * Math.cos(spark.angle);
      const y1 = y + distance * Math.sin(spark.angle);
      const x2 = x + (distance + lineLength) * Math.cos(spark.angle);
      const y2 = y + (distance + lineLength) * Math.sin(spark.angle);
      
      ctx.strokeStyle = sparkColor;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 1 - Math.pow(progress, 2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    
    requestAnimationFrame(draw);
  };
  
  requestAnimationFrame(draw);
};

// UI Sound Engine using Web Audio API
let audioCtx;
const initAudio = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
};

// Dynamic Deep Bubble Sound
window.playPopSound = (volumeScale = 1.0) => {
  initAudio();
  if(!audioCtx) return;
  const t = audioCtx.currentTime;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);
  
  const peakVol = 0.3 * volumeScale;
  const endVol = 0.01 * volumeScale;
  
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peakVol, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(endVol, t + 0.15);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(t);
  osc.stop(t + 0.15);
};

// Drop Sound (shared audioCtx — BUG-2 fix)
window.playDropSound = (volumeScale = 1.0) => {
  initAudio();
  if(!audioCtx) return;
  const t = audioCtx.currentTime;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);
  
  const peakVol = 0.3 * volumeScale;
  const endVol = 0.01 * volumeScale;
  
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peakVol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(endVol, t + 0.2);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(t);
  osc.stop(t + 0.2);
};

// Global click listener for UI sounds
document.addEventListener('click', (e) => {
  initAudio();
  
  const target = e.target;
  
  // BUG-L1 fix: the like button plays its own sound in toggleBookmark(); skip here
  // so a single like doesn't fire the pop sound twice.
  if (target.closest('.bookmark-btn')) return;
  
  // Play sound for interactable elements (all at the same volume: 1.0)
  if (
    target.closest('.filter-btn') || 
    target.closest('button svg path[d*="M19"]') || 
    target.closest('button[class*="heart"]') ||
    target.closest('nav button') || 
    target.closest('nav a') || 
    target.closest('#clearFiltersBtn') ||
    target.closest('a') || 
    target.closest('.portfolio-wrapper')
  ) {
    if (window.playPopSound) window.playPopSound(1.0);
  }
});
