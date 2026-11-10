// Animaciones de la página de inicio: barras de la ficha de Match y conteo del índice.
(function () {
  document.documentElement.classList.add('js');
  var ficha = document.getElementById('ficha');
  if (!ficha) return;
  var num = document.getElementById('indice-num');
  var meta = parseInt(num.textContent, 10);
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mostrar() {
    ficha.classList.add('visible');
    if (reduce) return;
    var inicio = null;
    function paso(t) {
      if (!inicio) inicio = t;
      var p = Math.min((t - inicio) / 1100, 1);
      num.textContent = Math.round(meta * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(paso);
    }
    num.textContent = '0';
    requestAnimationFrame(paso);
  }
  if (!('IntersectionObserver' in window)) { mostrar(); return; }
  var obs = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      if (e.isIntersecting) { mostrar(); obs.disconnect(); }
    });
  }, { threshold: 0.35 });
  obs.observe(ficha);
})();
