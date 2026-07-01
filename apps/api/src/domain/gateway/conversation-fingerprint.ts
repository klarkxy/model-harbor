import { createHash } from 'node:crypto';
import type { ChatRequestIR } from '@manageyourllm/shared';

/**
 * 基于 system prompt 与前 N 条用户/助手消息生成确定性指纹。
 * 用于 conversation sticky 绑定：同一对话前缀应得到相同哈希。
 */
export function computeConversationFingerprint(ir: ChatRequestIR, messageLimit = 6): string {
  const parts: string[] = [];
  if (ir.system) {
    parts.push(`system:${ir.system}`);
  }
  for (let i = 0; i < Math.min(ir.messages.length, messageLimit); i++) {
    const msg = ir.messages[i];
    if (msg) {
      parts.push(`${msg.role}:${msg.content ?? ''}`);
    }
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
