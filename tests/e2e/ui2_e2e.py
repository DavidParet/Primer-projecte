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

STATE = r"""()=>{const ld=document.getElementById('loading');const r=document.getElementById('results');const q=s=>[...document.querySelectorAll(s)];
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
  ui2: document.body.classList.contains('ui2'), errs: window.__errs,
  loaderShown: ld && ld.classList.contains('on') && getComputedStyle(ld).display!=='none',
  icons: q('#results .nx-card-icon').map(e=>[e.getAttribute('data-ui2-icon'), (e.closest('.nx-p1-card,.nx-p2-card,.nx-info-card').querySelector('.nx-card-text')||{}).textContent]),
  calDays: q('#nx-event-content .ui2-cal-row .ui2-datebox b').map(e=>e.textContent), calTimes: q('#nx-event-content .ui2-cal-time').map(e=>e.textContent),
  termDays: q('#ui2-terminis .ui2-termini .ui2-datebox b').map(e=>e.textContent), termLabels: q('#ui2-terminis .ui2-termini small').map(e=>e.textContent),
  emoji: q('.bottom-nav, .tab-btn, .nx-btn-wa, .nx-btn-copy, .c-icon, .btn-premium-header, .nx-event-btn, .nx-btn-cal').map(e=>e.textContent).join(' ').match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu)||[],
  injected: q('.ui2-injected').length, kept: q('[data-ui2-html]').length,
  p1Label: (document.querySelector('#nx-p1-block > .nx-section-label')||{}).textContent||''}}"""

