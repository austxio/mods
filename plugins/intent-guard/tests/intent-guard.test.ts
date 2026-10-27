import { expect, test } from 'claude-code/testing'
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

test("the check reads Claude's last reply, so a short answer like \"yes\" is judged in context", async ($, on) => {
  on('session.messages', () => ({
    value: [{ role: 'assistant', text: 'Should I also update the tests?', toolUses: [] }],
  }))
  const prompts: string[] = []
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: '{"clear": true}', usage: USAGE } }
  })
  const sent = enter(on)

  await $.prompt.submit({ text: 'yes', ...PERSON })

  expect(prompts[0]).toContain('Should I also update the tests?')
  expect(sent).toEqual(['yes'])
})
