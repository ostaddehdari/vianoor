export type MediaStat = {
  id: string;
  type: string;
  timestamp: number;
  bytesSent?: number;
  bytesReceived?: number;
  packetsLost?: number;
  packetsReceived?: number;
  jitter?: number;
  currentRoundTripTime?: number;
  nominated?: boolean;
  state?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
};
export function summarizeMediaStats(rows: MediaStat[], previous: Map<string, MediaStat>) {
  let latency = 0,
    jitter = 0,
    lost = 0,
    received = 0,
    bitrate = 0,
    relay = false,
    transport = false;
  const unique = new Map(rows.map((r) => [r.id, r]));
  for (const r of unique.values()) {
    if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
      transport = true;
      latency = Math.max(latency, (r.currentRoundTripTime ?? 0) * 1000);
      relay =
        relay ||
        unique.get(r.localCandidateId ?? '')?.candidateType === 'relay' ||
        unique.get(r.remoteCandidateId ?? '')?.candidateType === 'relay';
    }
    if (r.type === 'inbound-rtp' || r.type === 'outbound-rtp') {
      jitter = Math.max(jitter, (r.jitter ?? 0) * 1000);
      const old = previous.get(r.id);
      if (old && r.timestamp > old.timestamp) {
        const bytes = r.bytesSent ?? r.bytesReceived ?? 0,
          prior = old.bytesSent ?? old.bytesReceived ?? 0;
        bitrate += (Math.max(0, bytes - prior) * 8000) / (r.timestamp - old.timestamp);
        lost += Math.max(0, (r.packetsLost ?? 0) - (old.packetsLost ?? 0));
        received += Math.max(0, (r.packetsReceived ?? 0) - (old.packetsReceived ?? 0));
      }
    }
  }
  previous.clear();
  for (const [id, r] of unique) previous.set(id, r);
  return {
    latency: Math.min(60000, latency),
    jitter: Math.min(60000, jitter),
    loss: lost + received ? (100 * lost) / (lost + received) : 0,
    bitrate: Math.min(100000000, bitrate),
    route: transport ? (relay ? 'relay' : 'direct') : 'unknown',
  };
}
