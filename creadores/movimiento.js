// Movimiento de northik.ai/creadores (manual de marca: «Suave al llegar», «Con propósito»).
// - Tarjetas de dolor: entran en cascada al llegar.
// - Tarjeta «Así ven las marcas tu perfil»: cada bloque de texto llena una parte al bajar.
// - Pasos: la línea crece con el scroll y enciende cada número al alcanzarlo.
// Con «Reducir movimiento» no se agrega .js y todo queda en su estado final (ver el CSS).
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("js");

  // ---------- Tarjetas de dolor ----------
  var dolores = document.getElementById("dolores");
  if (dolores) {
    var obsDolor = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { dolores.classList.add("ver"); obsDolor.disconnect(); }
      });
    }, { threshold: 0.25 });
    obsDolor.observe(dolores);
  }

  // ---------- Tarjeta de perfil ----------
  var completarPerfil = null;
  var tarjeta = document.getElementById("tarjeta");
  if (tarjeta) {
    var fmt = function (n) { return n.toLocaleString("es-CO"); };
    var num = tarjeta.querySelector("[data-cuenta]");
    var meta = parseInt(num.getAttribute("data-cuenta"), 10);
    var contado = false;
    num.textContent = "0";
    var contar = function () {
      if (contado) return;
      contado = true;
      var inicio = null;
      var paso = function (t) {
        if (inicio === null) inicio = t;
        var p = Math.min((t - inicio) / 1100, 1);
        num.textContent = fmt(Math.round(meta * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    };
    var llenarHasta = function (n) {
      for (var i = 1; i <= n; i++) {
        var parte = tarjeta.querySelector('[data-parte="' + i + '"]');
        if (parte) parte.classList.add("on");
      }
      if (n >= 1) contar();
    };
    // Un bloque cuenta como leído cuando su parte de arriba pasa la mitad de la pantalla.
    var obsPerfil = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting || e.boundingClientRect.top < 0) llenarHasta(parseInt(e.target.getAttribute("data-paso"), 10));
      });
    }, { rootMargin: "0px 0px -50% 0px" });
    document.querySelectorAll(".explica[data-paso]").forEach(function (b) { obsPerfil.observe(b); });
    // Si alguien salta más abajo (por ejemplo con el botón de registro), la tarjeta queda completa.
    completarPerfil = function () { llenarHasta(4); };
  }

  // ---------- Pasos con línea ----------
  var pasos = document.getElementById("pasos");
  if (pasos) {
    var riel = pasos.querySelector(".riel");
    var trazo = pasos.querySelector(".trazo");
    var items = pasos.querySelectorAll("li");
    var ultimo = items[items.length - 1];
    var medir = function () {
      // La línea termina en el centro del último número.
      riel.style.setProperty("--fin", (pasos.offsetHeight - ultimo.offsetTop - 16) + "px");
    };
    var pendiente = false;
    var actualizar = function () {
      pendiente = false;
      var caja = riel.getBoundingClientRect();
      if (completarPerfil && caja.top < window.innerHeight) { completarPerfil(); completarPerfil = null; }
      // La punta de la línea sigue al 60 % de la altura de la pantalla.
      var p = Math.max(0, Math.min((window.innerHeight * 0.6 - caja.top) / caja.height, 1));
      trazo.style.setProperty("--pr", p.toFixed(4));
      var punta = caja.top + p * caja.height;
      items.forEach(function (li) {
        var n = li.querySelector(".num").getBoundingClientRect();
        li.classList.toggle("on", n.top + n.height / 2 <= punta + 1);
      });
    };
    var pedir = function () { if (!pendiente) { pendiente = true; requestAnimationFrame(actualizar); } };
    medir();
    actualizar();
    window.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", function () { medir(); pedir(); });
  }
})();
