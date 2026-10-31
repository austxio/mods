import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const PERSON = { origin: { kind: 'composer' }, wait: false } as const

const USAGE = {
  input_tokens: 10,
  output_tokens: 10,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const MESSY =
  'ok so the login page, cái nút đăng nhập nó không chạy, I mean the button do nothing when click, ' +
  'maybe fix it but no change the design, or actually change the color also, no wait keep color'

const CLEAN =
  'Task: Fix the login button on the login page; clicking it does nothing.\n' +
  'Why: Users cannot sign in.\n' +
  'Guardrails: Keep the current design and color.\n' +
  'Done when: Clicking the button signs the user in.'

// Stands for the model: the check call and the rewrite call are told apart by their system prompt.
function answerModel(on: On, check: string, rewrite = CLEAN) {
  const calls: string[] = []
  on('model.complete', (_, e) => {
    const kind = e.system?.includes('Reply with JSON only') ? 'check' : 'rewrite'
    calls.push(kind)
    return { value: { isAnswered: true, text: kind === 'check' ? check : rewrite, usage: USAGE } }
  })
  return calls
}

// Stands for the person answering the question dialog: one answer per question, in order.
function answerDialog(on: On, answers: string[]) {
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)
    const answer = answers.shift()
    if (answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  return asked
}

function enter(on: On) {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  return sent
}

test('a clear prompt goes to Claude unchanged, with no questions', async ($, on) => {
  const calls = answerModel(on, '{"clear": true}')
  const asked = answerDialog(on, [])
  const sent = enter(on)

  await $.prompt.submit({ text: 'Run the tests in src/auth', ...PERSON })

  expect(calls).toEqual(['check'])
  expect(asked).toEqual([])
  expect(sent).toEqual(['Run the tests in src/auth'])
})

test('a messy mixed-language prompt is asked about, rewritten, and the clean one is sent', async ($, on) => {
  const calls = answerModel(
    on,
    '{"clear": false, "questions": [{"question": "Should the button color change?", "options": ["Keep color", "Change color"]}]}',
  )
  const asked = answerDialog(on, ['Keep color', 'Send clean'])
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(calls).toEqual(['check', 'rewrite'])
  expect(asked[0]).toBe('Should the button color change?')
  expect(asked[1]).toContain(CLEAN)
  expect(sent).toEqual([CLEAN])
})

test('choosing "Send my original" sends what the person wrote', async ($, on) => {
  answerModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send my original'])
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(sent).toEqual([MESSY])
})

test('a note typed under "Other" is added to the clean prompt', async ($, on) => {
  answerModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['also check the signup page'])
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(sent).toEqual([`${CLEAN}\n\nNote from me: also check the signup page`])
})

test('closing the dialog sends the original', async ($, on) => {
  answerModel(on, '{"clear": false, "questions": [{"question": "Which page?", "options": ["Login", "Signup"]}]}')
  answerDialog(on, [])
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(sent).toEqual([MESSY])
})

test('when the model fails, the original is sent', async ($, on) => {
  on('model.complete', () => ({
    value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE },
  }))
  const asked = answerDialog(on, [])
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(asked).toEqual([])
  expect(sent).toEqual([MESSY])
})

test('a reply that is not JSON lets the prompt through', async ($, on) => {
  answerModel(on, 'I think this is fine.')
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(sent).toEqual([MESSY])
})

test('prompts that are not typed or spoken by the person are not checked', async ($, on) => {
  const calls = answerModel(on, '{"clear": false, "questions": []}')
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, origin: { kind: 'task-notification' }, wait: false })

  expect(calls).toEqual([])
  expect(sent).toEqual([MESSY])
})

test("the check reads Claude's last reply, so a short answer is judged in context", async ($, on) => {
  on('session.messages', () => ({
    value: [{ role: 'assistant', text: 'Should I also update the tests?', toolUses: [] }],
  }))
  const prompts: string[] = []
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: '{"clear": true}', usage: USAGE } }
  })
  const sent = enter(on)

  await $.prompt.submit({ text: 'yes update them too', ...PERSON })

  expect(prompts[0]).toContain('Should I also update the tests?')
  expect(sent).toEqual(['yes update them too'])
})

const DAY = 24 * 60 * 60 * 1000

function command(args: string) {
  return {
    command: 'intent-guard',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  } as const
}

test('both model calls are given a 15 second time limit', async ($, on) => {
  const limits: (number | undefined)[] = []
  on('model.complete', (_, e) => {
    limits.push(e.timeoutMs)
    const text = e.system?.includes('Reply with JSON only') ? '{"clear": false, "questions": []}' : CLEAN
    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  answerDialog(on, ['Send clean'])
  enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(limits).toEqual([15000, 15000])
})

test('a check that runs out of time sends the original', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'aborted', usage: USAGE } }))
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(sent).toEqual([MESSY])
})

