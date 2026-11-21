# TrekTalk

TrekTalk connects up to ten phones on the same Wi-Fi network. A participant can hold a button to show a visual signal to one person or the group. The app never requests the microphone, sends voice or plays audio. Guests scan the host QR with the rear camera. If a browser withholds local network addresses, either role may need rear camera access to enable the connection. The permission check closes the camera immediately.

## Join

1. Open TrekTalk v17 on each phone before the trek. Wait for **Ready offline · v17** and connect all phones to the same Wi-Fi or hotspot.
2. Tap **Host a group** to create a fresh group QR. Keep the QR visible while people join.
3. Each guest taps **Scan a QR code** and scans the host QR once with the rear camera. The host sees their name and connection status below the QR. Guests enter the group automatically.
4. Tap **Open group** on the host. Hold **Signal everyone** or an individual person’s button. The selected phones display the sender’s name until release. Keep TrekTalk in the foreground.

## Silent pairing service

The QR carries a random 128-bit group secret. Browsers exchange encrypted WebRTC offers and answers using a short-lived HTTPS mailbox. Room names, device labels and local connection details are encrypted, and visual signals go over a local WebRTC data channel. People who can see the QR can request to join. **Refresh group QR** rotates the invitation for new joins. Confirmed members keep their connections.

The default mailbox runs on Vercel and needs internet for a new join. Connected phones keep working on the shared hotspot after internet access is lost. A cached website alone cannot receive another phone's connection reply.

For new joins without internet, run the included local pairing service on a device on the same Wi-Fi. It needs Node.js and a TLS certificate for its local address that each phone trusts. For example:

```sh
node server/local.cjs certificate.pem private-key.pem 8443
```

Before joining, enter that service's HTTPS address in **Pairing settings** on every phone. Allow local network access when the browser asks. The service holds encrypted packets in memory for 90 seconds. No cloud fallback occurs when a local service is selected. Keep Wi-Fi peer communication enabled. A hotspot alone does not supply the pairing service.

## Deployment and checks

Deploy the repository as a static site with its Node function on Vercel. The same-origin endpoint is /api/pair. It uses the Vercel Runtime Cache with a 90-second TTL. If the cache or network is unavailable the app reports a pairing error.

Run `node --test tests/*.cjs` for routing and mailbox checks. The browser workflow exercises a single guest scan, blocks microphone requests and audio playback throughout the session, and tests individual and group visual signals after the signaling endpoint is disconnected. Physical iOS and Android combinations need field testing.

## Mobile checks

The browser workflow tests Chromium, Firefox and WebKit on macOS in all nine host and guest combinations. These tests use QR photo import with simulated camera failures, real WebRTC data channels, touch press cancellation, cached offline startup and layouts at 320, 568 and 768 pixels with enlarged text. The separate ten participant test uses rear camera video fixtures and simultaneous joins.

Camera errors keep the guest on the pairing screen. Options can restart the rear camera or read a QR photo. The scanner falls back to its bundled decoder if the native detector fails or takes longer than 80 milliseconds. All camera requests require the rear camera.

Use a current browser with WebRTC, HTTPS and Web Crypto. Embedded browsers can restrict these features. Test physical Android and iOS devices before relying on the app on a trek. Phones must remain on a shared network with peer traffic enabled and keep the app in the foreground. Browser tests cannot certify every handset, operating system version or hotspot.

If no local address is available, the app retries once after a rear camera permission check. This handles browser restrictions on local WebRTC addresses. Hosts keep showing their QR and never need to scan a guest. Denied access is reported with instructions to change browser settings.

## QR detection and interface

The live scanner first reads a 360 pixel square crop aligned with the visible camera preview. It checks a higher resolution crop and the full frame when needed. Rear camera requests prefer 1280 by 720 video at 24 frames per second. These values are optional camera preferences.

The QR timing test measures from the first presented QR image to the on-screen QR scanned state. It covers landscape and portrait camera frames, rotated codes, smaller codes, a stalled native decoder, and a run with sixfold CPU throttling. Each test must complete in under two seconds. This measures recognition separately from camera permission, camera startup and the WebRTC connection. Physical phone focus, lighting and processing speed still affect recognition.

The home actions share one card. The host screen groups QR refresh, the code, guest status and the primary action together. The group screen keeps the broadcast button above individual controls.
