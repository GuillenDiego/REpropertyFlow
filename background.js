// ====== CONFIG ======
const WEBHOOK_URL = "https://hooks.zapier.com/hooks/catch/24955900/urkbmju/"; // <-- change this

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  try {
    // Run in-page: scrape address parts from the DOM
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeZillowAddress
    });

    if (!result || !result.ok) throw new Error(result?.error || "Address not found");

    // Build the payload to send to your webhook
    const payload = {
      address: result.fullAddress,          // "5904 E 7 St, Tulsa, OK 74112"
      street: result.street || null,
      city: result.city || null,
      state: result.state || null,
      zip: result.zip || null,
      sourceUrl: result.url,                // page URL (for traceability)
      capturedAt: new Date().toISOString()  // timestamp
    };

    // POST from the service worker (avoids most CORS issues)
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Webhook HTTP ${res.status} ${res.statusText} ${text}`);
    }

    // Optional: visible success in SW console
    console.log("Webhook sent:", payload);

  } catch (err) {
    console.error("Failed to send address to webhook:", err);
  }
});

/**
 * Runs in the page context. Targets the markup you showed:
 * <span id="propertyAddress"> 
 *   <span>(street)</span>
 *   <span>(city)</span>, 
 *   <span>(state)</span>
 *   <span>(zip)</span>
 * </span>
 *
 * If #propertyAddress isn't found, it tries flexible selectors by their data-bind.
 */
function scrapeZillowAddress() {
  try {
    const byText = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

    // Prefer the exact container
    let container = document.querySelector("#propertyAddress");

    // If not found, try to locate spans by their data-bind as in your snippet
    // This also works even if the outer container id changes.
    const selAddr = 'span[data-bind*="PropertyDetails.Address"]';
    const selCity = 'span[data-bind*="PropertyDetails.City"]';
    const selState = 'span[data-bind*="PropertyDetails.State"]';
    const selZip = 'span[data-bind*="PropertyDetails.Zip"]';

    // Try resolving each part with context limited to #propertyAddress if present
    const scope = container || document;

    let street = byText(scope.querySelector(selAddr));
    let city   = byText(scope.querySelector(selCity));
    let state  = byText(scope.querySelector(selState));
    let zip    = byText(scope.querySelector(selZip));

    // If still empty and we had a container, try global as a fallback
    if (!street && container) street = byText(document.querySelector(selAddr));
    if (!city && container)   city   = byText(document.querySelector(selCity));
    if (!state && container)  state  = byText(document.querySelector(selState));
    if (!zip && container)    zip    = byText(document.querySelector(selZip));

    // Clean common artifacts (extra commas/spaces)
    const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/,+/g, ",").trim();
    street = clean(street);
    city   = clean(city);
    state  = clean(state);
    zip    = clean(zip);

    // Build "Street, City, ST ZIP"
    const parts = [];
    if (street) parts.push(street);
    const cs = [city, state].filter(Boolean).join(", ");
    const tail = [cs, zip].filter(Boolean).join(" ");
    const fullAddress = [parts.join(" "), tail].filter(Boolean).join(", ").replace(/\s+,/g, ",");

    if (!fullAddress) {
      return { ok: false, error: "Could not find address fields on the page." };
    }

    return {
      ok: true,
      url: location.href,
      street, city, state, zip,
      fullAddress
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
