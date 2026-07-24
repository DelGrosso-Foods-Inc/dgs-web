const assert = require('assert')

const createNumberedFormsparkHandler = require(
  '../netlify/functions/lib/numbered-formspark-submission'
)

const handlerOptions = {
  actionUrlEnvironmentVariable: 'TEST_FORMSPARK_ACTION_URL',
  counterKey: 'test:submission-sequence',
  defaultActionUrl: 'https://submit-form.com/test',
  errorRedirectPath: '/contact/#submission-error',
  normalizeSubmission: submission => {
    if (typeof submission.message !== 'string' || !submission.message.trim()) {
      return null
    }

    return {
      message: submission.message.trim()
    }
  },
  successRedirectPath: '/form-submitted/',
  subject: submissionId => `Test submission [ID:${submissionId}]`
}

async function runTest (name, test) {
  try {
    await test()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    throw error
  }
}

async function withMutedConsoleError (test) {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    await test()
  } finally {
    console.error = originalConsoleError
  }
}

async function main () {
  await runTest('returns JSON after a JavaScript submission succeeds', async () => {
    let forwardedSubmission

    const handler = createNumberedFormsparkHandler(handlerOptions, {
      allocateSubmissionId: () => Promise.resolve(42),
      forwardSubmission: (submission, submissionId) => {
        forwardedSubmission = {
          submission,
          submissionId
        }
        return Promise.resolve()
      }
    })
    const response = await handler({
      body: JSON.stringify({ message: '  Hello  ' }),
      headers: {
        'content-type': 'application/json'
      },
      httpMethod: 'POST'
    })

    assert.deepStrictEqual(response, {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ submissionId: 42 })
    })
    assert.deepStrictEqual(forwardedSubmission, {
      submission: {
        message: 'Hello'
      },
      submissionId: 42
    })
  })

  await runTest('redirects after a URL-encoded submission succeeds', async () => {
    const handler = createNumberedFormsparkHandler(handlerOptions, {
      allocateSubmissionId: () => Promise.resolve(43),
      forwardSubmission: () => Promise.resolve()
    })
    const response = await handler({
      body: 'message=Hello+from+a+browser',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      httpMethod: 'POST'
    })

    assert.deepStrictEqual(response, {
      statusCode: 303,
      headers: {
        Location: '/form-submitted/'
      },
      body: ''
    })
  })

  await runTest('redirects a rejected URL-encoded submission to the form error', async () => {
    const handler = createNumberedFormsparkHandler(handlerOptions, {
      allocateSubmissionId: () => Promise.resolve(44),
      forwardSubmission: () => Promise.resolve()
    })
    const response = await handler({
      body: 'message=',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      httpMethod: 'POST'
    })

    assert.deepStrictEqual(response, {
      statusCode: 303,
      headers: {
        Location: '/contact/#submission-error'
      },
      body: ''
    })
  })

  await runTest('redirects when Formspark rejects a URL-encoded submission', async () => {
    await withMutedConsoleError(async () => {
      const handler = createNumberedFormsparkHandler(handlerOptions, {
        allocateSubmissionId: () => Promise.resolve(45),
        forwardSubmission: () => Promise.reject(new Error('Formspark failed'))
      })
      const response = await handler({
        body: 'message=Hello',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        httpMethod: 'POST'
      })

      assert.deepStrictEqual(response, {
        statusCode: 303,
        headers: {
          Location: '/contact/#submission-error'
        },
        body: ''
      })
    })
  })

  await runTest('delivers without an ID when Upstash is unavailable', async () => {
    let forwardedSubmissionId

    await withMutedConsoleError(async () => {
      const handler = createNumberedFormsparkHandler(handlerOptions, {
        allocateSubmissionId: () => Promise.reject(new Error('Upstash failed')),
        forwardSubmission: (submission, submissionId) => {
          forwardedSubmissionId = submissionId
          return Promise.resolve()
        }
      })
      const response = await handler({
        body: JSON.stringify({ message: 'Important report' }),
        headers: {
          'content-type': 'application/json'
        },
        httpMethod: 'POST'
      })

      assert.deepStrictEqual(response, {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ submissionId: null })
      })
      assert.strictEqual(forwardedSubmissionId, null)
    })
  })

  await runTest('rejects unsupported submission content types', async () => {
    const handler = createNumberedFormsparkHandler(handlerOptions, {
      allocateSubmissionId: () => Promise.resolve(46),
      forwardSubmission: () => Promise.resolve()
    })
    const response = await handler({
      body: 'message=Hello',
      headers: {
        'content-type': 'text/plain'
      },
      httpMethod: 'POST'
    })

    assert.deepStrictEqual(response, {
      statusCode: 415,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Unsupported media type' })
    })
  })
}

main().catch(error => {
  console.error(error.stack)
  process.exitCode = 1
})
