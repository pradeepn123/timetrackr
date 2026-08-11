(function(){
  const canvas = document.getElementById('bgParticles');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof gsap !== 'undefined';
  const COLORS = ['#c8791f', '#4c6b3f', '#a33d2b', '#8f5613'];
  const LINK_DIST = 130;

  let particles = [];
  let width = 0, height = 0, dpr = 1;
  let rafId = null;

  function resizeCanvas(){
    dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function particleCount(){
    const area = width * height;
    return Math.max(20, Math.min(60, Math.round(area / 24000)));
  }

  function wander(p){
    if(!hasGsap) return;
    gsap.to(p, {
      x: Math.random() * width,
      y: Math.random() * height,
      duration: 16 + Math.random() * 20,
      ease: 'sine.inOut',
      onComplete: () => wander(p)
    });
  }

  function createParticles(){
    if(hasGsap) particles.forEach(p => gsap.killTweensOf(p));
    const count = particleCount();
    particles = Array.from({ length: count }, () => {
      const p = {
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1 + Math.random() * 1.8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]
      };
      wander(p);
      return p;
    });
  }

  function draw(){
    ctx.clearRect(0, 0, width, height);

    for(let i = 0; i < particles.length; i++){
      for(let j = i + 1; j < particles.length; j++){
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if(dist < LINK_DIST){
          ctx.strokeStyle = 'rgba(107,101,88,' + (0.14 * (1 - dist / LINK_DIST)) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    particles.forEach(p => {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  function loop(){
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function start(){
    resizeCanvas();
    createParticles();
    if(prefersReducedMotion || !hasGsap){
      draw();
      return;
    }
    if(rafId) cancelAnimationFrame(rafId);
    loop();
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(start, 200);
  });

  start();
})();
