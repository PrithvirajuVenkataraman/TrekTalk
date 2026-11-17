# TrekTalk

Experimental two-phone offline push-to-talk web app for OnePlus 7T and iPhone 15 Pro Max. Real-device compatibility and range are NOT yet verified. This is not a six-to-ten-device implementation or emergency communication system.

## Deploy to Vercel
1. Import this GitHub repository as a new Vercel project.
2. Choose **Other** as the framework. Leave the build command empty. Use the repository root as the output directory (`.` if required). No install command, environment variables, API keys, database, or signaling server are required.
3. Deploy and open the HTTPS URL on both phones while online. Wait for **Offline files saved**. On iPhone use Safari and optionally Share > Add to Home Screen. Open the installed app while still online and wait for the same message there too.
4. Close and reopen once. Confirm that the page also reloads with internet disabled before attempting voice.

## Offline phone test
1. Turn off mobile data on both phones. Turn on the OnePlus hotspot and connect the iPhone. Keep both screens on and the app in the foreground.
2. On OnePlus tap **Create offer** and allow microphone access.
3. On iPhone tap **Scan code** inside TrekTalk, allow camera access, and scan the OnePlus code. Allow microphone access when requested. The iPhone displays a reply QR.
4. On OnePlus tap **Scan code** and scan the iPhone reply.
5. Wait for **Connection: connected** on both. Tap **Enable speaker** if audio does not start.
6. Hold the talk button on one device and speak. Release, then try the other device. Take turns. Move phones apart to avoid feedback.
7. Test with all internet still disabled. Record OS/browser versions, distance, sound quality, screen-lock behaviour, and reconnection behaviour.

The QR codes must be scanned inside the app, not the system Camera app. Manual text codes are available as a fallback. Codes contain session credentials: exchange only with your intended partner. Pairing is two-way and uses complete ICE gathering, compressed SDP and local QR libraries. No public STUN or TURN server is configured. Browser local-address privacy, mDNS resolution, hotspot client isolation, or OS restrictions may prevent local WebRTC. A successful hotspot connection alone does not prove WebRTC will work.

## Limits and troubleshooting
- Two phones only. No mesh, automatic peer discovery, GPS sharing, background guarantee, or enforced single-speaker arbitration.
- Keep screens on. Hidden pages immediately mute the microphone. Reconnection may require **Disconnect / start again** on BOTH phones and a fresh QR exchange.
- If connection fails, check both phones are on the same local network, allow camera/microphone/local-network permissions when offered, and retry. Compare against a shared router without internet to isolate hotspot limitations.
- Camera and microphone need HTTPS (or localhost for desktop development). A plain HTTP LAN server is not sufficient on phones.
- Offline assets can be evicted by the browser. Always confirm offline loading before leaving internet coverage.
- Updates install in the background and activate after existing app windows close. Increment the cache name in sw.js when changing assets.
- Voice uses WebRTC encrypted media. There is no recording or analytics. The peer connection remains active between presses; release disables the audio track rather than closing the microphone session. Disconnect releases hardware.

## Local development
Serve this directory with any static server. No build step is needed. `node --check app.js` and `node --check sw.js` check syntax. Real-phone testing remains required.

## Third-party code
Bundled locally so offline mode has no CDN dependency: qrcode-generator 2.0.4, jsQR 1.4.0, pako 3.0.3. See vendor license files.