def run(pg, mock, status=200, delay=2500, wait=6000, query=''):
    pg.add_init_script(init_js(mock, status, delay))
    pg.goto(URL + query); pg.wait_for_timeout(900)
    pg.fill('#txt', MSG); pg.click('#btnAnalyze')
    pg.wait_for_timeout(min(900, delay + 200)); mid = pg.evaluate(STATE)
    pg.wait_for_timeout(wait); return mid, pg.evaluate(STATE)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else p.chromium.launch()
    def ctx(w=390, h=844, mobile=True, reduced=False):
        return b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=mobile, has_touch=mobile,
                             reduced_motion='reduce' if reduced else 'no-preference')
    escola = (E2E / 'mock-escola.json').read_text(); vencut = (E2E / 'mock-vencut.json').read_text(); res0 = (E2E / 'mock-sense-accio.json').read_text()
    def shot(pg, name, full=False):
        if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=f'{SHOTS}/{name}.png', full_page=full)

    print('A · Missatge escolar (mòbil 390×844)')
    c = ctx(); pg = c.new_page(); mid, st = run(pg, escola)
    check(mid['overlay'], 'l’animació de la lupa apareix mentre s’analitza')
    check(not st['overlay'] and st['resultsOn'], 'la capa desapareix i es mostren els resultats')
    check((st['p1'], st['p2'], st['p3']) == (2, 2, 2), f"targetes P1/P2/P3 = 2/2/2 (obtingut {st['p1']}/{st['p2']}/{st['p3']})")
    check((st['b1'], st['b2'], st['b3']) == ('2', '2', '2'), f"comptadors coincideixen amb les targetes ({st['b1']}/{st['b2']}/{st['b3']})")
    check(st['p1Label'].startswith('P1 · Imprescindible'), f"etiqueta «P1 · Imprescindible» ({st['p1Label']!r})")
    exp = ['Divendres 4 des', 'Dijous 10 des', 'Dimecres 2 des']
    check(all(any(e in d for d in st['dates']) for e in exp), 'terminis P1/P2 exactes: 4, 10 i 2 de desembre')
    icons = {t: i for i, t in st['icons']}
    want = {"Entregar l'autorització signada": 'sign', 'Fer el pagament de 18 €': 'pay', 'Avisar si hi ha al·lèrgies alimentàries': 'alert',
            "Ser a l'escola a les 8:15 h; l'autocar surt a les 8:30 h": 'clock', 'El 22 de desembre les classes acaben a les 13 h': 'school'}
    bad = [(t, icons.get(t), w) for t, w in want.items() if icons.get(t) != w]
    check(not bad, f'pictogrames segons el contingut (document, targeta, avís, rellotge, escola) {bad}')
    check(st['calDays'] == ['18', '22'] and st['calTimes'] == ['8:15 h', '13:00 h'], f"calendari: 18 DES 8:15 h i 22 DES 13:00 h ({st['calDays']} {st['calTimes']})")
    check(st['termDays'] == ['2', '4', '10', '18'] and all(l.lower() == 'termini' for l in st['termLabels']), f"terminis separats i ordenats 2, 4, 10, 18 ({st['termDays']})")
    tiles = pg.evaluate("[...document.querySelectorAll('#ui2-sumtiles .ui2-sumtile b')].map(e=>e.textContent)")
    check(tiles == ['2', '2', '2'], f'fitxes del Resum = recompte de targetes ({tiles})')
    check(not st['emoji'], f"sense emojis a navegació, pestanyes ni botons {st['emoji'][:5]}")
    check(not st['errs'], f"sense errors JavaScript {st['errs']}")
    check(not st['overflowX'], 'sense desbordament horitzontal')
    shot(pg, 'A_resultat')
    pg.evaluate("navTo('tasques')"); pg.wait_for_timeout(400)
    tv = pg.evaluate("""()=>({cards:[...document.querySelectorAll('#ui2-tasks .ui2-tcard')].length,
      chips:[...document.querySelectorAll('#ui2-tasks .nx-section-label')].map(e=>e.textContent+'='+e.getAttribute('data-ui2-count')),
      dates:[...document.querySelectorAll('#ui2-tasks .ui2-tdate')].map(e=>e.textContent.trim()),
      origHidden: getComputedStyle(document.querySelector('#pageTasques > .card')).display==='none'})""")
    check(tv['cards'] == 6 and tv['chips'] == ['P1 · Imprescindible=2', 'P2 · Preparació=2', 'P3 · Informació=2'], f"pantalla Tasques: 6 targetes i comptadors 2/2/2 ({tv['chips']})")
    check('Termini: Divendres 4 de desembre' in tv['dates'] and 'Divendres 18 de desembre' in tv['dates'], 'Tasques: termini i data informativa diferenciats')
    shot(pg, 'A_tasques')
    pg.click('#ui2-tasks .ui2-tcard.ui2-p1 .ui2-tchk'); pg.wait_for_timeout(400)
    dn = pg.evaluate("({done:_allTasques.filter(t=>t.done).length, view:document.querySelectorAll('#ui2-tasks .ui2-tcard.ui2-done').length})")
    check(dn == {'done': 1, 'view': 1}, f'marcar com a feta usa el control original i es desa ({dn})')
    c.close()

    print('B · Termini vençut i rang de dates')
    c = ctx(); pg = c.new_page(); _, st = run(pg, vencut)
    check(any('Termini vençut' in d for d in st['dates']), 'es mostra «Termini vençut» a la tasca caducada')
    check(any('Fins:' in d for d in st['dates']), 'es conserva la data final («Fins:»)')
    check((st['b1'], st['b2']) == ('1', '1'), f"comptadors P1/P2 = 1/1 ({st['b1']}/{st['b2']})")
    shot(pg, 'B_vencut', True)
    c.close()

    print('C · Missatge sense accions')
    c = ctx(); pg = c.new_page(); _, st = run(pg, res0)
    check('felicitació' in st['decisio'] and 'Cap acció obligatòria' in st['decisio'], 'sense accions: es mostra el resum i «Cap acció obligatòria» com a nota')
    check(not st['p1Visible'] and st['b1'] is None and not st['termDays'], 'sense bloc P1, comptadors ni terminis')
    c.close()

    print('D · Error de l’API (500)')
    c = ctx(); pg = c.new_page(); _, st = run(pg, json.dumps({'error': 'Error de prova controlat'}), status=500, delay=800, wait=1500)
    check(not st['overlay'], 'la capa d’animació es retira')
    check('Error de prova controlat' in st['err'] and st['inputVisible'], 'es mostra l’error i torna el formulari')
    c.close()

    print('E · Resposta molt ràpida (50 ms) i navegació durant l’anàlisi')
    c = ctx(); pg = c.new_page(); mid, st = run(pg, escola, delay=50, wait=3000)
    check(mid['overlay'], 'l’animació es manté el temps mínim (llegible)')
    check(not st['overlay'] and st['resultsOn'], 'acaba i mostra resultats')
    c.close()
    c = ctx(); pg = c.new_page(); pg.add_init_script(init_js(escola, 200, 4000)); pg.goto(URL); pg.wait_for_timeout(800)
    pg.fill('#txt', MSG); pg.click('#btnAnalyze'); pg.wait_for_timeout(700)
    pg.click('#navTasques'); pg.wait_for_timeout(500)
    nav = pg.evaluate("({page:getComputedStyle(document.getElementById('pageTasques')).display, overlay:!!document.querySelector('.ui2-scan')})")
    check(nav == {'page': 'block', 'overlay': False}, f'la navegació inferior funciona durant l’anàlisi i retira la capa ({nav})')
    c.close()

    print('F · Moviment reduït (accessibilitat)')
    c = ctx(reduced=True); pg = c.new_page(); mid, st = run(pg, escola, delay=1500, wait=2500)
    check(not mid['overlay'] and mid['loaderShown'], 'sense capa animada: es veu l’indicador original')
    check(st['resultsOn'] and (st['b1'], st['b2'], st['b3']) == ('2', '2', '2'), 'resultats i comptadors iguals')
    anim = pg.evaluate("[...document.querySelectorAll('#results *')].some(e=>{const s=getComputedStyle(e);return s.animationName!=='none' && parseFloat(s.animationDuration)>0})")
    check(not anim, 'cap animació activa als resultats')
    c.close()

    print('H · Reversibilitat i recuperació')
    c = ctx(); pg = c.new_page(); mid, st = run(pg, escola, delay=1500, wait=2500, query='?ui2=off')
    check(not st['ui2'] and st['injected'] == 0 and st['kept'] == 0, '«?ui2=off»: cap element ni canvi de la UI 2.1')
    check(mid['loaderShown'] and not mid['overlay'], '«?ui2=off»: indicador original d’anàlisi')
    check('P1 — Accions imprescindibles' in st['p1Label'], 'textos originals intactes')
    c.close()
    c = ctx(); pg = c.new_page(); _, st = run(pg, escola, delay=600, wait=3000)
    pg.evaluate("NexLupaUI2.disable()"); pg.wait_for_timeout(200); st2 = pg.evaluate(STATE)
    check(not st2['ui2'] and st2['injected'] == 0 and st2['kept'] == 0 and 'P1 — Accions imprescindibles' in st2['p1Label'], 'NexLupaUI2.disable(): es restaura tot l’original en calent')
    check(st2['emoji'] != [], 'disable(): tornen els emojis originals')
    c.close()
    c = ctx(); pg = c.new_page(); pg.route('**/ui2.js*', lambda r: r.abort())
    mid, st = run(pg, escola, delay=1500, wait=2500)
    check(mid['loaderShown'] and not mid['overlay'] and st['resultsOn'], 'si ui2.js falla: indicador original i resultats correctes')
    c.close()

    print('G · Responsive (sense desbordament)')
    for w, h, m in ((360, 740, True), (412, 915, True), (768, 1024, True), (1280, 860, False), (1920, 1080, False)):
        c = ctx(w, h, m); pg = c.new_page(); _, st = run(pg, escola, delay=400, wait=2600)
        check(not st['overflowX'] and st['resultsOn'] and not st['errs'], f'{w}×{h}: resultats visibles i sense desbordament')
        for page in ('inici', 'premium', 'tasques', 'historial', 'config'):
            pg.evaluate(f"navTo('{page}')"); pg.wait_for_timeout(150)
            ov = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            if ov: check(False, f'{w}×{h} pàgina {page} desborda')
            if SHOTS and w == 390: shot(pg, f'G_{page}')
        c.close()

    print('I · Contrast (WCAG AA, text sobre targeta)')
    c = ctx(); pg = c.new_page(); _, st = run(pg, escola, delay=300, wait=2500)
    cr = pg.evaluate("""()=>{const L=c=>{const v=c.match(/\d+(\.\d+)?/g).slice(0,3).map(x=>{x=x/255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
      const bg=L('rgb(34,54,76)');const r=s=>{const e=document.querySelector(s);if(!e)return null;const l=L(getComputedStyle(e).color);return +( (Math.max(l,bg)+.05)/(Math.min(l,bg)+.05) ).toFixed(2)};
      return {titol:r('.nx-p1-card .nx-card-text'),p1:r('.nx-p1-card .nx-card-date'),p2:r('.nx-p2-card .nx-card-date'),p3:r('.nx-info-card .nx-card-date'),resum:r('.nx-decisio-text')}}""")
    check(all(v and v >= 4.5 for v in cr.values()), f'contrast ≥ 4,5:1 {cr}')
    c.close()
    b.close()
srv.shutdown()
print(f'\nResultat: {passes} correctes, {len(fails)} fallades')
sys.exit(1 if fails else 0)
