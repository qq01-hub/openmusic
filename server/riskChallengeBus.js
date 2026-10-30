export function riskChallengeChannel(client, prefix = 'openmusic:risk:v1:') {
  return `${prefix}human-challenge:db:${client.options?.database ?? 0}`;
}

// 每实例一个订阅连接，消息只携带账户或会话标识，状态仍以 Redis 为准
export function createRiskChallengeBus({ client, onChallenge, onSessionRevoked = () => {}, onUnavailable, onRecovered, metric = () => {}, prefix }) {
  const subscriber = client.duplicate({ disableOfflineQueue: true, commandsQueueMaxLength: 32 });
  let subscribed = false;
  let stopped = false;
  let interrupted = false;
  const unavailable = () => {
    if (stopped || interrupted) return;
    interrupted = true;
    metric('risk_challenge_bus_total', { outcome: 'unavailable' });
    onUnavailable();
  };
  subscriber.on('error', unavailable);
  subscriber.on('reconnecting', unavailable);
  subscriber.on('end', unavailable);
  subscriber.on('ready', () => {
    if (!subscribed || stopped) return;
    interrupted = false;
    // Pub/Sub 不补发断线期间的消息，恢复时撤销旧连接，由新握手重新检查权威状态
    onRecovered();
  });
  return {
    isReady: () => subscribed && subscriber.isReady && !interrupted && !stopped,
    async start() {
      await subscriber.connect();
      await subscriber.subscribe(riskChallengeChannel(client, prefix), id => {
        if (/^session:[A-Za-z0-9_-]{24}$/u.test(id)) { onSessionRevoked(id.slice(8)); return; }
        if (!/^acct_[a-zA-Z0-9_-]{16,64}$/u.test(id)) return;
        metric('risk_challenge_bus_total', { outcome: 'received' });
        onChallenge(id);
      });
      subscribed = true;
      interrupted = false;
    },
    stop() {
      stopped = true;
      subscribed = false;
      if (subscriber.isOpen) subscriber.destroy();
    },
  };
}
