(function () {
  var submissionTimeoutMs = 30000
  var form = document.querySelector('[data-contact-form]')

  if (
    !form ||
    !window.fetch ||
    !window.FormData ||
    !window.FormData.prototype.forEach
  ) {
    return
  }

  var submitButton = form.querySelector('[data-contact-form-submit]')
  var errorMessage = form.querySelector('[data-contact-form-error]')
  var progressMessage = document.querySelector('[data-contact-form-progress]')
  var successMessage = document.querySelector('[data-contact-form-success]')
  var submissionEndpoint = form.getAttribute('data-contact-form-endpoint')

  if (!submissionEndpoint) {
    return
  }

  form.addEventListener('submit', function (event) {
    var submission = {}
    var formData = new window.FormData(form)

    formData.forEach(function (value, name) {
      submission[name] = value
    })

    event.preventDefault()

    errorMessage.hidden = true
    submitButton.disabled = true
    submitButton.textContent = 'Sending…'
    form.setAttribute('aria-busy', 'true')
    if (progressMessage) {
      progressMessage.textContent = 'Sending your message.'
    }

    var abortController = window.AbortController
      ? new window.AbortController()
      : null
    var timeoutId
    var requestOptions = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(submission)
    }

    if (abortController) {
      requestOptions.signal = abortController.signal
    }

    var timeout = new window.Promise(function (resolve, reject) {
      timeoutId = window.setTimeout(function () {
        if (abortController) {
          abortController.abort()
        }

        reject(new Error('Form submission timed out'))
      }, submissionTimeoutMs)
    })

    window.Promise.race([
      window.fetch(submissionEndpoint, requestOptions),
      timeout
    ]).then(function (response) {
      if (!response.ok) {
        throw new Error('Form submission failed')
      }

      form.hidden = true
      successMessage.hidden = false
      successMessage.focus()
    }).catch(function () {
      errorMessage.hidden = false
      errorMessage.focus()
      submitButton.disabled = false
      submitButton.textContent = 'Submit'
    }).then(function () {
      window.clearTimeout(timeoutId)
      form.removeAttribute('aria-busy')
      if (progressMessage) {
        progressMessage.textContent = ''
      }
    })
  })
})()
