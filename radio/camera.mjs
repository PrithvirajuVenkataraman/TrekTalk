export async function openRearCamera(media = navigator.mediaDevices) {
  if (!media?.getUserMedia || media.getSupportedConstraints?.().facingMode === false) {
    throw Error('This browser cannot select a rear camera. Use Options to read a QR photo, or open TrekTalk in your phone browser.');
  }
  const stream = await media.getUserMedia({
    video: {facingMode: {exact:'environment'}, width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:24}},
    audio: false
  });
  const track = stream.getVideoTracks()[0];
  const facing = track?.getSettings?.().facingMode;
  if (!track || (facing && facing !== 'environment')) {
    stream.getTracks().forEach(item => item.stop());
    throw Error('Rear camera unavailable. Use Options to read a QR photo.');
  }
  return stream;
}
