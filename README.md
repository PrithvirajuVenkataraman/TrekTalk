# TrekTalk

TrekTalk connects up to ten phones on the same Wi-Fi network. A participant can hold a button to show a visual signal to one person or the group. The app never requests the microphone, sends voice or plays audio. Only guests need the camera to scan a QR.

## Join

1. Open TrekTalk v15 on each phone before the trek. Wait for **Ready offline · v15** and connect all phones to the same Wi-Fi or hotspot.
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
