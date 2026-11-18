# TrekTalk

An offline group radio for a shared Wi-Fi network or phone hotspot. Version 9 supports one host and up to nine guests. Sound and connection control go directly over local WebRTC data channels. Vercel distributes the static app before the trek.

## First use

1. On each phone, open the HTTPS site while online. Wait for **Ready offline · v9**. If using an iPhone Home Screen installation, open the installed app while online too.
2. Turn off mobile data. Keep the OnePlus hotspot on and connect each guest to it. Leave the app in the foreground.
3. Enter a name on each phone. On the OnePlus choose **Host a group**. On each guest choose **Scan host QR**. Allow the front camera and microphone when asked.
4. Pair one guest at a time. Face the two screens toward each other, about a handspan apart. The guest reads the invitation, shows its reply automatically and opens Talkie when the host confirms. Both front cameras must see the other screen. The host displays a new invitation for each additional guest.
5. The host can tap the displayed QR to refresh an unused invitation offline. Refreshing keeps everyone already paired. **Options** includes reading a photo and restarting the camera.
6. Once the desired guests are paired, tap **Go to Talkie** on the host. All paired guests can now transmit. A phone that has only scanned the invitation still has to complete its return exchange.
7. Hold **Talk to everyone** to broadcast. Hold **Talk to [name]** for an individual transmission. Release to listen. The host grants one speaker the channel at a time. A private transmission is forwarded only to the selected listener. The host routes all guest traffic.
8. The host can select **Pair another phone** to add or reconnect a guest. Leaving the host group ends it. Closing a guest removes that radio from the roster.

## How it works

- Each guest has an independent WebRTC connection to the host. A compact QR carries only the data-channel session description, including local ICE addresses. The two front cameras exchange descriptions. No cloud server, APK, API key, internet joining, or second manual scan is needed for that flow.
- The six-digit number identifies the group. New invitations have independent random nonces and WebRTC credentials. Each reply must match the current invitation. An older TrekTalk version cannot join a v9 group.
- Two local data channels carry reliable ordered control and time-sensitive unordered voice. Microphone audio is sampled at 16 kHz, encoded as 20 ms µ-law frames and played through Web Audio. The microphone track starts muted. Transmission begins only after a channel grant and stops on release, cancellation, loss of focus or disconnection.
- The hub checks the grant, sender and destination of every audio packet. A short renewable lease clears abandoned transmissions. No audio is stored. Individual transmissions pass through the host, which must be trusted.
- The camera stops when Talkie opens. Front-camera focus, lighting, permissions and local network setup affect pairing time. There is no guaranteed scan time, range, screen-lock operation or emergency service connection. Stay within hotspot range. The hotspot must permit local traffic to its host.
- If both screens show a QR but pairing stalls, keep the devices facing each other and check camera permissions on both. If needed, use **Options → Read QR from photo**. Switch back to the TrekTalk screen after taking a picture. Keep the host QR unchanged during a pairing attempt.

## Deployment and checks

Static site, no build, database or server keys. Import the repository in Vercel, choose **Other**, use the root directory, and deploy over HTTPS. A service worker saves all scripts, the audio worklet and the QR libraries. Versioned asset URLs prevent earlier cached scripts from mixing with this version.

Run `node --test tests/*.cjs` for the protocol and channel checks. For a physical test, verify guest-to-host, host-to-guest, guest-to-guest, broadcast, simultaneous press, release, disconnect and rejoin with mobile data off. Test camera speed and loudspeaker output on the actual phones.

Bundled libraries: qrcode-generator, jsQR and pako. See the license notices in vendor.
