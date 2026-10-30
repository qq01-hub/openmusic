export interface WebAddress {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  username: string;
  password: string;
}

export enum NavigationDecision {
  Allow,
  External,
  Block
}

// 仅决定网页导航，不提供身份、权限或原生桥接能力
export class NavigationPolicy {
  readonly origin: string = '';
  private oauthExpiresAt: number = 0;
  private parser: (raw: string) => WebAddress;

  constructor(serverOrigin: string, parser: (raw: string) => WebAddress) {
    this.parser = parser;
    const address = this.parse(serverOrigin);
    if (/^https:\/\/[^/?#]+\/?$/i.test(serverOrigin) && address && (address.pathname === '' || address.pathname === '/') &&
      address.search === '' && address.hash === '' &&
      !serverOrigin.includes('?') && !serverOrigin.includes('#')) {
      this.origin = this.originOf(address);
    }
  }

  private parse(raw: string): WebAddress | undefined {
    // 拒绝解析器可能自动纠正的空白、反斜杠及无 authority 的输入
    if (raw.length > 8192 || !/^https:\/\/[^/@?#]+(?:[/?#]|$)/i.test(raw) || /[\\\s\u0000-\u001f\u007f]/.test(raw)) {
      return undefined;
    }
    try {
      const address = this.parser(raw);
      if (address.protocol.toLowerCase() !== 'https:' || !address.hostname ||
        address.username !== '' || address.password !== '') {
        return undefined;
      }
      return address;
    } catch {
      return undefined;
    }
  }

  private originOf(address: WebAddress): string {
    const port = address.port === '' || address.port === '443' ? '' : ':' + address.port;
    return 'https://' + address.hostname.toLowerCase() + port;
  }

  private isOauthStart(address: WebAddress): boolean {
    return /^\/api\/auth\/(linuxdo|github)\/start$/.test(address.pathname) ||
      /^\/api\/admin\/(linuxdo|github)\/(login|bind)\/start$/.test(address.pathname);
  }

  decide(raw: string, mainFrame: boolean, userGesture: boolean, now: number): NavigationDecision {
    if (!this.origin) return NavigationDecision.Block;
    if (!mainFrame && (raw === 'about:blank' || raw === 'about:srcdoc')) {
      return NavigationDecision.Allow;
    }
    const address = this.parse(raw);
    if (!address) return NavigationDecision.Block;
    // iframe 仅允许 HTTPS 文档，不开启 OAuth 窗口，也不启动系统浏览器
    if (!mainFrame) return NavigationDecision.Allow;
    if (this.originOf(address) === this.origin) {
      this.oauthExpiresAt = this.isOauthStart(address) ? now + 5 * 60 * 1000 : 0;
      return NavigationDecision.Allow;
    }
    if (now < this.oauthExpiresAt) return NavigationDecision.Allow;
    return userGesture ? NavigationDecision.External : NavigationDecision.Block;
  }

  // 同时检查实际主框架 URL，覆盖程序加载和重定向，观测不能续期 OAuth
  observe(raw: string, now: number): boolean {
    if (!this.origin) return false;
    const address = this.parse(raw);
    if (!address) return false;
    if (this.originOf(address) === this.origin) {
      if (!this.isOauthStart(address)) this.reset();
      return true;
    }
    return now < this.oauthExpiresAt;
  }

  reset(): void {
    this.oauthExpiresAt = 0;
  }

  isTrustedOrigin(raw: string): boolean {
    const address = this.parse(raw);
    return Boolean(this.origin && address && this.originOf(address) === this.origin);
  }
}
