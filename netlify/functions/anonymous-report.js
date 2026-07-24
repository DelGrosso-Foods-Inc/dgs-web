const createNumberedFormsparkHandler = require('./lib/numbered-formspark-submission')

function normalizeSubmission (submission) {
  if (typeof submission.message !== 'string' || !submission.message.trim()) {
    return null
  }

  return {
    message: submission.message.trim()
  }
}

exports.handler = createNumberedFormsparkHandler({
  actionUrlEnvironmentVariable: 'FORMSPARK_ANONYMOUS_REPORT_ACTION_URL',
  counterKey: 'dgs-web:anonymous-report:submission-sequence',
  defaultActionUrl: 'https://submit-form.com/aedwNaAVs',
  normalizeSubmission,
  subject: submissionId => (
    `DelGrossos.com - Anonymous Report [ID:${submissionId}]`
  )
})
