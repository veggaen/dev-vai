import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright


APP_URL = os.environ.get("VAI_APP_URL", "http://127.0.0.1:5173/?devAuthBypass=1")
RUNTIME_URL = os.environ.get("VAI_RUNTIME_URL", "http://127.0.0.1:3006")
PROMPT = os.environ.get(
    "VAI_VENUE_UI_PROMPT",
    "can you find the current menu for the Jafs restaurant closest to Helsfyr?",
)
OUTPUT_DIR = Path("screenshots/general-venue")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


request = Request(f"{RUNTIME_URL}/api/platform/bootstrap", headers={"x-vai-dev-auth-bypass": "1"})
with urlopen(request, timeout=15) as response:
    bootstrap = json.load(response)

bootstrap["auth"] = {
    **bootstrap.get("auth", {}),
    "enabled": False,
    "authenticated": True,
    "user": {
        "id": "general-venue-visual",
        "email": "general-venue@test.local",
        "name": "General Venue QA",
    },
}

executable_candidates = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]
executable_path = next((str(path) for path in executable_candidates if path.exists()), None)
if executable_path is None:
    raise RuntimeError("No installed Chrome or Edge executable was found")

console_errors = []
failures = []
screenshots = {
    "recon": str(OUTPUT_DIR / "recon.png"),
    "answer": str(OUTPUT_DIR / "jafs-teisen-answer.png"),
    "sources": str(OUTPUT_DIR / "jafs-teisen-sources.png"),
}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=executable_path, headless=True)
    page = browser.new_page(viewport={"width": 1536, "height": 960})
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: console_errors.append(str(error)))
    page.route(
        "**/api/platform/bootstrap",
        lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(bootstrap)),
    )
    page.route(
        "**/api/auth/me",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"authenticated": True, "user": bootstrap["auth"]["user"]}),
        ),
    )

    # Reconnaissance before interaction: wait for the dynamic app, preserve the
    # settled frame, and discover the actual composer/message selectors.
    page.goto(APP_URL, wait_until="networkidle", timeout=45_000)
    page.screenshot(path=screenshots["recon"], full_page=True)
    textarea = page.locator("textarea").first
    textarea.wait_for(state="visible", timeout=30_000)
    assistant = page.locator('[data-chat-message-role="assistant"]')
    before = assistant.count()

    textarea.fill(PROMPT)
    textarea.press("Enter")
    page.wait_for_function(
        """({selector, previous}) => {
          const rows = [...document.querySelectorAll(selector)];
          if (rows.length <= previous) return false;
          const latest = rows.at(-1)?.textContent || '';
          return /Closest verified branch/i.test(latest)
            && /Jafs Teisen/i.test(latest)
            && (latest.match(/99,-|129,-|149,-|159,-/g) || []).length >= 3;
        }""",
        arg={"selector": '[data-chat-message-role="assistant"]', "previous": before},
        timeout=180_000,
    )
    page.locator('button[title="Send message (Enter)"]').wait_for(state="visible", timeout=45_000)

    latest = assistant.last
    answer_text = " ".join(latest.inner_text().split())
    answer_html = latest.inner_html()
    latest.get_by_text("Closest verified branch:", exact=False).last.scroll_into_view_if_needed()
    page.screenshot(path=screenshots["answer"], full_page=True)

    open_panel = page.locator('[data-research-sidebar="panel"][data-state="open"]')
    if open_panel.count() == 0:
        source_toggle = page.locator('[data-research-sidebar-toggle="button"]').first
        if source_toggle.count() > 0:
            source_toggle.click()
        else:
            page.locator('[data-research-source-summary="button"]').last.click()
    page.wait_for_function(
        """() => [...document.querySelectorAll('[data-research-sidebar="panel"][data-state="open"]')]
          .some((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })""",
        timeout=10_000,
    )
    source_panel = page.locator('[data-research-sidebar="panel"][data-state="open"]')
    source_text = " ".join(" ".join(source_panel.all_inner_texts()).split())
    page.screenshot(path=screenshots["sources"], full_page=True)

    if "Jafs Teisen" not in answer_text:
        failures.append("nearest JAFS Teisen branch is missing")
    if sum(answer_text.count(price) for price in ("99,-", "129,-", "149,-", "159,-")) < 3:
        failures.append("itemized menu prices are missing")
    if "SHOW CODE" in answer_text or "```json" in answer_html:
        failures.append("answer rendered as code instead of prose")
    if "openstreetmap" not in source_text.lower() or "jafs" not in source_text.lower():
        failures.append("proximity and first-party sources are not both visible")
    if console_errors:
        failures.append(f"{len(console_errors)} console error(s)")

    browser.close()

report = {
    "passed": not failures,
    "failures": failures,
    "answerText": answer_text,
    "sourceText": source_text,
    "consoleErrors": console_errors,
    "screenshots": screenshots,
}
print(json.dumps(report, indent=2, ensure_ascii=False))
if failures:
    raise SystemExit(1)
