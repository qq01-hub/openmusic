import { url } from '@kit.ArkTS';
import { NavigationPolicy, WebAddress } from './NavigationPolicy';

export function createNavigationPolicy(origin: string): NavigationPolicy {
  return new NavigationPolicy(origin, (raw: string): WebAddress => {
    const address = url.URL.parseURL(raw);
    return {
      protocol: address.protocol,
      hostname: address.hostname,
      port: address.port,
      pathname: address.pathname,
      search: address.search,
      hash: address.hash,
      username: address.username,
      password: address.password
    };
  });
}
