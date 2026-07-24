const https = require('https')

function jsonResponse (statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }
}

function redirectResponse (location) {
  return {
    statusCode: 303,
    headers: {
      Location: location
    },
    body: ''
  }
}

function getContentType (headers = {}) {
  const headerName = Object.keys(headers).find(name => (
    name.toLowerCase() === 'content-type'
  ))

  return headerName
    ? headers[headerName].split(';')[0].trim().toLowerCase()
    : ''
}

function parseSubmission (event) {
  const contentType = getContentType(event.headers)

  if (contentType === 'application/json') {
    return {
      responseType: 'json',
      submission: JSON.parse(event.body || '')
    }
  }

  if (contentType === 'application/x-www-form-urlencoded') {
    const submission = {}

    new URLSearchParams(event.body || '').forEach((value, name) => {
      submission[name] = value
    })

    return {
      responseType: 'redirect',
      submission
    }
  }

  return {
    responseType: 'json',
    submission: null,
    unsupported: true
  }
}

function submissionErrorResponse (responseType, options, statusCode = 400) {
  return responseType === 'redirect'
    ? redirectResponse(options.errorRedirectPath)
    : jsonResponse(statusCode, {
      error: statusCode === 400
        ? 'Invalid submission'
        : 'Unable to submit form'
    })
}

function postJson (urlString, headers, payload) {
  const body = JSON.stringify(payload)
  const url = new URL(urlString)

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: Object.assign({}, headers, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      })
    }, response => {
      let responseBody = ''

      response.setEncoding('utf8')
      response.on('data', chunk => {
        responseBody += chunk
      })
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          body: responseBody
        })
      })
    })

    request.setTimeout(10000, () => {
      request.destroy(new Error('Upstream request timed out'))
    })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

function allocateSubmissionId (counterKey) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!redisUrl || !redisToken) {
    return Promise.reject(new Error('Upstash Redis is not configured'))
  }

  return postJson(redisUrl, {
    Accept: 'application/json',
    Authorization: `Bearer ${redisToken}`
  }, ['INCR', counterKey]).then(response => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error('Upstash counter request failed')
    }

    let result

    try {
      result = JSON.parse(response.body).result
    } catch (error) {
      throw new Error('Upstash counter returned an invalid response')
    }

    if (!Number.isInteger(result) || result < 1) {
      throw new Error('Upstash counter returned an invalid value')
    }

    return result
  })
}

function forwardSubmission (options, submission, submissionId) {
  const formsparkActionUrl = process.env[options.actionUrlEnvironmentVariable] ||
    options.defaultActionUrl

  return postJson(formsparkActionUrl, {
    Accept: 'application/json'
  }, Object.assign({}, submission, {
    submissionId,
    _email: {
      subject: options.subject(submissionId)
    }
  })).then(response => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error('Formspark submission failed')
    }
  })
}

function createNumberedFormsparkHandler (options, dependencies = {}) {
  const allocateId = dependencies.allocateSubmissionId || (() => (
    allocateSubmissionId(options.counterKey)
  ))
  const forward = dependencies.forwardSubmission || ((submission, submissionId) => (
    forwardSubmission(options, submission, submissionId)
  ))

  return async event => {
    if (event.httpMethod !== 'POST') {
      const response = jsonResponse(405, { error: 'Method not allowed' })
      response.headers.Allow = 'POST'
      return response
    }

    let parsedSubmission

    try {
      parsedSubmission = parseSubmission(event)
    } catch (error) {
      return jsonResponse(400, { error: 'Invalid submission' })
    }

    const body = parsedSubmission.submission

    if (parsedSubmission.unsupported) {
      return jsonResponse(415, { error: 'Unsupported media type' })
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse(400, { error: 'Invalid submission' })
    }

    const submission = options.normalizeSubmission(body)

    if (!submission) {
      return submissionErrorResponse(parsedSubmission.responseType, options)
    }

    return allocateId().catch(() => {
      console.error('Submission counter unavailable')
      return null
    }).then(submissionId => (
      forward(submission, submissionId).then(() => (
        parsedSubmission.responseType === 'redirect'
          ? redirectResponse(options.successRedirectPath)
          : jsonResponse(200, { submissionId })
      ))
    )).catch(() => {
      console.error('Formspark submission failed')
      return submissionErrorResponse(
        parsedSubmission.responseType,
        options,
        502
      )
    })
  }
}

module.exports = createNumberedFormsparkHandler