test('tiny replies skip the model entirely', async ($, on) => {
  const calls = answerModel(on, '{"clear": false, "questions": []}')
  const sent = enter(on)

  for (const text of ['yes', 'ok', '2', 'do it now']) {
    await $.prompt.submit({ text, ...PERSON })
  }

  expect(calls).toEqual([])
  expect(sent).toEqual(['yes', 'ok', '2', 'do it now'])
})

test('an empty answer under "Other" sends the original, not a blank note', async ($, on) => {
  answerModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['  '])
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(sent).toEqual([MESSY])
})

test('a status line shows while checking and is cleared after', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  answerModel(on, '{"clear": true}')
  enter(on)

  await $.prompt.submit({ text: 'Run the tests in src/auth', ...PERSON })

  expect(statuses).toEqual(['intent-guard: checking…', undefined])
})

test('a rewritten prompt is saved with the original, and /intent-guard last shows both', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 27, 8, 46) })
  on('session.root', () => ({ value: '/home/me/work/app' }))
  answerModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send clean'])
  enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })
  const shown = await $.command.run(command('last'))

  expect(shown.text).toContain(MESSY)
  expect(shown.text).toContain(CLEAN)
  expect(shown.text).toContain('/home/me/work/app')
  expect(shown.context).toBeUndefined()
})

test('prompts sent as written are not saved', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  answerModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send my original'])
  enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })
  const shown = await $.command.run(command('last'))

  expect(shown.text).toBe('intent-guard: nothing saved in the last 7 days.')
})

test('saved originals older than 7 days are deleted', async ($, on) => {
  const now = Date.UTC(2026, 9, 27)
  mock.store(on, {
    history: [
      { at: now - 8 * DAY, folder: '/old', original: 'old words', sent: 'old clean' },
      { at: now - 1 * DAY, folder: '/new', original: 'new words', sent: 'new clean' },
    ],
  })
  mock.clock(on, { now })

  const shown = await $.command.run(command('last 5'))

  expect(shown.text).toContain('new words')
  expect(shown.text).not.toContain('old words')
})

test('/intent-guard clear deletes every saved original', async ($, on) => {
  const now = Date.UTC(2026, 9, 27)
  mock.store(on, { history: [{ at: now, folder: '/a', original: 'words', sent: 'clean' }] })
  mock.clock(on, { now })

  const cleared = await $.command.run(command('clear'))
  const shown = await $.command.run(command('last'))

  expect(cleared.text).toBe('intent-guard: deleted 1 saved original.')
  expect(shown.text).toBe('intent-guard: nothing saved in the last 7 days.')
})

test('/intent-guard off lets prompts through unchecked until /intent-guard on', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const calls = answerModel(on, '{"clear": true}')
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const sent = enter(on)

  const off = await $.command.run(command('off'))
  await $.prompt.submit({ text: MESSY, ...PERSON })
  expect(calls).toEqual([])
  expect(sent).toEqual([MESSY])
  expect(statuses).toContain('intent-guard: off')
  expect(off.text).toContain('off in every session')

  await $.command.run(command('on'))
  await $.prompt.submit({ text: MESSY, ...PERSON })
  expect(calls).toEqual(['check'])
})

test('off is remembered for new sessions and shown in the status line', async ($, on) => {
  mock.store(on, { enabled: false })
  on('command.register', () => ({ value: { command: 'intent-guard' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const statuses: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(statuses).toEqual(['intent-guard: off'])
})

test('attach mode keeps the words as typed and gives Claude the clean prompt as context', async ($, on) => {
  mock.store(on, { mode: 'attach' })
  mock.clock(on)
  answerModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send clean'])
  const seen: { text: string; context?: readonly string[] }[] = []
  on('prompt.submit', (_, e) => {
    seen.push({ text: e.text, context: e.context })
    return { text: e.text }
  })

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(seen[0]?.text).toBe(MESSY)
  expect(seen[0]?.context?.[0]).toContain(CLEAN)
})

test('/intent-guard mode switches between replace and attach', async ($, on) => {
  mock.store(on)

  const before = await $.command.run(command('mode'))
  const attach = await $.command.run(command('mode attach'))
  const bad = await $.command.run(command('mode sideways'))

  expect(before.text).toContain('mode: replace')
  expect(attach.text).toContain('mode: attach')
  expect(bad.text).toBe('intent-guard: the mode is replace or attach.')
})

test('/intent-guard status adds up the tokens of every AI call and estimates the cost', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 27) })
  answerModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send clean'])
  enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })
  const status = await $.command.run(command('status'))

  // Two calls of 10 input + 10 output tokens: (20 × 0.10 + 20 × 0.50) / 1,000,000 dollars.
  expect(status.text).toContain('intent-guard: on · mode replace')
  expect(status.text).toContain('Since 2026-10-27: 2 AI calls, 20 input + 20 output tokens, about $0.0000')
})

