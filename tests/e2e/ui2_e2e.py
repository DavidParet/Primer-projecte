#!/usr/bin/env python3
"""Proves de navegador de la UI 2.0 (NexLupa).
Requisits locals: python3 + playwright + Chrome/Chromium. No usa serveis externs:
/api/analyze se simula dins del navegador amb respostes deterministes (tests/e2e/mock-*.json).
Ús:  python3 tests/e2e/ui2_e2e.py [--shots DIR]
Surt amb codi 1 si alguna comprovació falla."""
import json, os, sys, threading, functools, http.server, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
E2E = ROOT / 'tests' / 'e2e'
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
CHROME = os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)
MSG = ("Bon dia, famílies!\n\nUs recordem que el proper divendres 18 de desembre anirem al Museu de la Ciència de Barcelona. "
       "Haurem de ser a l'escola a les 8.15 h perquè l'autocar sortirà puntualment a les 8.30 h.\n\nEls nens han de portar esmorzar, dinar, aigua i roba còmoda.\n\n"
       "El cost de la sortida és de 18 € i cal fer el pagament abans del 10 de desembre. També necessitem que retorneu l'autorització signada abans del dia 4.\n\n"
       "Si algun infant té alguna al·lèrgia alimentària que encara no ens heu comunicat, aviseu-nos abans del dimecres 2 de desembre.\n\n"
       "Aprofitem per recordar-vos que el dia 22 de desembre acabarem les classes a les 13 h.")

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(ROOT)))
PORT = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{PORT}/app/index.html'
fails, passes = [], 0
def check(cond, label):
    global passes
    if cond: passes += 1; print('  ✓', label)
    else: fails.append(label); print('  ✗', label)

def init_js(body, status=200, delay=2500):
    return ("try{localStorage.setItem('nxl_ob_done','1');localStorage.removeItem('nxl_tasks');localStorage.removeItem('nxl_hist')}catch(e){};"
            "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});"
            "window.__M=" + json.dumps(body) + ";window.__S=" + str(status) + ";window.__D=" + str(delay) + ";"
            "(function(){var f=window.fetch;window.fetch=function(u,o){if(String(u).indexOf('/api/analyze')>=0){return new Promise(function(r){setTimeout(function(){"
            "r(new Response(window.__M,{status:window.__S,headers:{'Content-Type':'application/json'}}))},window.__D)})}return f.apply(this,arguments)}})();")

STATE = """()=>{const r=document.getElementById('results');const q=s=>[...document.querySelectorAll(s)];
 const lab=id=>{const e=document.querySelector(id+' .nx-section-label');return e?e.getAttribute('data-ui2-count'):null};
 return {resultsOn:r.classList.contains('on'), overlay:!!document.querySelector('.ui2-scan'),
  p1:q('#results .nx-p1-card').length, p2:q('#results .nx-p2-card').length, p3:q('#nx-info-content .nx-info-card, #nx-more-actions-content .nx-info-card').length,
  b1:lab('#nx-p1-block'), b2:lab('#nx-p2-block'), b3:lab('#nx-info-block'),
  p1Visible:getComputedStyle(document.getElementById('nx-p1-block')).display!=='none',
  dates:q('#results .nx-card-date').map(e=>e.textContent.trim()).filter(Boolean),
  chips:q('#results .nx-event-chip').map(e=>e.textContent.trim()),
  decisio:(document.getElementById('nx-decisio')||{}).textContent||'',
  err:(document.getElementById('errMsg')||{}).textContent||'',
  inputVisible:(()=>{const c=document.querySelector('#pageInici .app-col-right .card');return c&&getComputedStyle(c).display!=='none'})(),
  overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  ui2: document.body.classList.contains('ui2'), errs: window.__errs}}"""

