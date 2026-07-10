/** Shared mic constraints — cleaner capture for speech recognition. */
export function buildMicConstraints(deviceId?: string): MediaStreamConstraints {
  const processing: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48_000,
  };
  if (deviceId) {
    return { audio: { ...processing, deviceId: { exact: deviceId } } };
  }
  return { audio: processing };
}