function answerOther(on: On, text: string) {
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
    result: { questions: e.questions, answers: { [e.questions[0]?.question ?? '']: text } },
  }))
}

function listenToasts(on: On) {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

// Stands for the model and keeps each call's prompt and system text, by kind.
function recordModel(on: On, check: string, rewrite = CLEAN) {
  const seen: Record<string, { prompt: string; system: string }> = {}
  on('model.complete', (_, e) => {
    const system = String(e.system ?? '')
    const kind = system.includes('Reply with JSON only') ? 'check' : 'rewrite'
    seen[kind] = { prompt: String(e.prompt), system }
    return { value: { isAnswered: true, text: kind === 'check' ? check : rewrite, usage: USAGE } }
  })
  return seen
}

const NOTE =
  'Here is a note offered by a side agent:\n\n> Heads up · The branch only pushes once.\n>\n> - **One option:** approve an earlier push.'

test('a forwarded note with no words of the person is sent as it is, with no check', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const calls = answerModel(on, '{"clear": false, "questions": []}')
  const sent = enter(on)

  await $.prompt.submit({ text: NOTE, ...PERSON })

  expect(calls).toEqual([])
  expect(sent).toEqual([NOTE])
})

test('with a forwarded note only the words of the person are judged, and the note stays word for word', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const seen = recordModel(on, '{"clear": false, "questions": []}', 'Task: I agree with the note. Push earlier.')
  answerDialog(on, ['Send clean'])
  const sent = enter(on)

  await $.prompt.submit({ text: `${NOTE}\n\nI am agreed with the side agent`, ...PERSON })

  expect(seen.check?.prompt).toContain('<prompt>\nI am agreed with the side agent\n</prompt>')
  expect(seen.check?.prompt).toContain('<forwarded_note>')
  expect(seen.rewrite?.prompt).toContain('<prompt>\nI am agreed with the side agent\n</prompt>')
  expect(sent).toEqual([`${NOTE}\n\nTask: I agree with the note. Push earlier.`])
})

test('the rewrite is told to add no lines the person did not state', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const seen = recordModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send clean'])
  enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(seen.rewrite?.system).toContain('leave the line out')
})

test('an edited copy of the proposal under "Other" replaces it, and is not sent twice', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  answerModel(on, '{"clear": false, "questions": []}')
  answerOther(
    on,
    'Task: Fix the login button on the login page and the signup page; clicking it does nothing.│ Why: Users cannot sign in.│ Guardrails: Keep the current design and color.│ Done when: Clicking the button signs the user in.',
  )
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(sent[0]?.match(/Task:/g)?.length).toBe(1)
  expect(sent[0]).toContain('and the signup page')
  expect(sent[0]).not.toContain('Note from me')
  expect(sent[0]).not.toContain('│')
})

test('a short note that shares words with the proposal stays a note', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  answerModel(on, '{"clear": false, "questions": []}')
  answerOther(on, 'also keep the login button color')
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(sent).toEqual([`${CLEAN}\n\nNote from me: also keep the login button color`])
})

test('a reply that cannot be read warns the person and is counted in /intent-guard status', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  answerModel(on, '{"clear": false, "questions": [{"question": "Which pa')
  const toasts = listenToasts(on)
  const sent = enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })
  const status = await $.command.run(command('status'))

  expect(sent).toEqual([MESSY])
  expect(toasts[0]).toContain('original was sent')
  expect(status.text).toContain('unreadable 1')
})

test('/intent-guard log shows what happened to each prompt, without its words', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 27) })
  answerModel(on, '{"clear": true}')
  enter(on)

  await $.prompt.submit({ text: 'Run the tests in src/auth', ...PERSON })
  const log = await $.command.run(command('log'))

  expect(log.text).toContain('· clear · 5 words')
  expect(log.text).not.toContain('src/auth')
})

test('the answers given are kept in /intent-guard last', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  answerModel(on, '{"clear": false, "questions": [{"question": "Which page?", "options": ["Login", "Signup"]}]}')
  answerDialog(on, ['Login', 'Send clean'])
  enter(on)

  await $.prompt.submit({ text: MESSY, ...PERSON })
  const shown = await $.command.run(command('last'))

  expect(shown.text).toContain('Which page? Login')
})

