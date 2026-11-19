# TrekTalk

An offline group radio for a shared Wi-Fi network or phone hotspot. Version 11 supports one host and up to nine guests. Sound and connection control go directly over local WebRTC data channels. Vercel distributes the static app before the trek.

## First use

1. On each phone, open the HTTPS site while online. Wait for **Ready offline · v11**. If using an iPhone Home Screen installation, open the installed app while online too.
2. Turn off mobile data. Keep the OnePlus hotspot on and connect each guest to it. Leave the app in the foreground.
3. On the guest phone enter a name, tap **Show my join QR**, and allow microphone access. Leave this QR on screen. The guest never opens a camera.
4. On the host enter a name and tap **Host a group**. Allow rear camera and microphone access. Point the rear camera at the guest QR once. Keep the phones close with the host speaker audible and headphones disconnected.
5. The host sends its connection reply as a short series of audible tones. The guest microphone decodes it locally and Talkie opens automatically when the connection is confirmed. The host can then scan the next guest. If sound is missed the host retries automatically. To replace an expired guest invitation use **Options → Refresh join QR offline** on the guest.
6. Tap **Go to Talkie** on the host when everyone has paired. All paired guests can now transmit.
7. Hold **Talk to everyone** to broadcast. Hold **Talk to [name]** for an individual transmission. Release to listen. The host grants one speaker the channel at a time. A private transmission is forwarded only to the selected listener. The host routes all guest traffic.
8. The host can select **Pair another phone** to add or reconnect a guest. Leaving the host group ends it. Closing a guest removes that radio from the roster.

## How it works

- Each guest creates an independent WebRTC offer and a random 128-bit invitation key. The host scans the QR containing both. It compresses its answer using the offer as a dictionary and authenticates and encrypts the answer with AES-GCM. An audible multi-frequency signal carries the answer to the nearby guest. No internet or local signaling server is required.
- A synchronization sweep, calibration tones and interleaved parity blocks help the receiver decode the audio. The guest accepts only a reply authenticated with its invitation key. Both phones must use v11. The microphone listens locally during guest pairing and returns to push-to-talk mode on connection.
- Two local data channels carry reliable ordered control and time-sensitive unordered voice. Microphone audio is sampled at 16 kHz, encoded as 20 ms µ-law frames and played through Web Audio. The microphone track starts muted. Transmission begins only after a channel grant and stops on release, cancellation, loss of focus or disconnection.
- The hub checks the grant, sender and destination of every audio packet. A short renewable lease clears abandoned transmissions. No audio is stored. Individual transmissions pass through the host, which must be trusted.
- The camera stops when Talkie opens. Rear camera focus, lighting, permissions and local network setup affect pairing time. There is no guaranteed scan time, range, screen-lock operation or emergency service connection. Stay within hotspot range. The hotspot must permit local traffic to its host.
- If the host shows **QR read** but the guest still shows its code, check the host media volume and guest microphone permission. Keep the apps open and the phones close. Check that both use the same hotspot.

## Deployment and checks

Static site, no build, database or server keys. Import the repository in Vercel, choose **Other**, use the root directory, and deploy over HTTPS. A service worker saves all scripts, the audio worklet and the QR libraries. Versioned asset URLs prevent earlier cached scripts from mixing with this version.

Run `node --test tests/*.cjs` for the protocol and channel checks. For a physical test, verify guest-to-host, host-to-guest, guest-to-guest, broadcast, simultaneous press, release, disconnect and rejoin with mobile data off. Test camera speed and loudspeaker output on the actual phones.

Bundled libraries: qrcode-generator, jsQR and pako. See the license notices in vendor.
