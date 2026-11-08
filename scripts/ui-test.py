#!/usr/bin/env python3
"""Optional browser test (needs `pip install playwright` + `playwright install chromium`).

Starts the Express server against the local mock Gemini and drives the real UI in
headless Chromium: chat routing, settings persistence, viva flow, visualizer
controls, themes and the mobile layout. Screenshots go to ./ui-test-shots/.
Run with:  python3 scripts/ui-test.py
"""
import os, random, re, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'ui-test-shots'
SHOTS.mkdir(exist_ok=True)
MOCK_PORT = random.randint(4300, 4500)
APP_PORT = MOCK_PORT + 500
BASE = f'http://127.0.0.1:{APP_PORT}'
results = []


def check(name, ok, detail=''):
    results.append(ok)
    if not ok:
        print(f'FAIL  {name} {detail}')


def wait_http(url):
    for _ in range(80):
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except Exception:
            time.sleep(0.15)
    raise RuntimeError(f'{url} did not start')


mock = subprocess.Popen(['node', 'scripts/mock-gemini.js'], cwd=ROOT, env={**os.environ, 'PORT': str(MOCK_PORT)}, stdout=subprocess.DEVNULL)
app = subprocess.Popen(['node', 'server.js'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       env={**os.environ, 'PORT': str(APP_PORT), 'GEMINI_API_KEY': 'TEST_KEY_123', 'GEMINI_BASE_URL': f'http://127.0.0.1:{MOCK_PORT}',
                            'AI_RATE_LIMIT_PER_MIN': '500', 'GENERAL_RATE_LIMIT_PER_MIN': '5000', 'EXECUTE_RATE_LIMIT_PER_MIN': '5000'})
try:
    wait_http(f'http://127.0.0.1:{MOCK_PORT}/__requests')
    wait_http(f'{BASE}/api/health')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark', bypass_csp=True)
        page = ctx.new_page()
        problems = []
        page.on('pageerror', lambda e: problems.append(str(e)))
        page.on('console', lambda m: problems.append(m.text) if m.type == 'error' and 'ERR_NAME_NOT_RESOLVED' not in m.text and 'ERR_INTERNET_DISCONNECTED' not in m.text and 'Failed to load resource' not in m.text else None)

        # ---------------- chatbot ----------------
        page.goto(f'{BASE}/#/ai')
        page.wait_for_selector('#input')
        check('chat empty state shows suggestions', page.locator('.suggestion').count() >= 4)
        page.fill('#input', 'what is 12*(3+4)')
        page.keyboard.press('Enter')
        page.wait_for_selector('.msg.ai .bubble-foot .chip')
        txt = page.inner_text('.msg.ai')
        check('arithmetic answered with 84 by the C++ engine badge', '84' in txt and 'C++ math engine' in txt, txt[:120])
        page.fill('#input', 'Who is your owner?')
        page.keyboard.press('Enter')
        page.wait_for_function("document.querySelectorAll('.msg.ai .bubble-foot').length === 2")
        txt = page.locator('.msg.ai').nth(1).inner_text()
        check('personal knowledge answer with its badge', 'Abhishek Sapkale' in txt and 'Personal knowledge file' in txt)
        page.fill('#input', 'Explain virtual functions in C++')
        page.keyboard.press('Enter')
        page.wait_for_function("document.querySelectorAll('.msg.ai .bubble-foot').length === 3", timeout=15000)
        txt = page.locator('.msg.ai').nth(2).inner_text()
        check('Gemini answer rendered with Gemini badge', 'MOCK-GEMINI-REPLY' in txt and 'Gemini' in txt, txt[:200])
        check('markdown code blocks / headings render safely', page.locator('.msg.ai').nth(2).locator('.md').count() == 1)
        page.fill('#input', 'line one')
        page.keyboard.press('Shift+Enter')
        page.keyboard.type('line two')
        check('Shift+Enter inserts a newline instead of sending', page.input_value('#input') == 'line one\nline two')
        page.fill('#input', '')
        page.fill('#input', 'tell me about trees TRIGGER_429')
        page.keyboard.press('Enter')
        page.wait_for_selector('.bubble.err')
        check('error bubble with retry button on Gemini quota error', page.locator('.bubble.err [data-retry]').count() == 1)
        page.screenshot(path=str(SHOTS / 'chat-dark.png'))
        page.reload()
        page.wait_for_selector('.msg.ai')
        check('session history preserved after reload', page.locator('.msg.ai').count() >= 3)
        page.click('#clear')
        check('clear conversation empties the chat', page.locator('.chat-empty').count() == 1)

        # ---------------- visualizer ----------------
        page.goto(f'{BASE}/#/visualizer/bubble_sort')
        page.wait_for_function("document.querySelector('#stepCount') && !document.querySelector('#stepCount').textContent.includes('/ 0')")
        page.fill('#fArr', '5, 3, 1')
        page.click('#runBtn')
        page.wait_for_function("!/\\/ 49$/.test(document.querySelector('#stepCount').textContent)")
        total = int(page.inner_text('#stepCount').split('/')[1])
        check('custom input produces a new run', total > 3)
        page.click('#speedSeg [data-speed="veryfast"]')
        page.click('#bPlay')
        page.wait_for_function("document.querySelector('#bPlay').innerText.includes('Replay')", timeout=15000)
        check('playback reaches the end and offers Replay', 'Replay' in page.inner_text('#bPlay'))
        check('final step reports DONE', 'DONE' in page.inner_text('#msg'))
        page.click('#bReset')
        check('reset returns to step 1', page.inner_text('#stepCount').startswith('Step 1 /'))
        page.click('#bNext')
        check('next advances one step', page.inner_text('#stepCount').startswith('Step 2 /'))
        page.click('#bPrev')
        check('previous goes back one step', page.inner_text('#stepCount').startswith('Step 1 /'))
        page.keyboard.press('ArrowRight')
        check('keyboard arrow advances', page.inner_text('#stepCount').startswith('Step 2 /'))
        page.fill('#fArr', 'a, b')
        page.click('#runBtn')
        page.wait_for_function("document.querySelector('#formError').textContent.length > 0")
        check('invalid input shows an inline error', 'comma separated' in page.inner_text('#formError'))
        page.fill('#fArr', ','.join(str(i) for i in range(45)))
        page.click('#runBtn')
        page.wait_for_function("document.querySelector('#formError').textContent.includes('at most')")
        check('server-side limit error reaches the UI', 'at most 40' in page.inner_text('#formError'))
        page.click('[data-side="stats"]')
        check('statistics tab shows measured values', 'measured in this run' in page.inner_text('#paneStats').lower())
        page.click('#growBtn')
        page.wait_for_selector('#growth table', timeout=15000)
        check('growth analysis table loads from the C++ engine', 'O(n^2)' in page.inner_text('#growth'))
        page.click('[data-side="ai"]')
        page.wait_for_selector('.ai-body .md', timeout=10000)
        check('AI tutor tab renders a Gemini answer', 'MOCK-GEMINI-REPLY' in page.inner_text('.ai-body'))
        page.screenshot(path=str(SHOTS / 'visualizer-dark.png'))

        page.goto(f'{BASE}/#/visualizer/binary_search')
        page.wait_for_selector('#fTarget')
        page.fill('#fArr', '9, 1, 5')
        page.click('#runBtn')
        page.wait_for_function("document.querySelector('#formError').textContent.includes('sorted')")
        check('binary search rejects unsorted input in the UI', True)
        page.click('[data-gen="sortinput"]')
        page.click('#runBtn')
        page.wait_for_function("document.querySelector('#formError').textContent === ''")
        check('Sort input button repairs the input', page.input_value('#fArr') == '1, 5, 9')

        page.goto(f'{BASE}/#/visualizer/stack')
        page.wait_for_selector('#sOps')
        page.click('[data-op="push 7"]')
        check('operation chips append to the textarea', page.input_value('#sOps').strip().endswith('push 7'))

        # ---------------- code explorer ----------------
        page.goto(f'{BASE}/#/code/quick_sort')
        page.wait_for_selector('.cl')
        page.click('#run')
        page.wait_for_function("!document.querySelector('#play').disabled")
        page.click('#next'); page.click('#next')
        check('active line highlighted in the code explorer', page.locator('.cl.active').count() == 1)
        check('copy and expand buttons present', page.locator('.code-bar [data-copy]').count() == 1 and page.locator('[data-expand]').count() == 1)
        page.click('[data-expand]')
        check('expand toggles the editor class', page.locator('.code-card.expanded').count() == 1)
        page.screenshot(path=str(SHOTS / 'code-dark.png'))

        # ---------------- algorithms page ----------------
        page.goto(f'{BASE}/#/algorithms')
        page.wait_for_selector('#grid .algo-card')
        check('21 algorithm cards listed', page.locator('#grid .algo-card').count() == 21)
        page.fill('#q', 'heap')
        page.wait_for_timeout(300)
        check('search filters the library', page.locator('#grid .algo-card').count() == 1)
        page.fill('#q', '')
        page.click('#chips [data-cat="graph"]')
        page.wait_for_timeout(400)
        check('category chip filters the library', page.locator('#grid .algo-card').count() == 3)
        page.select_option('#ca', 'quick_sort'); page.select_option('#cb', 'merge_sort')
        page.click('#cgo')
        page.wait_for_selector('#cai .md', timeout=10000)
        check('compare shows engine table and AI analysis', 'O(n^2)' in page.inner_text('#cout'))
        page.fill('#etopic', "Kruskal's algorithm")
        page.click('#ego')
        page.wait_for_selector('#eout .notice.warn', timeout=10000)
        check('unsupported algorithm is labelled as not executed', 'not executed' in page.inner_text('#eout').lower())
        page.fill('#etopic', 'bubble sort')
        page.click('#ego')
        page.wait_for_selector('#eout .notice.info', timeout=10000)
        check('supported algorithm redirects to the interactive version', 'Open interactive visualization' in page.inner_text('#eout'))

        # ---------------- viva ----------------
        page.goto(f'{BASE}/#/viva')
        page.wait_for_selector('#start')
        page.select_option('#count', '3')
        page.click('[data-diff="advanced"]')
        page.click('#start')
        page.wait_for_selector('.option', timeout=15000)
        for i in range(3):
            page.wait_for_selector('.option')
            page.locator('.option').first.click()
            page.wait_for_selector('#nextQ')
            page.click('#nextQ')
        page.wait_for_selector('.score-ring')
        check('final report shows a score ring and per-question review', page.locator('.score-ring').count() == 1 and page.locator('.card .chip.danger, .card .chip.teal').count() >= 3)
        page.screenshot(path=str(SHOTS / 'viva-report.png'))
        page.click('#retry')
        page.wait_for_selector('.option')
        check('retry restarts the same questions', 'Question 1 of 3' in page.inner_text('h1'))
        page.goto(f'{BASE}/#/')
        page.wait_for_selector('.hero')
        check('dashboard reflects real stored statistics', page.locator('.card.stat').nth(2).inner_text().strip().startswith('1'))
        check('dashboard lists recently explored algorithms', page.locator('.recent-item').count() >= 1)
        page.screenshot(path=str(SHOTS / 'dashboard-dark.png'))

        # ---------------- settings ----------------
        page.goto(f'{BASE}/#/settings')
        page.wait_for_selector('[data-seg="theme"]')
        page.click('[data-seg="theme"] [data-v="light"]')
        check('light theme applies immediately', page.evaluate("document.documentElement.dataset.theme") == 'light')
        page.click('[data-accent="amber"]')
        check('accent colour applies', page.evaluate("document.documentElement.dataset.accent") == 'amber')
        page.click('[data-seg="density"] [data-v="compact"]')
        check('compact density applies', page.evaluate("document.documentElement.dataset.density") == 'compact')
        page.click('[data-seg="motion"] [data-v="off"]')
        check('animations can be turned off', page.evaluate("document.documentElement.dataset.motion") == 'off')
        page.fill('[data-range="fontSize"]', '17')
        page.dispatch_event('[data-range="fontSize"]', 'input')
        check('editor font size applies', page.evaluate("document.documentElement.style.getPropertyValue('--code-size')") == '17px')
        page.click('[data-seg="speed"] [data-v="veryfast"]')
        page.reload()
        page.wait_for_selector('[data-seg="theme"]')
        check('settings persist across reload', page.evaluate("document.documentElement.dataset.theme") == 'light' and page.evaluate("document.documentElement.dataset.accent") == 'amber')
        page.screenshot(path=str(SHOTS / 'settings-light.png'))
        page.click('#testAi')
        page.wait_for_function("document.querySelector('#aiInfo').innerText.includes('connected')", timeout=15000)
        check('AI connectivity test reports success', 'connected' in page.inner_text('#aiInfo') and page.inner_text('#aiChip') == 'available')
        check('API key is not shown anywhere in settings', 'TEST_KEY' not in page.content())
        page.goto(f'{BASE}/#/visualizer/linear_search')
        page.wait_for_selector('#stepCount')
        check('default speed setting is used by the visualizer', page.locator('#speedSeg [data-speed="veryfast"].on').count() == 1)
        page.screenshot(path=str(SHOTS / 'visualizer-light.png'))
        page.goto(f'{BASE}/#/settings')
        page.wait_for_selector('[data-toggle="showCode"]')
        page.evaluate("document.querySelector('[data-toggle=\"showCode\"]').click()")
        page.goto(f'{BASE}/#/visualizer/bubble_sort')
        page.wait_for_selector('#sideTabs')
        check('Show code panel = off hides the code tab', page.locator('[data-side="code"]').count() == 0)
        page.goto(f'{BASE}/#/settings')
        page.wait_for_selector('#resetPrefs')
        page.click('#resetPrefs')
        check('reset preferences restores defaults', page.evaluate("document.documentElement.dataset.accent") == 'violet')
        page.click('#clearQuiz'); page.click('#clearRecent')
        page.goto(f'{BASE}/#/')
        page.wait_for_selector('.hero')
        check('clear buttons reset the dashboard statistics', page.locator('.card.stat').nth(1).inner_text().strip().startswith('0'))

        # ---------------- mobile ----------------
        mobile = browser.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark', device_scale_factor=2, bypass_csp=True)
        m = mobile.new_page()
        m.on('pageerror', lambda e: problems.append('mobile: ' + str(e)))
        m.goto(f'{BASE}/#/visualizer/merge_sort')
        m.wait_for_function("document.querySelector('#stepCount') && !document.querySelector('#stepCount').textContent.includes('/ 0')")
        overflow = m.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
        check('no horizontal page overflow on mobile (visualizer)', not overflow)
        m.screenshot(path=str(SHOTS / 'visualizer-mobile.png'))
        m.click('#menuBtn')
        check('mobile menu opens', m.locator('#navlinks.open').count() == 1)
        m.screenshot(path=str(SHOTS / 'menu-mobile.png'))
        for route in ['#/', '#/algorithms', '#/ai', '#/viva', '#/settings', '#/code/bfs', '#/visualizer/bfs', '#/visualizer/fibonacci']:
            m.goto(f'{BASE}/{route}')
            m.wait_for_timeout(700)
            check(f'no horizontal overflow on mobile {route}', not m.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"))
        m.goto(f'{BASE}/#/ai'); m.wait_for_selector('#input')
        m.screenshot(path=str(SHOTS / 'chat-mobile.png'))
        tablet = browser.new_context(viewport={'width': 820, 'height': 1100}, color_scheme='dark', bypass_csp=True)
        t = tablet.new_page()
        t.goto(f'{BASE}/#/visualizer/dijkstra'); t.wait_for_selector('#stepCount'); t.wait_for_timeout(600)
        check('no horizontal overflow on tablet', not t.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"))
        t.screenshot(path=str(SHOTS / 'visualizer-tablet.png'))

        check('no uncaught page errors or console errors', not problems, '; '.join(problems[:3]))
        browser.close()
finally:
    app.terminate(); mock.terminate()

passed = sum(results)
print(f'UI test: {passed}/{len(results)} checks passed')
sys.exit(0 if passed == len(results) else 1)
