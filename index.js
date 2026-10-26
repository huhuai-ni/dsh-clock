/**
 * dsh-clock —— 让本鲸知道「现在几点」
 * ============================================================================
 * 解决一个具体的蠢问题：分不清下午五点还是凌晨五点，说出「夜深了」这种话。
 *
 * 工具：
 *   clock_now    当前时间 + 星期 + 时段 + 该用什么口吻（一句话建议）
 *   clock_until  距离某个时刻（23:00 / 明天 08:00）还有多久
 *   clock_diff   两个时间点之间差多久
 * ============================================================================
 */

export const name = 'dsh-clock'
export const inject = ['tools']

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 时段划分 → 口吻建议 */
function periodOf(h, m) {
  const t = h * 60 + m
  if (t < 5 * 60) return { key: '凌晨', hint: '凌晨了。别再说「今天」——对方可能一整夜没睡，先问一句还在不在。' }
  if (t < 8 * 60) return { key: '清晨', hint: '清晨。说「早」比说「晚安」对。' }
  if (t < 11 * 60) return { key: '上午', hint: '上午。正常干活的时间，说正事。' }
  if (t < 13 * 60) return { key: '中午', hint: '中午。先问吃没吃饭，再谈别的。' }
  if (t < 17 * 60) return { key: '下午', hint: '下午。别用「夜深了」「早点睡」这类话。' }
  if (t < 19 * 60) return { key: '傍晚', hint: '傍晚。快到饭点了。' }
  if (t < 23 * 60) return { key: '晚上', hint: '晚上。可以说「晚安」，但先看对方还在不在。' }
  return { key: '深夜', hint: '深夜。别硬聊，问一句要不要睡。' }
}

const pad = (n) => String(n).padStart(2, '0')

function snapshot(now = new Date()) {
  const y = now.getFullYear()
  const mo = now.getMonth() + 1
  const d = now.getDate()
  const h = now.getHours()
  const mi = now.getMinutes()
  const s = now.getSeconds()
  const p = periodOf(h, mi)
  const offsetMin = -now.getTimezoneOffset()
  const offStr = `${offsetMin >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
  const dayStart = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime()
  const dayEnd = dayStart + 86400000
  const progress = Math.min(1, Math.max(0, (now.getTime() - dayStart) / 86400000))

  return {
    ok: true,
    local: `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`,
    date: `${y}-${pad(mo)}-${pad(d)}`,
    time: `${pad(h)}:${pad(mi)}`,
    weekday: WEEK[now.getDay()],
    is_weekend: now.getDay() === 0 || now.getDay() === 6,
    period: p.key,
    hour24: h,
    minute: mi,
    timezone: tz,
    utc_offset: offStr,
    iso: now.toISOString(),
    unix: Math.floor(now.getTime() / 1000),
    day_progress: `${Math.round(progress * 100)}%`,
    minutes_left_today: Math.round((dayEnd - now.getTime()) / 60000),
    hint: p.hint,
  }
}

/** 解析 "23:00" / "8:30" 成当天的 Date；已过则取明天 */
function parseClock(str, base = new Date()) {
  const m = String(str).trim().match(/^(\d{1,2})[:：](\d{2})$/)
  if (!m) return null
  const h = Number(m[1]); const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, mi, 0, 0)
  if (t.getTime() <= base.getTime()) t.setDate(t.getDate() + 1)
  return t
}

function humanGap(ms) {
  const total = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  const parts = []
  if (d) parts.push(`${d} 天`)
  if (h) parts.push(`${h} 小时`)
  if (m || parts.length === 0) parts.push(`${m} 分钟`)
  return parts.join(' ')
}

export function apply(ctx) {
  const defineTool = (o) => o
  const textOutput = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
  }
  const tool = (spec) => ctx.tools.register(defineTool({
    ...spec,
    output: textOutput,
    async execute(args) {
      try { return await spec.execute(args || {}) } catch (e) { return { ok: false, error: String(e?.message || e) } }
    },
  }))

  tool({
    name: 'clock_now',
    description: '现在几点：本地时间、星期、时段、距离今天结束还有多久，以及「该怎么开口」的一句话建议。说话前先调它，别再分不清下午和凌晨。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return snapshot(new Date()) },
  })

  tool({
    name: 'clock_until',
    description: '距离某个时刻还有多久。例：clock_until { time: "23:00" } —— 过了这个点就算到明天。',
    parameters: {
      type: 'object',
      properties: {
        time: { type: 'string', description: 'HH:mm，例如 23:00、08:30' },
      },
      required: ['time'],
      additionalProperties: false,
    },
    async execute({ time }) {
      const now = new Date()
      const target = parseClock(time, now)
      if (!target) return { ok: false, error: '时间格式不对，要 HH:mm，例如 23:00' }
      const ms = target.getTime() - now.getTime()
      return {
        ok: true,
        now: snapshot(now),
        target: `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${pad(target.getHours())}:${pad(target.getMinutes())}`,
        gap: humanGap(ms),
        minutes: Math.round(ms / 60000),
      }
    },
  })

  tool({
    name: 'clock_diff',
    description: '两个时间之间差多久。参数用 ISO 或 "YYYY-MM-DD HH:mm"，例如 clock_diff { from: "2026-10-23 09:00", to: "2026-10-23 18:00" }。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    async execute({ from, to }) {
      const parse = (s) => {
        const t = new Date(String(s).replace(' ', 'T'))
        return isNaN(t.getTime()) ? null : t
      }
      const a = parse(from); const b = parse(to)
      if (!a || !b) return { ok: false, error: '时间解析失败，用 ISO 或 "YYYY-MM-DD HH:mm"' }
      const ms = b.getTime() - a.getTime()
      return { ok: true, from: a.toISOString(), to: b.toISOString(), gap: humanGap(Math.abs(ms)), minutes: Math.round(ms / 60000), direction: ms >= 0 ? 'to 在 from 之后' : 'to 在 from 之前' }
    },
  })
}
