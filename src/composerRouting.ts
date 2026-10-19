import type { AgentMode } from './agent'

const CONTINUATION = /^(继续(?:吧|执行|生成|做)?|开始(?:吧|执行|生成)?|执行|确认|好的?|可以|按这个做|continue|proceed|go ahead|yes|ok(?:ay)?)[\s.!！。]*$/i

export function composerSendMode(mode: AgentMode, text: string, hasSkill: boolean, hasDocs: boolean): AgentMode {
  if (hasSkill || hasDocs) return 'agent'
  // Direct generators receive only a prompt, not the conversation or skill.
  // A short confirmation of an Agent plan must keep that conversation context.
  if (mode !== 'agent' && CONTINUATION.test(text.trim())) return 'agent'
  return mode
}