test('a dialog nobody answers lets the original through after 10 minutes', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  answerModel(on, '{"clear": false, "questions": [{"question": "Which?", "options": ["A", "B"]}]}')
  on('tool.call', { tool: 'AskUserQuestion' }, () => new Promise(() => {}))
  const toasts = listenToasts(on)
  const sent = enter(on)

  const submitted = $.prompt.submit({ text: MESSY, ...PERSON })
  await clock.advance(10 * 60 * 1000)
  await submitted

  expect(sent).toEqual([MESSY])
  expect(toasts[0]).toContain('original was sent')
})

test('the rewrite reads the last reply of Claude, as the check does', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.messages', () => ({
    value: [{ role: 'assistant', text: 'Should I rename the webhook table?', toolUses: [] }],
  }))
  const seen = recordModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send clean'])
  enter(on)

  await $.prompt.submit({ text: 'I am agreed with what you said about that one', ...PERSON })

  expect(seen.check?.prompt).toContain('webhook table')
  expect(seen.rewrite?.prompt).toContain('webhook table')
})

test('prompts running at once lose no count and no original', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  answerModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send clean', 'Send clean'])
  enter(on)

  await Promise.all([
    $.prompt.submit({ text: `${MESSY} first`, ...PERSON }),
    $.prompt.submit({ text: `${MESSY} second`, ...PERSON }),
  ])
  const status = await $.command.run(command('status'))
  const shown = await $.command.run(command('last 5'))

  expect(status.text).toContain('4 AI calls')
  expect(shown.text).toContain('first')
  expect(shown.text).toContain('second')
})

test('each session writes under its own key, and status adds up every session and the old key', async ($, on) => {
  const stored = new Map<string, unknown>([
    ['usage', { since: Date.UTC(2026, 9, 28), calls: 73, input: 100, output: 100 }],
    ['usage:other', { since: Date.UTC(2026, 9, 29), calls: 2, input: 10, output: 10 }],
  ])
  const written: string[] = []
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('store.set', (_, e) => {
    written.push(e.key)
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  mock.clock(on, { now: Date.UTC(2026, 9, 30) })
  on('session.id', () => ({ value: 'mine' }))
  answerModel(on, '{"clear": true}')
  enter(on)

  await $.prompt.submit({ text: 'Run the tests in src/auth', ...PERSON })
  const status = await $.command.run(command('status'))

  expect(status.text).toContain('Since 2026-10-28: 76 AI calls, 120 input + 120 output tokens')
  expect(written).toContain('usage:mine')
  expect(written).not.toContain('usage')
})

test('saved originals from every session are shown and deleted together', async ($, on) => {
  const now = Date.UTC(2026, 9, 27)
  mock.store(on, {
    history: [{ at: now, folder: '/a', original: 'old key words', sent: 'clean a' }],
    'history:other': [{ at: now, folder: '/b', original: 'other session words', sent: 'clean b' }],
  })
  mock.clock(on, { now })

  const shown = await $.command.run(command('last 5'))
  const cleared = await $.command.run(command('clear'))
  const after = await $.command.run(command('last'))

  expect(shown.text).toContain('old key words')
  expect(shown.text).toContain('other session words')
  expect(cleared.text).toBe('intent-guard: deleted 2 saved originals.')
  expect(after.text).toBe('intent-guard: nothing saved in the last 7 days.')
})

test('the check and the rewrite are told about images they cannot see', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const seen = recordModel(on, '{"clear": false, "questions": []}')
  answerDialog(on, ['Send clean'])
  enter(on)

  await $.prompt.submit({
    text: '[Image #1] check this alert from Midas',
    attachments: [{ type: 'image', mediaType: 'image/png' }],
    ...PERSON,
  })

  expect(seen.check?.prompt).toContain('1 attached image')
  expect(seen.rewrite?.prompt).toContain('1 attached image')
  expect(seen.check?.system).toContain('[Image #N]')
  expect(seen.rewrite?.system).toContain('[Image #N]')
})

test('when the rewrite fails after questions, the original goes with the answers and a warning', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('model.complete', (_, e) =>
    e.system?.includes('Reply with JSON only')
      ? {
          value: {
            isAnswered: true,
            text: '{"clear": false, "questions": [{"question": "Which page?", "options": ["Login", "Signup"]}]}',
            usage: USAGE,
          },
        }
      : { value: { isAnswered: false, reason: 'aborted', usage: USAGE } },
  )
  answerDialog(on, ['Login'])
  const toasts = listenToasts(on)
  const seen: { text: string; context?: readonly string[] }[] = []
  on('prompt.submit', (_, e) => {
    seen.push({ text: e.text, context: e.context })
    return { text: e.text }
  })

  await $.prompt.submit({ text: MESSY, ...PERSON })

  expect(seen[0]?.text).toBe(MESSY)
  expect(seen[0]?.context?.[0]).toContain('Which page? Login')
  expect(toasts[0]).toContain('original was sent')
})
