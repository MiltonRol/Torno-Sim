// tema-paginas.js — tema claro/oscuro para las páginas del generador y del tutorial.
// Usa la MISMA clave de localStorage que el torno ('torno-tema'): si lo cambias en una página, las otras
// lo recuerdan. (main.js del torno tiene su propia copia porque además avisa a los lienzos 3D.)
(() => {
  const raiz = document.documentElement, btn = document.querySelector('#btn-tema');
  const leer = () => { try { return localStorage.getItem('torno-tema'); } catch { return null; } };
  function poner(tema, guardar) {
    raiz.dataset.tema = tema;
    if (btn) {
      btn.setAttribute('aria-pressed', String(tema === 'claro'));
      btn.querySelector('.tema__texto').textContent = tema === 'claro' ? 'Tema claro' : 'Tema oscuro';
    }
    if (guardar) { try { localStorage.setItem('torno-tema', tema); } catch { /* file:// sin almacenamiento */ } }
    requestAnimationFrame(() => document.dispatchEvent(new Event('cambiotema')));   // los lienzos releen sus colores
  }
  const url = /(?:^#|[&,+])(claro|oscuro)(?=$|[&,+])/.exec(location.hash)?.[1];
  poner(url || leer() || (matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro'), false);
  btn?.addEventListener('click', () => poner(raiz.dataset.tema === 'claro' ? 'oscuro' : 'claro', true));
})();
