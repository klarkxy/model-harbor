// Phase 3 将实现真实路由决策服务。
// 本文件仅作为分层占位，避免后续重构破坏目录约定。

export class RoutingPolicyService {
  constructor() {}

  // 占位方法，真实实现将返回候选排序与过滤结果。
  decide(): { policy: string } {
    return { policy: 'priority' };
  }
}
