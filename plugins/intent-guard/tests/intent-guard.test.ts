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
