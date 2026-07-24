const createNumberedFormsparkHandler = require('./lib/numbered-formspark-submission')

const requiredFields = ['firstName', 'lastName', 'email', 'message']

function normalizeSubmission (submission) {
  const hasRequiredFields = requiredFields.every(field => (
    typeof submission[field] === 'string' && submission[field].trim()
  ))
  const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email)

  if (!hasRequiredFields || !hasValidEmail) {
    return null
  }

  return requiredFields.reduce((result, field) => {
    result[field] = submission[field].trim()
    return result
  }, {})
}

exports.handler = createNumberedFormsparkHandler({
  actionUrlEnvironmentVariable: 'FORMSPARK_ACTION_URL',
  counterKey: 'dgs-web:contact:submission-sequence',
  defaultActionUrl: 'https://submit-form.com/JRcw7QpWr',
  normalizeSubmission,
  subject: submissionId => `DelGrossos.com - Contact [ID:${submissionId}]`
})