def run(pg, mock, status=200, delay=2500, wait=6000):
    pg.add_init_script(init_js(mock, status, delay))
    pg.goto(URL); pg.wait_for_timeout(900)
    pg.fill('#txt', MSG); pg.click('#btnAnalyze')
    pg.wait_for_timeout(min(900, delay + 200)); mid = pg.evaluate(STATE)
    pg.wait_for_timeout(wait); return mid, pg.evaluate(STATE)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else p.chromium.launch()
    def ctx(w=390, h=844, mobile=True, reduced=False):
        return b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=mobile, has_touch=mobile,
                             reduced_motion='reduce' if reduced else 'no-preference')
    escola = (E2E / 'mock-escola.json').read_text(); vencut = (E2E / 'mock-vencut.json').read_text(); res0 = (E2E / 'mock-sense-accio.json').read_text()

    print('A · Missatge escolar (mòbil 390×844)')
    c = ctx(); pg = c.new_page(); mid, st = run(pg, escola)
    check(mid['overlay'], 'l’animació de la lupa apareix mentre s’analitza')
    check(not st['overlay'] and st['resultsOn'], 'la capa desapareix i es mostren els resultats')
    check((st['p1'], st['p2'], st['p3']) == (2, 2, 2), f"targetes P1/P2/P3 = 2/2/2 (obtingut {st['p1']}/{st['p2']}/{st['p3']})")
    check((st['b1'], st['b2'], st['b3']) == ('2', '2', '2'), f"comptadors coincideixen amb les targetes ({st['b1']}/{st['b2']}/{st['b3']})")
    exp = ['Divendres 4 des', 'Dijous 10 des', 'Dimecres 2 des']
    check(all(d in st['dates'] for d in exp), 'terminis P1/P2 exactes: 4, 10 i 2 de desembre')
    check(any('Divendres 18 de des' in x for x in st['chips']) and any('08:15h' in x for x in st['chips']), 'esdeveniment 18 de desembre a les 08:15')
    check(any('Dimarts 22 de des' in x for x in st['chips']) and any('13:00h' in x for x in st['chips']), 'final de classes 22 de desembre a les 13:00')
    check(not st['errs'], f"sense errors JavaScript {st['errs']}")
    check(not st['overflowX'], 'sense desbordament horitzontal')
    pg.evaluate("navTo('tasques')"); pg.wait_for_timeout(300)
    nt = pg.evaluate("document.querySelectorAll('#tasquesList .tsk-item').length")
    check(nt == 6, f'Tasques desa les 6 accions ({nt})')
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=f'{SHOTS}/A_tasques.png')
    c.close()

    print('B · Termini vençut i rang de dates')
    c = ctx(); pg = c.new_page(); _, st = run(pg, vencut)
    check(any('Termini vençut' in d for d in st['dates']), 'es mostra «Termini vençut» a la tasca caducada')
    check(any(d.startswith('Fins:') for d in st['dates']), 'es conserva la data final («Fins:»)')
    check((st['b1'], st['b2']) == ('1', '1'), f"comptadors P1/P2 = 1/1 ({st['b1']}/{st['b2']})")
    if SHOTS: pg.screenshot(path=f'{SHOTS}/B_vencut.png', full_page=True)
    c.close()

    print('C · Missatge sense accions')
    c = ctx(); pg = c.new_page(); _, st = run(pg, res0)
    check('No has de fer res' in st['decisio'], 'veredicte «No has de fer res»')
    check(not st['p1Visible'] and st['b1'] is None, 'sense bloc P1 ni comptadors')
    c.close()

    print('D · Error de l’API (500)')
    c = ctx(); pg = c.new_page(); _, st = run(pg, json.dumps({'error': 'Error de prova controlat'}), status=500, delay=800, wait=1500)
    check(not st['overlay'], 'la capa d’animació es retira')
    check('Error de prova controlat' in st['err'] and st['inputVisible'], 'es mostra l’error i torna el formulari')
    c.close()

    print('E · Resposta molt ràpida (50 ms)')
    c = ctx(); pg = c.new_page(); mid, st = run(pg, escola, delay=50, wait=3500)
    check(mid['overlay'], 'l’animació es manté el temps mínim (llegible)')
    check(not st['overlay'] and st['resultsOn'], 'acaba i mostra resultats')
    c.close()

    print('F · Moviment reduït (accessibilitat)')
    c = ctx(reduced=True); pg = c.new_page(); _, st = run(pg, escola, delay=600, wait=3000)
    check(not st['overlay'] and st['resultsOn'] and (st['b1'], st['b2'], st['b3']) == ('2', '2', '2'), 'funciona sense animacions i amb els mateixos comptadors')
    c.close()

    print('G · Responsive (sense desbordament)')
    for w, h, m in ((360, 740, True), (412, 915, True), (768, 1024, True), (1280, 860, False), (1920, 1080, False)):
        c = ctx(w, h, m); pg = c.new_page(); _, st = run(pg, escola, delay=400, wait=2600)
        check(not st['overflowX'] and st['resultsOn'] and not st['errs'], f'{w}×{h}: resultats visibles i sense desbordament')
        for page in ('inici', 'premium', 'tasques', 'historial', 'config'):
            pg.evaluate(f"navTo('{page}')"); pg.wait_for_timeout(150)
            ov = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            if ov: check(False, f'{w}×{h} pàgina {page} desborda')
        if SHOTS: pg.evaluate("navTo('inici')"); pg.wait_for_timeout(200); pg.screenshot(path=f'{SHOTS}/G_{w}x{h}.png')
        c.close()
    b.close()
srv.shutdown()
print(f'\nResultat: {passes} correctes, {len(fails)} fallades')
sys.exit(1 if fails else 0)
