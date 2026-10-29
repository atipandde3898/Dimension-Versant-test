/**
 * Shared audio stream manager so microphone permission is requested once
 * on the instructions page and reused seamlessly during the test.
 */

let sharedStream: MediaStream | null = null;

export async function requestAndStoreAudioStream(): Promise<MediaStream> {
  if (sharedStream && sharedStream.active) {
    const liveTracks = sharedStream.getAudioTracks().filter((t) => t.readyState === 'live');
    if (liveTracks.length > 0) {
      return sharedStream;
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  sharedStream = stream;
  return stream;
}

export function getActiveAudioStream(): MediaStream | null {
  if (sharedStream && sharedStream.active) {
    const liveTracks = sharedStream.getAudioTracks().filter((t) => t.readyState === 'live');
    if (liveTracks.length > 0) {
      return sharedStream;
    }
  }
  return null;
}

export function stopActiveAudioStream(): void {
  if (sharedStream) {
    try {
      sharedStream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      console.warn('Error stopping audio tracks:', e);
    }
    sharedStream = null;
  }
}
